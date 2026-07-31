// attribution.js — which posts actually brought followers in.
//
// This is the derived stand-in for the like-based engagement rate the desktop
// app computes from the private API. The export has no like or view counts,
// but it does timestamp every follower and every publish, so the two can be
// joined: a post is credited with the followers who arrived after it.
//
// Two views are produced because they answer different questions:
//
//   windowGains — followers arriving within 24 h / 7 d of a post. Posts close
//                 together share credit, so these sum to more than the total.
//   lastTouch   — every follower credited to exactly one post, the most recent
//                 one before they arrived. Sums correctly; use it for ranking.
//
// Both are correlation, not proof: a follower may have arrived for reasons
// having nothing to do with the nearest post. `lift` compares each post
// against the account's own baseline rate so at least the ordinary drift is
// accounted for, and `confidence` flags when there is too little data to read
// anything into the numbers at all.

const HOUR = 36e5;
const DAY = 24 * HOUR;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function stamps(items) {
  return items
    .filter((x) => x.at)
    .map((x) => ({ ...x, t: Date.parse(x.at) }))
    .sort((a, b) => a.t - b.t);
}

export function attribution(data, { windowDays = 7 } = {}) {
  const posts = stamps(data.content.published);
  const followers = stamps(data.followers);

  if (!posts.length || !followers.length) {
    return { posts: [], baselinePerDay: 0, confidence: 'none', bestDay: null, bestHour: null, byType: [] };
  }

  // Baseline: the account's average acquisition rate over the observed span,
  // so a post is only "good" if it beat the account's ordinary drift.
  const spanStart = Math.min(posts[0].t, followers[0].t);
  const spanEnd = Math.max(posts.at(-1).t, followers.at(-1).t);
  const spanDays = Math.max(1, (spanEnd - spanStart) / DAY);
  const baselinePerDay = followers.length / spanDays;

  // Last-touch: walk followers forward, crediting the most recent prior post.
  const credit = new Map();
  let cursor = 0;
  for (const follower of followers) {
    while (cursor < posts.length && posts[cursor].t <= follower.t) cursor++;
    const previous = cursor - 1;
    if (previous < 0) continue;
    const post = posts[previous];
    if (follower.t - post.t > windowDays * DAY) continue;
    const bucket = credit.get(previous) ?? [];
    bucket.push(follower.u);
    credit.set(previous, bucket);
  }

  const rows = posts.map((post, i) => {
    const within = (ms) => followers.filter((f) => f.t >= post.t && f.t - post.t <= ms).length;
    const gained7d = within(windowDays * DAY);
    const expected = baselinePerDay * windowDays;
    return {
      at: post.at,
      type: post.type,
      caption: post.caption.slice(0, 120),
      place: post.place,
      hashtags: post.hashtags,
      mediaCount: post.mediaCount,
      gained24h: within(DAY),
      gained7d,
      lastTouch: credit.get(i)?.length ?? 0,
      lastTouchHandles: credit.get(i) ?? [],
      lift: Math.round((gained7d - expected) * 100) / 100,
    };
  });

  // Best slot by follower gain — the same question compute_engagement_report
  // answers with engagement rate, asked of the signal this data supports.
  const group = (keyOf) => {
    const buckets = new Map();
    for (const row of rows) {
      const key = keyOf(new Date(row.at));
      const bucket = buckets.get(key) ?? { key, posts: 0, gained: 0 };
      bucket.posts++;
      bucket.gained += row.lastTouch;
      buckets.set(key, bucket);
    }
    return [...buckets.values()]
      .map((b) => ({ ...b, perPost: Math.round((b.gained / b.posts) * 100) / 100 }))
      .sort((a, b) => b.perPost - a.perPost);
  };

  const byDay = group((d) => DAY_NAMES[d.getDay()]);
  const byHour = group((d) => d.getHours());

  const byType = [...rows.reduce((map, row) => {
    const bucket = map.get(row.type) ?? { type: row.type, posts: 0, gained: 0 };
    bucket.posts++;
    bucket.gained += row.lastTouch;
    return map.set(row.type, bucket);
  }, new Map()).values()].map((b) => ({ ...b, perPost: Math.round((b.gained / b.posts) * 100) / 100 }));

  /**
   * Rank an arbitrary property by followers gained per post.
   *
   * `keysOf` may return one key or several — a post carries several hashtags,
   * and each should get credit for the post it appeared on. `minPosts` keeps
   * one-off tags out of a ranking where a single follower would top the table.
   */
  const rank = (keysOf, minPosts = 1) => {
    const buckets = new Map();
    for (const row of rows) {
      for (const key of [].concat(keysOf(row) ?? [])) {
        if (key === null || key === undefined || key === '') continue;
        const bucket = buckets.get(key) ?? { key, posts: 0, gained: 0 };
        bucket.posts++;
        bucket.gained += row.lastTouch;
        buckets.set(key, bucket);
      }
    }
    return [...buckets.values()]
      .filter((b) => b.posts >= minPosts)
      .map((b) => ({ ...b, perPost: Math.round((b.gained / b.posts) * 100) / 100 }))
      .sort((a, b) => b.perPost - a.perPost || b.posts - a.posts);
  };

  const byHashtag = rank((r) => r.hashtags, 2);
  const byPlace = rank((r) => r.place, 1);
  // Bucketed rather than by exact count: "4 items" and "5 items" are the same
  // decision, and splitting them leaves every bucket too small to read.
  const byCarousel = rank((r) => (
    r.mediaCount <= 1 ? 'Single' : r.mediaCount <= 3 ? '2–3 items' : '4+ items'
  ));

  // Where you post most, against where posting actually works. When those
  // disagree it is the single most actionable line in the whole tab.
  const mostPosted = (list) => [...list].sort((a, b) => b.posts - a.posts)[0] ?? null;
  const timing = {
    // byDay/byHour arrive sorted by perPost, so [0] is already the best slot.
    hour: { posted: mostPosted(byHour), best: byHour[0] ?? null },
    day: { posted: mostPosted(byDay), best: byDay[0] ?? null },
  };
  timing.hour.aligned = timing.hour.posted?.key === timing.hour.best?.key;
  timing.day.aligned = timing.day.posted?.key === timing.day.best?.key;

  const attributed = rows.reduce((s, r) => s + r.lastTouch, 0);

  // Older half of your posting history against the newer half — the desktop
  // app's engagement_trend, asked of followers gained because that is the
  // outcome this data records. Needs enough posts either side to mean anything.
  const chronological = rows.slice().sort((a, b) => a.at.localeCompare(b.at));
  const mean = (list) => (list.length
    ? Math.round((list.reduce((s, r) => s + r.lastTouch, 0) / list.length) * 100) / 100
    : null);
  const half = Math.floor(chronological.length / 2);
  const olderAvg = mean(chronological.slice(0, half));
  const newerAvg = mean(chronological.slice(half));
  const trend = half >= 3 && olderAvg !== null && newerAvg !== null
    ? {
        olderAvg,
        newerAvg,
        olderCount: half,
        newerCount: chronological.length - half,
        change: Math.round((newerAvg - olderAvg) * 100) / 100,
        direction: newerAvg > olderAvg ? 'up' : newerAvg < olderAvg ? 'down' : 'flat',
        splitAt: chronological[half]?.at ?? null,
      }
    : null;

  // With a handful of followers the ranking is noise. Say so rather than
  // letting the UI present it as insight.
  const confidence = followers.length < 30 || posts.length < 5
    ? 'low'
    : followers.length < 200 ? 'medium' : 'high';

  return {
    posts: rows.sort((a, b) => b.lastTouch - a.lastTouch || b.lift - a.lift),
    timeline: rows.slice().sort((a, b) => a.at.localeCompare(b.at)),
    baselinePerDay: Math.round(baselinePerDay * 1000) / 1000,
    windowDays,
    attributed,
    unattributed: followers.length - attributed,
    bestDay: byDay[0] ?? null,
    bestHour: byHour[0] ?? null,
    byDay,
    byHour,
    byType: byType.sort((a, b) => b.perPost - a.perPost),
    // Named rather than left as "index 0 and the last one" — the desktop app
    // reports these as scalars and they read better on a tile.
    bestType: byType[0] ?? null,
    worstType: byType.length > 1 ? byType.at(-1) : null,
    byHashtag,
    byPlace,
    byCarousel,
    timing,
    trend,
    confidence,
    sample: { posts: posts.length, followers: followers.length },
  };
}
