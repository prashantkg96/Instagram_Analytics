// json.js — adapter for Instagram's JSON export format.
//
// Meta offers the same data as either HTML or JSON. JSON is cheaper and more
// reliable to read, so it is the format the UI recommends. This module builds
// the same dataset shape the HTML parsers produce.
//
// Caveat worth stating plainly: this adapter is written against Meta's
// published JSON schema and exercised by tools/make-json-fixture.mjs, but it
// has not been run against a live JSON export. The HTML path is the one
// verified end-to-end. If a field looks wrong in a JSON export, suspect here
// first.

import { hashtagsInText, mentionsInText } from './common.js';
import { deviceOf } from './security.js';
import { summariseThread } from './messages.js';

/**
 * Undo Meta's double-encoding. Strings in the JSON export are UTF-8 bytes that
 * were then serialized as if they were Latin-1, so "😂" arrives as "ð".
 */
export function fixMojibake(text) {
  if (typeof text !== 'string' || !/[\u0080-\u00ff]/.test(text)) return text;
  try {
    const bytes = Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return decoded;
  } catch {
    return text;
  }
}

const S = (v) => (typeof v === 'string' ? fixMojibake(v) : v ?? null);
const at = (seconds) => (seconds ? new Date(seconds * 1000).toISOString() : null);

function read(files, pattern) {
  for (const [name, text] of files) {
    if (!pattern.test(name)) continue;
    try {
      return JSON.parse(text);
    } catch {
      /* a malformed file should not sink the whole export */
    }
  }
  return null;
}

function readAll(files, pattern) {
  const out = [];
  for (const [name, text] of [...files].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))) {
    if (!pattern.test(name)) continue;
    try {
      out.push({ name, data: JSON.parse(text) });
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Meta wraps lists under one key whose name varies; take the first array. */
function listOf(doc, ...keys) {
  if (!doc) return [];
  if (Array.isArray(doc)) return doc;
  for (const key of keys) if (Array.isArray(doc[key])) return doc[key];
  for (const value of Object.values(doc)) if (Array.isArray(value)) return value;
  return [];
}

/** `string_map_data` is a label -> {value, href, timestamp} dictionary. */
function mapField(entry, label) {
  const cell = entry?.string_map_data?.[label];
  if (!cell) return null;
  return cell.value !== undefined ? S(cell.value) : null;
}

function mapTime(entry, ...labels) {
  for (const label of labels) {
    const cell = entry?.string_map_data?.[label];
    if (cell?.timestamp) return at(cell.timestamp);
  }
  if (entry?.timestamp) return at(entry.timestamp);
  return null;
}

/** A person entry: `string_list_data[0]` holds handle, profile URL and time. */
function person(entry) {
  const item = entry?.string_list_data?.[0];
  if (!item) return null;
  return {
    u: S(item.value) ?? null,
    name: S(entry.title) || null,
    at: at(item.timestamp),
  };
}

function people(doc, ...keys) {
  return listOf(doc, ...keys).map(person).filter((p) => p && p.u);
}

function mediaItem(entry, kind) {
  const caption = S(entry.title) ?? S(entry.media?.[0]?.title) ?? '';
  const media = Array.isArray(entry.media) ? entry.media : [entry];
  const meta = media[0]?.media_metadata ?? {};
  const exif = meta.photo_metadata?.exif_data?.[0] ?? meta.video_metadata?.exif_data?.[0] ?? {};
  const created = entry.creation_timestamp ?? media[0]?.creation_timestamp ?? null;
  const lat = exif.latitude ?? null;
  const lng = exif.longitude ?? null;

  return {
    kind,
    at: at(created),
    caption,
    hashtags: hashtagsInText(caption),
    mentions: mentionsInText(caption),
    place: null,
    coords: lat && lng ? { lat, lng } : null,
    mediaCount: media.length,
    type: kind === 'post' ? (media.length > 1 ? 'carousel' : 'photo') : kind,
    paidPartnership: false,
    isAd: false,
    aiGenerated: false,
    audioMuted: false,
    draft: false,
    published: true,
    width: null,
    height: null,
    bytes: null,
    sourceType: S(media[0]?.cross_post_source?.source_app) ?? null,
    deviceId: S(exif.device_id) ?? null,
  };
}

/** Impression rows: an Author handle plus a time. */
function impressions(doc, kind, ...keys) {
  return listOf(doc, ...keys).map((entry) => ({
    kind,
    at: mapTime(entry, 'Time'),
    u: mapField(entry, 'Author') ?? mapField(entry, 'Username') ?? null,
    hashtags: [],
  }));
}

export function parseJsonExport(files) {
  // ── profile ──
  const info = listOf(read(files, /personal_information\/personal_information\.json$/i), 'profile_user')[0];
  const account = listOf(read(files, /instagram_profile_information\.json$/i), 'profile_account_insights')[0];
  const signup = listOf(read(files, /signup_details\.json$/i), 'account_history_registration_info')[0];

  const profile = {
    username: mapField(info, 'Username'),
    name: mapField(info, 'Name'),
    bio: mapField(info, 'Bio'),
    gender: mapField(info, 'Gender'),
    isPrivate: mapField(info, 'Private Account') === 'True',
    contactSyncing: mapField(account, 'Contact Syncing') === 'True',
    firstCountry: mapField(account, 'First Country Code'),
    lastLogin: mapTime(account, 'Last Login'),
    lastLogout: mapTime(account, 'Last Logout'),
    firstStoryAt: mapTime(account, 'First Story Time'),
    lastStoryAt: mapTime(account, 'Last Story Time'),
    hasSharedLive: mapField(account, 'Has Shared Live Video') === 'True',
    createdAt: mapTime(signup, 'Time'),
    signupDevice: mapField(signup, 'Device'),
    basedIn: null,
    locationsOfInterest: [],
    friendMapAudience: null,
    profileChanges: listOf(read(files, /profile_changes\.json$/i), 'profile_profile_change').map((e) => ({
      changed: mapField(e, 'Changed'),
      newValue: mapField(e, 'New Value'),
      previousValue: mapField(e, 'Previous Value'),
      at: mapTime(e, 'Change Date'),
    })),
    privacyChanges: [],
    monetization: [],
    stars: [],
    sensitive: {
      email: mapField(info, 'Email'),
      phone: mapField(info, 'Phone Number'),
      dateOfBirth: mapField(info, 'Date of birth'),
      signupIp: mapField(signup, 'IP Address'),
      signupEmail: mapField(signup, 'Email'),
    },
  };

  // ── connections ──
  const followers = readAll(files, /followers(_\d+)?\.json$/i).flatMap(({ data }) => people(data));
  const following = people(read(files, /following\.json$/i), 'relationships_following');

  // ── content ──
  const posts = readAll(files, /content\/posts(_\d+)?\.json$/i)
    .flatMap(({ data }) => listOf(data))
    .map((e) => mediaItem(e, 'post'));
  const stories = listOf(read(files, /content\/stories\.json$/i), 'ig_stories').map((e) => mediaItem(e, 'story'));
  const reels = listOf(read(files, /content\/reels\.json$/i), 'ig_reels_media').map((e) => mediaItem(e, 'reel'));

  // ── engagement ──
  const likes = listOf(read(files, /liked_posts\.json$/i), 'likes_media_likes').map((e) => ({
    kind: 'like',
    at: at(e.string_list_data?.[0]?.timestamp),
    url: e.string_list_data?.[0]?.href ?? null,
    u: S(e.title) || null,
    name: null,
    hashtags: [],
  }));

  const comments = readAll(files, /post_comments(_\d+)?\.json$/i)
    .flatMap(({ data }) => listOf(data, 'comments_media_comments'))
    .map((e) => {
      const text = mapField(e, 'Comment') ?? '';
      return {
        kind: 'comment',
        at: mapTime(e, 'Time'),
        u: mapField(e, 'Media Owner'),
        length: text.length,
        words: text ? text.trim().split(/\s+/).length : 0,
        emoji: (text.match(/\p{Extended_Pictographic}/gu) ?? []).length,
        mentions: (text.match(/@[A-Za-z0-9._]+/g) ?? []).map((s) => s.slice(1).toLowerCase()),
      };
    });

  // ── security ──
  const logins = listOf(read(files, /login_activity\.json$/i), 'account_history_login_history').map((e) => ({
    at: mapTime(e, 'Time'),
    ip: mapField(e, 'IP Address'),
    port: mapField(e, 'Port'),
    userAgent: mapField(e, 'User Agent'),
    language: mapField(e, 'Language Code'),
    cookie: mapField(e, 'Cookie Name'),
  }));

  // ── messages ──
  //
  // Reduced by the same `summariseThread` the HTML path uses. It previously had
  // its own copy, which left `opened`, `openedByMe`, `medianReplySeconds` and
  // `hours` permanently empty on JSON exports — the fields existed but were
  // stubs, so anything reading them silently got zeros for half of all users.
  const threads = readAll(files, /messages\/.*\/message_\d+\.json$/i).map(({ name, data }) => {
    const msgs = (data.messages ?? []).map((m) => ({
      from: S(m.sender_name),
      isMe: S(m.sender_name) === profile.name,
      at: m.timestamp_ms ? new Date(m.timestamp_ms).toISOString() : null,
      length: (S(m.content) ?? '').length,
      emoji: ((S(m.content) ?? '').match(/\p{Extended_Pictographic}/gu) ?? []).length,
      hasLink: /https?:\/\//.test(S(m.content) ?? ''),
      isShare: Boolean(m.share),
    }));
    return summariseThread(msgs, {
      slug: name.split('/').at(-2),
      folder: name.includes('message_requests') ? 'message_requests' : 'inbox',
      title: S(data.title) ?? null,
    });
  });

  const ips = new Set(logins.map((l) => l.ip).filter(Boolean));

  return {
    format: 'json',
    meta: { generatedAt: null, rangeStart: null, rangeEnd: null },
    profile,
    followers,
    following,
    unfollowed: people(read(files, /recently_unfollowed_profiles\.json$/i), 'relationships_unfollowed_users'),
    blocked: people(read(files, /blocked_profiles\.json$/i), 'relationships_blocked_users'),
    followRequests: people(read(files, /recent_follow_requests\.json$/i), 'relationships_permanent_follow_requests'),
    removedSuggestions: people(read(files, /removed_suggestions\.json$/i), 'relationships_dismissed_suggested_users'),
    pendingFollowRequests: people(read(files, /pending_follow_requests\.json$/i), 'relationships_follow_requests_sent'),
    syncedContactCount: listOf(read(files, /synced_contacts\.json$/i), 'contacts_contact_info').length,
    content: {
      posts,
      stories,
      reels,
      live: [],
      other: [],
      deleted: [],
      profilePhotos: [],
      published: [...posts, ...reels, ...stories].filter((m) => m.at),
      mediaFileCount: posts.reduce((s, p) => s + p.mediaCount, 0),
    },
    engagement: {
      likes,
      likedComments: listOf(read(files, /liked_comments\.json$/i), 'likes_comment_likes').map((e) => ({
        kind: 'likeComment',
        at: at(e.string_list_data?.[0]?.timestamp),
        url: e.string_list_data?.[0]?.href ?? null,
        u: S(e.title) || null,
        name: null,
        hashtags: [],
      })),
      storyLikes: [],
      saved: listOf(read(files, /saved_posts\.json$/i), 'saved_saved_media').map((e) => ({
        kind: 'save',
        at: at(e.string_map_data?.['Saved on']?.timestamp),
        url: e.string_map_data?.['Saved on']?.href ?? null,
        u: S(e.title) || null,
        name: null,
        hashtags: [],
      })),
      comments,
      savedCollections: 0,
      savedMusic: 0,
    },
    consumption: {
      storiesViewed: impressions(read(files, /stories_viewed\.json$/i), 'storyView', 'impressions_history_chaining_seen', 'impressions_history_stories_seen'),
      postsViewed: impressions(read(files, /posts_viewed\.json$/i), 'postView', 'impressions_history_posts_seen'),
      videosWatched: impressions(read(files, /videos_watched\.json$/i), 'videoView', 'impressions_history_videos_watched'),
      notInterestedPosts: [],
      notInterestedProfiles: [],
      searches: listOf(read(files, /word_or_phrase_searches\.json$/i), 'searches_keyword').map((e) => ({
        q: mapField(e, 'Search'),
        at: mapTime(e, 'Time'),
      })).filter((s) => s.q),
      linkHistory: [],
    },
    ads: {
      adsViewed: listOf(read(files, /ads_viewed\.json$/i), 'impressions_history_ads_seen').map((e) => ({
        at: mapTime(e, 'Time'),
        u: mapField(e, 'Author'),
        title: null,
        libraryUrl: null,
      })),
      advertisers: listOf(
        read(files, /advertisers_using_your_activity_or_information\.json$/i),
        'ig_custom_audiences_all_types',
      ).map((e) => S(e.advertiser_name)).filter(Boolean),
      topics: [],
      seeLessTopics: [],
      hiddenAds: 0,
      offMeta: [],
    },
    messages: {
      threads: threads.sort((a, b) => b.total - a.total),
      selfIdentified: Boolean(profile.name),
    },
    security: {
      logins,
      logouts: [],
      profileActivity: [],
      passwordChanges: [],
      secretConversations: [],
      lastKnownLocation: null,
      uniqueIps: [...ips],
      deviceIds: [],
      devices: [...new Set(logins.map((l) => deviceOf(l.userAgent)).filter(Boolean).map((d) => `${d.platform} ${d.model}`))],
    },
  };
}
