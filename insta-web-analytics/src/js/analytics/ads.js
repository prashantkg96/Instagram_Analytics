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
    daily,
    topAdvertiserAccounts: ranked(countBy(adsViewed, (a) => a.u), 25),
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
