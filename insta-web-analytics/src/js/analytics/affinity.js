// affinity.js — who the user actually pays attention to.
//
// The desktop app ranks *followers* by how much they engage with the user.
// The export cannot answer that, but it answers the mirror image exactly: it
// records every like, comment, save and view the user made, with the creator
// attached. That turns the same tooling inside out:
//
//   ghost followers        -> one-sided follows (you follow, you never engage)
//   active followers       -> creators you engage with most
//   non-follower engagers  -> creators you engage with who ignore you back
//
// Weights are deliberate: writing a comment is a stronger signal of interest
// than a like. Views are NOT in this scale — see below.
const WEIGHTS = { comment: 4, save: 3, like: 2, storyLike: 2, storyResponse: 2, likeComment: 1 };

function add(map, handle, kind, at, weight) {
  if (!handle) return;
  const key = handle.toLowerCase();
  const row = map.get(key) ?? {
    u: handle, comment: 0, save: 0, like: 0, storyLike: 0, storyResponse: 0,
    likeComment: 0, view: 0, score: 0, last: null,
  };
  row[kind]++;
  row.score += weight;
  if (at && (!row.last || at > row.last)) row.last = at;
  map.set(key, row);
}

export function affinity(data) {
  const {
    likes, comments, saved, storyLikes, likedComments,
    storyResponses = [], notesReposts = [],
  } = data.engagement;
  const { storiesViewed, postsViewed, videosWatched } = data.consumption;
  const cov = data.coverage ?? {};

  // Two rankings, not one.
  //
  // Deliberate interactions and passive views are retained for wildly different
  // lengths of time — on a real complete-timeline export, likes reached back
  // 1128 days and views 31. Scoring them together made view counts invisible:
  // every one of the top five creators had `view: 0`, because a decade of likes
  // buried a month of watching no matter how the weights were set. They are
  // different questions over different windows, so they get different lists.
  const engagedMap = new Map();
  for (const x of likes) add(engagedMap, x.u, 'like', x.at, WEIGHTS.like);
  for (const x of comments) add(engagedMap, x.u, 'comment', x.at, WEIGHTS.comment);
  for (const x of saved) add(engagedMap, x.u, 'save', x.at, WEIGHTS.save);
  for (const x of storyLikes) add(engagedMap, x.u, 'storyLike', x.at, WEIGHTS.storyLike);
  for (const x of likedComments) add(engagedMap, x.u, 'likeComment', x.at, WEIGHTS.likeComment);
  for (const x of storyResponses) add(engagedMap, x.u, 'storyResponse', x.at, WEIGHTS.storyResponse);

  const watchedMap = new Map();
  for (const x of [...storiesViewed, ...postsViewed, ...videosWatched]) {
    add(watchedMap, x.u, 'view', x.at, 1);
  }

  const followingSet = new Set(data.following.map((p) => p.u.toLowerCase()));
  const followerSet = new Set(data.followers.map((p) => p.u.toLowerCase()));

  const decorate = (map) => [...map.entries()].map(([key, row]) => ({
    ...row,
    score: Math.round(row.score * 10) / 10,
    interactions: row.comment + row.save + row.like + row.storyLike + row.likeComment,
    youFollow: followingSet.has(key),
    followsYou: followerSet.has(key),
  }));

  const engaged = decorate(engagedMap).sort((a, b) => b.score - a.score);
  const watched = decorate(watchedMap).sort((a, b) => b.view - a.view);

  const engagedKeys = new Set(engaged.filter((r) => r.interactions > 0).map((r) => r.u.toLowerCase()));
  const seenKeys = new Set([...engagedMap.keys(), ...watchedMap.keys()]);
  const all = engaged;

  // The real analogue of "ghost followers": accounts occupying a following
  // slot that have never produced a single interaction.
  const oneSidedFollows = data.following
    .filter((p) => !engagedKeys.has(p.u.toLowerCase()))
    .map((p) => ({ ...p, everSeen: seenKeys.has(p.u.toLowerCase()) }));

  // "Quiet followers" — followers you have never engaged with in any way.
  //
  // NOT the desktop app's ghost followers, and the label says so. That metric
  // asks who ignores *you*, which needs the likes and comments your posts
  // received; the export contains no incoming engagement whatsoever, so it
  // cannot be computed here at any fidelity. This is the direction the data
  // does support: followers whose content never appears in anything you did.
  const quietFollowers = data.followers
    .filter((p) => !seenKeys.has(p.u.toLowerCase()))
    .map((p) => ({ ...p, youFollow: followingSet.has(p.u.toLowerCase()) }));

  // The only real post links anywhere in the export.
  //
  // Your own media carries no permalink — no URL, no shortcode, no media ID —
  // but everything you interacted with does, because the record has to identify
  // someone else's post. Capped at the recent tail; the full like history runs
  // to thousands of rows and none of the older ones are worth shipping to the
  // page.
  const recentLinks = [
    ...likes.map((x) => ({ ...x, kind: 'like' })),
    ...saved.map((x) => ({ ...x, kind: 'save' })),
    ...storyLikes.map((x) => ({ ...x, kind: 'story like' })),
    ...storyResponses,
  ]
    .filter((x) => x.at && x.url)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 300)
    .map((x) => ({ kind: x.kind, u: x.u, at: x.at, url: x.url }));

  const unreciprocated = all
    .filter((r) => r.interactions >= 3 && !r.followsYou)
    .slice(0, 100);

  const mutualEngaged = all.filter((r) => r.followsYou && r.interactions > 0);

  return {
    // Two lists over two windows. `coverage` travels with each so the UI can
    // state the period rather than let either read as lifetime.
    engaged: engaged.slice(0, 200),
    engagedCoverage: cov.likes ?? null,
    watched: watched.slice(0, 200),
    watchedCoverage: cov.storiesViewed ?? null,

    creators: all.slice(0, 200),
    totalCreators: all.length,
    engagedCreators: engagedKeys.size,
    watchedCreators: watchedMap.size,
    oneSidedFollows,
    oneSidedCount: oneSidedFollows.length,
    // Following slots that produce nothing — the number worth acting on.
    oneSidedPct: data.following.length
      ? Math.round((oneSidedFollows.length / data.following.length) * 1000) / 10
      : 0,
    recentLinks,
    storyResponseCount: storyResponses.length,
    notesRepostCount: notesReposts.length,
    notesReposts,

    quietFollowers,
    quietCount: quietFollowers.length,
    quietPct: data.followers.length
      ? Math.round((quietFollowers.length / data.followers.length) * 1000) / 10
      : 0,

    unreciprocated,
    mutualEngaged,
    weights: WEIGHTS,
  };
}
