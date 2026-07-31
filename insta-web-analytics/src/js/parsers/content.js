// content.js — the user's own posts, stories, reels and other media.
//
// Publish times come from each record's trailing stamp, never from
// "Update time": the latter is the moment of a later edit. Using it would move
// posts months from where they actually landed and corrupt attribution.

import {
  pick, pickAll, nodes, nodesOf, field, section, coordsOf, toBool, toNumber,
  hashtagsInText, mentionsInText, trailingStamp, iso,
} from './common.js';

/** Count of media files attached — how a carousel is distinguished from a single. */
function mediaCount(node) {
  let n = 0;
  const walk = (x) => {
    if (x.fields.has('Media')) n++;
    x.children.forEach(walk);
  };
  walk(node);
  return Math.max(n, 1);
}

function placeOf(node) {
  const place = section(node, 'Place');
  if (!place) return null;
  const name = field(place, 'Name') ?? place.text.split('\n')[0];
  return name || null;
}

function mediaItem(node, kind) {
  const at = trailingStamp(node);
  const caption = field(node, 'Caption') ?? node.heading ?? '';
  const count = mediaCount(node);
  return {
    kind,
    at: iso(at),
    caption,
    hashtags: hashtagsInText(caption),
    mentions: mentionsInText(caption),
    place: placeOf(node),
    coords: coordsOf(node),
    mediaCount: count,
    // A post with several attachments is a carousel; the export has no
    // explicit type flag, so the attachment count is the only signal.
    type: kind === 'post' ? (count > 1 ? 'carousel' : 'photo') : kind,
    paidPartnership: toBool(field(node, 'Paid partnership')),
    isAd: toBool(field(node, 'Is an advertisement')),
    aiGenerated: toBool(field(node, 'Marked as AI generated')),
    audioMuted: toBool(field(node, 'Is audio muted')),
    draft: toBool(field(node, 'Draft')),
    published: field(node, 'Published') === undefined ? true : toBool(field(node, 'Published')),
    width: toNumber(field(node, 'Original width')),
    height: toNumber(field(node, 'Original height')),
    bytes: toNumber(field(node, 'File size in bytes')),
    sourceType: field(node, 'Source type') ?? null,
    deviceId: field(node, 'Device ID') ?? null,
  };
}

function listOf(files, pattern, kind) {
  return nodesOf(pickAll(files, pattern)).map((n) => mediaItem(n, kind));
}

export function parseContent(files) {
  // posts.html carries the full metadata table; posts_1.html is the plainer
  // caption+date view of the same posts. Prefer the richer one.
  const postsHtml = pick(files, 'your_instagram_activity/media/posts.html');
  const posts = postsHtml
    ? nodes(postsHtml).map((n) => mediaItem(n, 'post'))
    : nodesOf(pickAll(files, /media\/posts(_\d+)?\.html$/i)).map((n) => mediaItem(n, 'post'));

  const stories = listOf(files, /media\/stories\.html$/i, 'story');
  const reels = listOf(files, /media\/reels\.html$/i, 'reel');
  const live = listOf(files, /media\/archived_live_videos\.html$/i, 'live');
  const other = listOf(files, /media\/other_content\.html$/i, 'other');
  const deleted = listOf(files, /media\/recently_deleted_content\.html$/i, 'deleted');
  const profilePhotos = listOf(files, /media\/profile_photos\.html$/i, 'profilePhoto');

  return {
    posts,
    stories,
    reels,
    live,
    other,
    deleted,
    profilePhotos,
    // Every published item on one timeline — the input to attribution.
    published: [...posts, ...reels, ...stories].filter((m) => m.at && m.published && !m.draft),
    mediaFileCount: posts.reduce((s, p) => s + p.mediaCount, 0),
  };
}
