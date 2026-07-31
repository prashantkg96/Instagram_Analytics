// consumption.js — how much the user watches, and when.
//
// The export logs every reel, story and post impression with a timestamp,
// which is the closest thing to screen-time data available offline. There is
// no duration on any impression, so "time spent" is never claimed — only
// volume, timing and shape.

import {
  countBy, ranked, dailySeries, hourHistogram, heatmap, median, percent, round, dayOf,
} from './util.js';

/** Local hours counted as late night. */
const LATE_NIGHT = new Set([0, 1, 2, 3, 4]);

export function consumption(data) {
  const { storiesViewed, postsViewed, videosWatched, searches, linkHistory, notInterestedPosts } =
    data.consumption;

  const impressions = [...storiesViewed, ...postsViewed, ...videosWatched];
  const daily = dailySeries(impressions);
  const counts = daily.map((d) => d.count);
  const activeDays = daily.filter((d) => d.count > 0).length;

  const lateNight = impressions.filter((x) => x.at && LATE_NIGHT.has(new Date(x.at).getHours()));
  const busiest = [...daily].sort((a, b) => b.count - a.count)[0] ?? null;

  const hashtags = ranked(
    countBy(impressions.flatMap((x) => x.hashtags.map((h) => ({ h }))), (x) => x.h),
    40,
  );

  const dwell = linkHistory.filter((l) => l.seconds !== null);

  return {
    totals: {
      impressions: impressions.length,
      stories: storiesViewed.length,
      posts: postsViewed.length,
      videos: videosWatched.length,
      notInterested: notInterestedPosts.length,
      searches: searches.length,
      links: linkHistory.length,
    },
    daily,
    // Median rather than mean: a handful of binge days would otherwise make
    // a typical day look far busier than it is.
    perActiveDay: {
      median: median(counts.filter((c) => c > 0)),
      mean: activeDays ? round(impressions.length / activeDays, 1) : 0,
      max: busiest?.count ?? 0,
      maxDay: busiest?.key ?? null,
    },
    activeDays,
    coveragePct: daily.length ? percent(activeDays, daily.length) : 0,
    byHour: hourHistogram(impressions),
    heatmap: heatmap(impressions),
    lateNight: {
      count: lateNight.length,
      pct: percent(lateNight.length, impressions.length),
      days: new Set(lateNight.map(dayOf)).size,
    },
    topCreators: ranked(countBy(impressions, (x) => x.u), 30),
    hashtags,
    searches,
    links: {
      total: linkHistory.length,
      hosts: ranked(countBy(linkHistory, (l) => l.host), 15),
      totalSeconds: dwell.reduce((s, l) => s + l.seconds, 0),
      medianSeconds: median(dwell.map((l) => l.seconds)),
    },
  };
}
