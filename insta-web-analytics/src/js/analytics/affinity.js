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
// than a like, and a like is stronger than a passing view.
const WEIGHTS = { comment: 4, save: 3, like: 2, storyLike: 2, likeComment: 1, view: 0.2 };

function add(map, handle, kind, at) {
  if (!handle) return;
  const key = handle.toLowerCase();
  const row = map.get(key) ?? {
    u: handle, comment: 0, save: 0, like: 0, storyLike: 0, likeComment: 0, view: 0, score: 0, last: null,
  };
  row[kind]++;
  row.score += WEIGHTS[kind];
  if (at && (!row.last || at > row.last)) row.last = at;
  map.set(key, row);
}

export function affinity(data) {
  const { likes, comments, saved, storyLikes, likedComments } = data.engagement;
  const { storiesViewed, postsViewed, videosWatched } = data.consumption;

  const creators = new Map();
  for (const x of likes) add(creators, x.u, 'like', x.at);
  for (const x of comments) add(creators, x.u, 'comment', x.at);
  for (const x of saved) add(creators, x.u, 'save', x.at);
  for (const x of storyLikes) add(creators, x.u, 'storyLike', x.at);
  for (const x of likedComments) add(creators, x.u, 'likeComment', x.at);
  for (const x of [...storiesViewed, ...postsViewed, ...videosWatched]) add(creators, x.u, 'view', x.at);

  for (const row of creators.values()) row.score = Math.round(row.score * 10) / 10;

  const followingSet = new Set(data.following.map((p) => p.u.toLowerCase()));
  const followerSet = new Set(data.followers.map((p) => p.u.toLowerCase()));

  const all = [...creators.entries()].map(([key, row]) => ({
    ...row,
    interactions: row.comment + row.save + row.like + row.storyLike + row.likeComment,
    youFollow: followingSet.has(key),
    followsYou: followerSet.has(key),
  }));
  all.sort((a, b) => b.score - a.score);

  const engagedKeys = new Set(all.filter((r) => r.interactions > 0).map((r) => r.u.toLowerCase()));
  const seenKeys = new Set(all.map((r) => r.u.toLowerCase()));

  // The real analogue of "ghost followers": accounts occupying a following
  // slot that have never produced a single interaction.
  const oneSidedFollows = data.following
    .filter((p) => !engagedKeys.has(p.u.toLowerCase()))
    .map((p) => ({ ...p, everSeen: seenKeys.has(p.u.toLowerCase()) }));

  const unreciprocated = all
    .filter((r) => r.interactions >= 3 && !r.followsYou)
    .slice(0, 100);

  const mutualEngaged = all.filter((r) => r.followsYou && r.interactions > 0);

  return {
    creators: all.slice(0, 200),
    totalCreators: all.length,
    engagedCreators: engagedKeys.size,
    oneSidedFollows,
    oneSidedCount: oneSidedFollows.length,
    // Following slots that produce nothing — the number worth acting on.
    oneSidedPct: data.following.length
      ? Math.round((oneSidedFollows.length / data.following.length) * 1000) / 10
      : 0,
    unreciprocated,
    mutualEngaged,
    weights: WEIGHTS,
  };
}
