// content.js — the user's own publishing behaviour.

import {
  countBy, ranked, chronological, monthOf, hourHistogram, weekdayHistogram,
  heatmap, streaks, median, percent, round,
} from './util.js';

export function content(data) {
  const { posts, stories, reels, published, deleted, live } = data.content;
  const all = published;

  const captionLengths = all.map((m) => m.caption.length).filter((n) => n > 0);
  const hashtags = ranked(countBy(all.flatMap((m) => m.hashtags.map((h) => ({ h }))), (x) => x.h), 30);
  const mentions = ranked(countBy(all.flatMap((m) => m.mentions.map((h) => ({ h }))), (x) => x.h), 20);

  const typeMix = ranked(countBy(all, (m) => m.type));

  // Month-by-month split per content type, for the stacked cadence chart.
  const months = [...new Set(all.map(monthOf).filter(Boolean))].sort();
  const cadence = months.map((month) => {
    const inMonth = all.filter((m) => monthOf(m) === month);
    return {
      month,
      total: inMonth.length,
      post: inMonth.filter((m) => m.kind === 'post').length,
      story: inMonth.filter((m) => m.kind === 'story').length,
      reel: inMonth.filter((m) => m.kind === 'reel').length,
    };
  });

  const geo = all
    .filter((m) => m.coords)
    .map((m) => ({ at: m.at, lat: m.coords.lat, lng: m.coords.lng, place: m.place, caption: m.caption.slice(0, 80) }));

  const places = ranked(countBy(all, (m) => m.place), 15);

  return {
    totals: {
      posts: posts.length,
      stories: stories.length,
      reels: reels.length,
      live: live.length,
      deleted: deleted.length,
      published: all.length,
      mediaFiles: data.content.mediaFileCount,
      carousels: posts.filter((p) => p.mediaCount > 1).length,
    },
    firstAt: all.length ? all.map((m) => m.at).sort()[0] : null,
    lastAt: all.length ? all.map((m) => m.at).sort().at(-1) : null,
    cadence,
    typeMix,
    byHour: hourHistogram(all),
    byWeekday: weekdayHistogram(all),
    heatmap: heatmap(all),
    streaks: streaks(all),
    captions: {
      withCaption: captionLengths.length,
      medianLength: median(captionLengths),
      longest: captionLengths.length ? Math.max(...captionLengths) : 0,
    },
    hashtags,
    mentions,
    geo,
    places,
    flags: {
      paidPartnership: all.filter((m) => m.paidPartnership).length,
      advertisement: all.filter((m) => m.isAd).length,
      aiGenerated: all.filter((m) => m.aiGenerated).length,
      audioMuted: all.filter((m) => m.audioMuted).length,
      geotagged: geo.length,
      geotaggedPct: percent(geo.length, all.length),
    },
    // Stories are ephemeral; how often they are reshares rather than original
    // material says something about how the account is actually used.
    storySources: ranked(countBy(stories, (s) => s.sourceType), 10),
    // Per ACTIVE month — `cadence` only contains months that have content, so
    // dividing by its length answers "how much do you post when you post",
    // not "per month". Both are given so the UI can label whichever it shows.
    perActiveMonth: cadence.length ? round(all.length / cadence.length, 1) : 0,
    activeMonths: cadence.length,
    elapsedMonths: months.length
      ? Math.max(1, Math.round(
        (Date.parse(`${months.at(-1)}-01`) - Date.parse(`${months[0]}-01`)) / 2629800000,
      ) + 1)
      : 0,
    monthlySeries: chronological(countBy(all, monthOf)),
  };
}
