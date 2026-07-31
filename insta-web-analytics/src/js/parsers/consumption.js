// consumption.js — what the user watched, plus searches and in-app browsing.
//
// This is by far the largest section (stories_viewed.html alone is ~17 MB and
// several thousand records), so records are projected down to the few fields
// analytics needs as they are read. Captions in particular are discarded
// immediately: retaining them would hold tens of MB for no benefit.

import {
  pickAll, nodes, nodesOf, field, ownerOf, hashtagsOf, when, parseStamp, iso,
} from './common.js';

function viewed(node, kind) {
  const owner = ownerOf(node);
  return {
    kind,
    at: iso(when(node)),
    u: owner?.u ?? null,
    hashtags: hashtagsOf(node),
  };
}

function listOf(files, pattern, kind) {
  const out = [];
  for (const { html } of pickAll(files, pattern)) {
    for (const node of nodes(html)) out.push(viewed(node, kind));
  }
  return out;
}

export function parseConsumption(files) {
  const storiesViewed = listOf(files, /story_interactions\/stories_viewed\.html$/i, 'storyView');
  const postsViewed = listOf(files, /ads_and_topics\/posts_viewed\.html$/i, 'postView');
  const videosWatched = listOf(files, /ads_and_topics\/videos_watched\.html$/i, 'videoView');

  const notInterestedPosts = nodesOf(
    pickAll(files, /posts_you.?re_not_interested_in\.html$/i),
  ).map((node) => ({ at: iso(when(node)), u: ownerOf(node)?.u ?? null, source: field(node, 'Source') ?? null }));

  const notInterestedProfiles = nodesOf(
    pickAll(files, /profiles_you.?re_not_interested_in\.html$/i),
  ).map((node) => ({ at: iso(when(node)), u: field(node, 'Username') ?? null }));

  // Accounts Instagram put in front of you unprompted. Paired with the
  // dismissals above this is the whole recommendation loop: what it pushed,
  // and how much of it you rejected.
  const suggestedProfiles = nodesOf(
    pickAll(files, /suggested_profiles_viewed\.html$/i),
  ).map((node) => ({
    at: iso(when(node)),
    u: field(node, 'Username') ?? null,
    name: field(node, 'Name') ?? null,
  })).filter((p) => p.u);

  const searches = nodesOf(pickAll(files, /recent_searches\/.*\.html$/i)).map((node) => ({
    q: field(node, 'Search') ?? field(node, 'Query') ?? null,
    at: iso(when(node)),
  })).filter((s) => s.q);

  // Session start/end pairs give real dwell time — the only duration signal
  // anywhere in the export.
  const linkHistory = nodesOf(pickAll(files, /link_history\/.*\.html$/i)).map((node) => {
    const start = parseStamp(field(node, 'Website session start time'));
    const end = parseStamp(field(node, 'Website session end time'));
    const url = field(node, 'Website link you visited') ?? node.links[0] ?? null;
    let host = null;
    try {
      host = url ? new URL(url).hostname.replace(/^www\./, '') : null;
    } catch {
      host = null;
    }
    return {
      url,
      host,
      title: field(node, 'Title of website page you visited') ?? null,
      at: iso(start),
      seconds: start && end ? Math.max(0, Math.round((end - start) / 1000)) : null,
    };
  });

  return {
    storiesViewed,
    postsViewed,
    videosWatched,
    notInterestedPosts,
    notInterestedProfiles,
    suggestedProfiles,
    searches,
    linkHistory,
  };
}
