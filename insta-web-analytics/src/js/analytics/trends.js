// trends.js — change across uploaded snapshots.
//
// Everything here needs at least two snapshots, which means the user must have
// downloaded the history file after a previous run. With one snapshot the tool
// still works; this tab simply explains what a second upload would add.

import { diffPeople } from './audience.js';

const setOf = (list) => new Set(list ?? []);

/** One row per metric, with its value at each snapshot. */
function series(snapshots, group) {
  const keys = new Set();
  for (const snapshot of snapshots) for (const key of Object.keys(snapshot[group] ?? {})) keys.add(key);

  return [...keys].sort().map((key) => {
    const points = snapshots.map((s) => ({
      at: s.generatedAt,
      value: s[group]?.[key] ?? null,
    }));
    const known = points.filter((p) => p.value !== null);
    const first = known[0]?.value ?? null;
    const last = known.at(-1)?.value ?? null;
    const previous = known.length > 1 ? known.at(-2).value : null;
    const changeTotal = last !== null && first !== null ? Math.round((last - first) * 100) / 100 : null;
    return {
      key,
      group,
      points,
      first,
      last,
      change: last !== null && previous !== null ? Math.round((last - previous) * 100) / 100 : null,
      changeTotal,
      // Movement per upload rather than in total: the headline "am I growing?"
      // number, and the only one that stays comparable as snapshots accumulate.
      changePerSnapshot: changeTotal !== null && known.length > 1
        ? Math.round((changeTotal / (known.length - 1)) * 100) / 100
        : null,
    };
  });
}

export function trends(history) {
  const snapshots = [...(history?.snapshots ?? [])].sort((a, b) =>
    String(a.generatedAt).localeCompare(String(b.generatedAt)),
  );

  if (snapshots.length < 2) {
    return {
      available: false,
      snapshots: snapshots.length,
      metrics: [],
      churn: [],
      newAdvertisers: [],
      newOffMetaApps: [],
    };
  }

  // Follower movement between each consecutive pair. Names are available
  // because the history file keeps handles in plain text.
  const churn = [];
  for (let i = 1; i < snapshots.length; i++) {
    const before = snapshots[i - 1];
    const after = snapshots[i];
    const followers = diffPeople(after.followers ?? [], before.followers ?? []);
    const following = diffPeople(after.following ?? [], before.following ?? []);
    churn.push({
      from: before.generatedAt,
      to: after.generatedAt,
      gained: followers.gained.map((p) => p.u),
      lost: followers.lost.map((p) => p.u),
      startedFollowing: following.gained.map((p) => p.u),
      stoppedFollowing: following.lost.map((p) => p.u),
      net: followers.gained.length - followers.lost.length,
      netFollowing: following.gained.length - following.lost.length,
      followersBefore: before.followers?.length ?? 0,
      followersAfter: after.followers?.length ?? 0,
      followingAfter: after.following?.length ?? 0,
      churnRate: before.followers?.length
        ? Math.round((followers.lost.length / before.followers.length) * 1000) / 10
        : 0,
      // The complement of churn, stated rather than left to the reader — how
      // much of the audience that existed at `from` was still there at `to`.
      retentionRate: before.followers?.length
        ? Math.round(((before.followers.length - followers.lost.length) / before.followers.length) * 1000) / 10
        : 0,
    });
  }

  const firstAdvertisers = setOf(snapshots[0].advertisers);
  const latestAdvertisers = setOf(snapshots.at(-1).advertisers);
  const firstApps = setOf(snapshots[0].offMetaApps);
  const latestApps = setOf(snapshots.at(-1).offMetaApps);

  return {
    available: true,
    snapshots: snapshots.length,
    span: { from: snapshots[0].generatedAt, to: snapshots.at(-1).generatedAt },
    metrics: [...series(snapshots, 'counts'), ...series(snapshots, 'ratios')],
    churn,
    // Companies that acquired your data since the first snapshot — one of the
    // few genuinely new things a second upload reveals.
    newAdvertisers: [...latestAdvertisers].filter((a) => !firstAdvertisers.has(a)),
    goneAdvertisers: [...firstAdvertisers].filter((a) => !latestAdvertisers.has(a)),
    newOffMetaApps: [...latestApps].filter((a) => !firstApps.has(a)),
  };
}
