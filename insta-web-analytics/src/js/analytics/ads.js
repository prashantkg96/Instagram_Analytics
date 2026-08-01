// ads.js — advertising exposure and off-platform tracking reach.

import { countBy, ranked, dailySeries, percent, round } from './util.js';
import { overlapOf, withinWindow } from '../parsers/common.js';

export function ads(data) {
  const { adsViewed, advertisers, topics, offMeta, seeLessTopics, hiddenAds } = data.ads;
  const { postsViewed, videosWatched, storiesViewed } = data.consumption;
  const cov = data.coverage ?? {};

  // Ad share has to be computed over the window all four sections share.
  // Instagram retains each for a different length of time — measured on a real
  // complete-timeline export, ads reached back 8 days and stories 31 — so
  // dividing raw totals answers "8 days of ads over a month of viewing" and
  // understates the true share several-fold.
  const window = overlapOf(cov.adsViewed, cov.storiesViewed, cov.postsViewed, cov.videosWatched);
  const inWindow = (rows) => (window ? withinWindow(rows, window.from, window.to) : rows);

  const adsInWindow = inWindow(adsViewed).length;
  const organicInWindow =
    inWindow(postsViewed).length + inWindow(videosWatched).length + inWindow(storiesViewed).length;

  const daily = dailySeries(adsViewed);
  const activeDays = daily.filter((d) => d.count > 0).length;

  const events = offMeta.flatMap((app) => app.events.map((e) => ({ ...e, app: app.app })));

  // ── ad pressure ──────────────────────────────────────────────────────────
  // Ad share as a percentage is easy to skim past. "One ad in every six things
  // you saw" is the same figure in a form that lands, so it is computed rather
  // than left for the reader to invert.
  const shown = adsInWindow + organicInWindow;
  const oneInEvery = adsInWindow ? round(shown / adsInWindow, 1) : null;

  // Brands in the ad log itself — distinct from `advertisers`, which is Meta's
  // list of companies holding your data. The two differ a lot: most brands that
  // actually served you an ad never appear on that list.
  const brandCounts = countBy(adsViewed, (a) => a.u);
  const onYourList = new Set(advertisers.map((a) => String(a).toLowerCase()));
  const brandsNotOnList = [...brandCounts.keys()]
    .filter((u) => !onYourList.has(String(u).toLowerCase())).length;

  // Ad density by time of day. The interesting number is not when you see the
  // most ads — that just tracks when you scroll — but when the largest SHARE of
  // what you see is paid.
  const BANDS = [
    { key: 'Morning', from: 6, to: 12 },
    { key: 'Afternoon', from: 12, to: 18 },
    { key: 'Evening', from: 18, to: 24 },
    { key: 'Late night', from: 0, to: 6 },
  ];
  const hourOfRow = (x) => (x.at ? new Date(x.at).getHours() : null);
  const organicRows = [...inWindow(postsViewed), ...inWindow(videosWatched), ...inWindow(storiesViewed)];
  const adRows = inWindow(adsViewed);
  const byDaypart = BANDS.map((band) => {
    const inBand = (rows) => rows.filter((x) => {
      const hour = hourOfRow(x);
      return hour !== null && hour >= band.from && hour < band.to;
    }).length;
    const paid = inBand(adRows);
    const organic = inBand(organicRows);
    return { key: band.key, count: percent(paid, paid + organic), ads: paid, seen: paid + organic };
  });
  const densest = [...byDaypart].sort((a, b) => b.count - a.count)[0] ?? null;

  return {
    totals: {
      adsViewed: adsViewed.length,
      advertisersWithYourData: advertisers.length,
      offMetaApps: offMeta.length,
      offMetaEvents: events.length,
      adTopics: topics.length,
      hiddenAds,
      seeLessTopics: seeLessTopics.length,
    },
    // How much of the feed was paid, over the window all the sections share.
    adShare: percent(adsInWindow, adsInWindow + organicInWindow),
    // The window the share applies to, so the UI can say so rather than let it
    // read as a lifetime figure.
    adShareWindow: window,
    adShareSample: { ads: adsInWindow, organic: organicInWindow },
    perDay: activeDays ? round(adsViewed.length / activeDays, 1) : 0,

    pressure: {
      // "1 in N things you saw was an ad." Null when the shared window holds
      // no ads at all, rather than a misleading Infinity.
      oneInEvery,
      brands: brandCounts.size,
      brandsNotOnList,
      // The single most repeated brand — concentration, not variety.
      topBrand: ranked(brandCounts, 1)[0] ?? null,
      byDaypart,
      densest,
    },

    daily,
    topAdvertiserAccounts: ranked(brandCounts, 25),
    advertisers,
    topics,
    offMeta: offMeta
      .map((app) => ({
        app: app.app,
        events: app.events.length,
        kinds: [...new Set(app.events.map((e) => e.event))],
        first: app.events.map((e) => e.at).filter(Boolean).sort()[0] ?? null,
        last: app.events.map((e) => e.at).filter(Boolean).sort().at(-1) ?? null,
      }))
      .sort((a, b) => b.events - a.events),
    offMetaEventKinds: ranked(countBy(events, (e) => e.event)),
  };
}
