// ads.js — advertising exposure and off-platform tracking reach.

import { countBy, ranked, dailySeries, percent, round } from './util.js';

export function ads(data) {
  const { adsViewed, advertisers, topics, offMeta, seeLessTopics, hiddenAds } = data.ads;
  const organic =
    data.consumption.postsViewed.length +
    data.consumption.videosWatched.length +
    data.consumption.storiesViewed.length;

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
    // How much of the feed was paid. Both figures come from the same export
    // window, so the ratio is meaningful even though neither is a full census.
    adShare: percent(adsViewed.length, adsViewed.length + organic),
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
