// audience.js — follower/following relationships.
//
// The set operations are a direct port of analytics.py (get_not_following_back,
// get_you_dont_follow_back, get_mutual_followers, get_unfollowers,
// get_new_followers, compute_account_insights) so results match the desktop
// app exactly. Keying is by handle rather than the numeric user_id the scraper
// had, because the export never exposes user IDs.

const by = (list) => new Set(list.map((p) => p.u));
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/** Port of analytics.py's set comparisons. */
export function relationships(followers, following) {
  const followerSet = by(followers);
  const followingSet = by(following);
  return {
    notFollowingBack: following.filter((p) => !followerSet.has(p.u)),
    fans: followers.filter((p) => !followingSet.has(p.u)),
    mutuals: following.filter((p) => followerSet.has(p.u)),
  };
}

/** Who arrived and who left between two snapshots. */
export function diffPeople(current, previous) {
  const now = by(current);
  const before = by(previous);
  return {
    gained: current.filter((p) => !before.has(p.u)),
    lost: previous.filter((p) => !now.has(p.u)),
  };
}

/**
 * When the *current* followers arrived.
 *
 * This is survivorship-biased and must be labelled as such in the UI: people
 * who followed and later left are simply not in the export, so this is "how
 * many of today's followers had joined by month X", not a true historical
 * follower count. It is still a real lower bound, and it is the only growth
 * shape recoverable from a single upload.
 */
export function acquisitionByMonth(people) {
  const buckets = new Map();
  for (const person of people) {
    if (!person.at) continue;
    const key = person.at.slice(0, 7);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const months = [...buckets.keys()].sort();
  let running = 0;
  return months.map((month) => {
    running += buckets.get(month);
    return { month, added: buckets.get(month), cumulative: running };
  });
}

/**
 * Of the followers acquired in each month, how many are still here.
 *
 * From one export every survivor is present by definition, so retention reads
 * 100%. It only becomes meaningful once a second snapshot supplies the people
 * who have since left, which is why `priorFollowers` is threaded through.
 */
export function cohortRetention(followers, priorFollowers = []) {
  const stillHere = by(followers);
  const everSeen = new Map();
  for (const person of [...priorFollowers, ...followers]) {
    if (person.at && !everSeen.has(person.u)) everSeen.set(person.u, person.at.slice(0, 7));
  }
  const cohorts = new Map();
  for (const [handle, month] of everSeen) {
    const row = cohorts.get(month) ?? { month, joined: 0, retained: 0 };
    row.joined++;
    if (stillHere.has(handle)) row.retained++;
    cohorts.set(month, row);
  }
  return [...cohorts.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => ({ ...row, rate: pct(row.retained, row.joined) }));
}

/**
 * For mutuals, the gap between them following and you following back.
 *
 * Both dates exist in the export, which makes this measurable: a negative lag
 * means you followed first. Same-second pairs are follow-backs made from the
 * notification, and they are called out separately because they say something
 * different from a considered follow days later.
 */
export function reciprocity(followers, following) {
  const followedYou = new Map(followers.filter((p) => p.at).map((p) => [p.u, Date.parse(p.at)]));
  const rows = [];
  for (const person of following) {
    if (!person.at) continue;
    const theirs = followedYou.get(person.u);
    if (theirs === undefined) continue;
    rows.push({
      u: person.u,
      lagHours: Math.round((Date.parse(person.at) - theirs) / 36e5),
      youFirst: Date.parse(person.at) < theirs,
    });
  }
  rows.sort((a, b) => a.lagHours - b.lagHours);
  const lags = rows.map((r) => r.lagHours).sort((a, b) => a - b);
  return {
    rows,
    medianLagHours: lags.length ? lags[lags.length >> 1] : null,
    instant: rows.filter((r) => Math.abs(r.lagHours) < 1).length,
    youFirst: rows.filter((r) => r.youFirst).length,
  };
}

export function audience(data, previous) {
  const { followers, following } = data;
  const rel = relationships(followers, following);

  const insights = {
    followers: followers.length,
    following: following.length,
    mutuals: rel.mutuals.length,
    fans: rel.fans.length,
    notFollowingBack: rel.notFollowingBack.length,
    // Same five ratios compute_account_insights produces.
    followerFollowingRatio: following.length
      ? Math.round((followers.length / following.length) * 100) / 100
      : 0,
    followBackRate: pct(rel.mutuals.length, following.length),
    fanPercentage: pct(rel.fans.length, followers.length),
    mutualPercentage: pct(rel.mutuals.length, followers.length),
    nfbPercentage: pct(rel.notFollowingBack.length, following.length),
  };

  let change = null;
  if (previous?.followers) {
    const followerDiff = diffPeople(followers, previous.followers);
    const followingDiff = diffPeople(following, previous.following ?? []);
    change = {
      newFollowers: followerDiff.gained,
      unfollowers: followerDiff.lost,
      newlyFollowing: followingDiff.gained,
      youUnfollowed: followingDiff.lost,
      churnRate: pct(followerDiff.lost.length, previous.followers.length),
      retentionRate: 100 - pct(followerDiff.lost.length, previous.followers.length),
    };
  }

  return {
    ...rel,
    insights,
    change,
    acquisition: acquisitionByMonth(followers),
    followingByMonth: acquisitionByMonth(following),
    // Only meaningful once a previous snapshot supplies the people who left.
    // From one upload every survivor is present by definition, so it reads
    // 100% for every cohort — 59 rows of noise dressed as a finding.
    cohorts: previous?.followers?.length ? cohortRetention(followers, previous.followers) : [],
    // A spliced export's follower list is only those gained inside the window,
    // so the set comparisons above are not like-for-like. The UI must say so.
    spliced: Boolean(data.meta?.spliced),
    reciprocity: reciprocity(followers, following),
    // Departures Instagram records directly, independent of any snapshot.
    recentlyUnfollowed: data.unfollowed,
    blocked: data.blocked,
    followRequests: data.followRequests,
  };
}
