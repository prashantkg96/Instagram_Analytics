// fans.js — who engages with the user, rather than who the user engages with.
//
// This is the hardest question to answer honestly from an export, so it is
// worth being precise about what is and is not here.
//
// Instagram exports NO inbound engagement on your posts. There is no list of
// who liked, commented on or saved something of yours, at any fidelity — every
// engagement file in the archive records an action *you* took, with the other
// party attached. See the note in affinity.js. Nothing below invents it.
//
// What the export does carry, per person, is the direct-message inbox. That
// matters more than it first sounds: a story reply is delivered as a DM, and so
// is every reel or post somebody sends you. So the inbox is a real record of
// people engaging with your content in your direction — just not the surface
// most people picture when they say "who likes my posts".
//
// Two rankings come out of that:
//
//   fans      inbound only. Messages they sent, content they sent, and
//             conversations they started. Nothing you did counts.
//   closest   two-way. The inbound score above merged with your own affinity
//             toward them, restricted to people who follow you.
//
// Presented separately and never summed into one "engagement" number, because
// they answer different questions and mixing them would let your own activity
// masquerade as theirs.

import { percent, round } from './util.js';

// A message is the baseline unit. Sending you a reel is a deliberate act aimed
// at you, so it outweighs a line of chat; opening a conversation outweighs both,
// because nothing prompted it.
const WEIGHTS = { message: 1, share: 3, opened: 4 };

// Sustained contact beats a single burst. Someone who wrote in eight different
// months is a fixture; someone with the same message count inside one week was
// a moment. The bonus is deliberately gentle — 6% per month, capped — so it
// orders people who are otherwise close together without letting an old,
// long-dormant thread outrank an active one.
const CONSISTENCY_PER_MONTH = 0.06;
const CONSISTENCY_CAP = 0.6;

/**
 * Resolve display names to Instagram handles.
 *
 * DM threads identify the other party by display name only — there is no handle
 * anywhere in a message file — so a fan row cannot become a profile link
 * without a name-to-handle mapping from somewhere else in the export.
 *
 * The follower and following lists are the obvious source and the weakest one:
 * Meta usually writes those as a bare handle link with no Name field at all.
 * The Owner blocks attached to liked posts, saved posts, story likes and
 * comments are far richer — each one pairs a Username with a Name — so they are
 * folded in too. Anyone you have ever interacted with becomes resolvable, which
 * covers most people who also message you.
 *
 * Names are not unique. When two accounts share one display name the mapping is
 * genuinely ambiguous, so it is dropped rather than guessed: a wrong link sends
 * the reader to a stranger's profile, which is worse than no link at all.
 */
function nameIndex(sources) {
  const seen = new Map();
  for (const person of sources) {
    if (!person?.name || !person?.u) continue;
    const key = String(person.name).trim().toLowerCase();
    if (!key) continue;
    const existing = seen.get(key);
    if (existing === null) continue;               // already known-ambiguous
    if (existing && existing !== person.u) {
      seen.set(key, null);                         // collision — unresolvable
      continue;
    }
    seen.set(key, person.u);
  }
  return seen;
}

export function fans(data, affinityResult) {
  const threads = data.messages?.threads ?? [];
  const selfIdentified = data.messages?.selfIdentified !== false;

  const followerSet = new Set(data.followers.map((p) => p.u.toLowerCase()));
  const followingSet = new Set(data.following.map((p) => p.u.toLowerCase()));
  const e = data.engagement;
  const handles = nameIndex([
    ...data.followers,
    ...data.following,
    ...e.likes, ...e.saved, ...e.storyLikes, ...e.comments, ...(e.likedComments ?? []),
  ]);

  // Group chats are excluded outright. `title` there is just whoever spoke
  // first, so every message from every participant would be attributed to one
  // arbitrary person.
  const direct = threads.filter((t) => !t.isGroup && t.title);

  const rows = direct.map((thread) => {
    const handle = handles.get(String(thread.title).trim().toLowerCase()) ?? null;
    const base =
      thread.received * WEIGHTS.message +
      thread.receivedShares * WEIGHTS.share +
      thread.openedByThem * WEIGHTS.opened;
    const consistency = Math.min(thread.inboundMonths * CONSISTENCY_PER_MONTH, CONSISTENCY_CAP);

    return {
      name: thread.title,
      u: handle,
      received: thread.received,
      shares: thread.receivedShares,
      openedByThem: thread.openedByThem,
      months: thread.inboundMonths,
      last: thread.inboundLast,
      requestOnly: thread.folder === 'message_requests',
      score: round(base * (1 + consistency), 1),
      followsYou: handle ? followerSet.has(handle.toLowerCase()) : null,
      youFollow: handle ? followingSet.has(handle.toLowerCase()) : null,
    };
  }).filter((row) => row.received > 0);

  rows.sort((a, b) => b.score - a.score);

  // The two-way view. Affinity is keyed by handle, so only people whose display
  // name resolved can appear here — stated in the UI rather than hidden.
  const affinityByHandle = new Map(
    (affinityResult?.engaged ?? []).map((c) => [c.u.toLowerCase(), c]),
  );
  const closest = rows
    .filter((row) => row.u && row.followsYou)
    .map((row) => {
      const mine = affinityByHandle.get(row.u.toLowerCase());
      return {
        ...row,
        yourScore: mine?.score ?? 0,
        yourInteractions: mine?.interactions ?? 0,
        combined: round(row.score + (mine?.score ?? 0), 1),
      };
    })
    .sort((a, b) => b.combined - a.combined);

  const resolved = rows.filter((row) => row.u).length;

  return {
    // Ranked inbound. Capped like every other people list in the tool.
    fans: rows.slice(0, 200),
    closest: closest.slice(0, 200),

    totals: {
      people: rows.length,
      resolved,
      // Honest coverage number: how many fan rows could be linked to a handle.
      resolvedPct: percent(resolved, rows.length),
      messagesIn: rows.reduce((s, r) => s + r.received, 0),
      sharesIn: rows.reduce((s, r) => s + r.shares, 0),
      openedByThem: rows.reduce((s, r) => s + r.openedByThem, 0),
      groupThreads: threads.filter((t) => t.isGroup).length,
      // People who wrote to you in three or more distinct months.
      consistent: rows.filter((r) => r.months >= 3).length,
    },

    // Set false when the export gave no display name for the account holder, in
    // which case `isMe` was false for every message and none of the above can be
    // trusted. The view refuses to render the ranking rather than show the
    // user's own messages back to them as fan mail.
    reliable: selfIdentified,
    weights: WEIGHTS,
  };
}
