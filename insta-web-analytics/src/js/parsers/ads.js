// ads.js — advertising exposure and the off-platform tracking footprint.

import { pickAll, nodes, nodesOf, field, ownerOf, when, iso, leafValues } from './common.js';

export function parseAds(files) {
  const adsViewed = nodesOf(pickAll(files, /ads_and_topics\/ads_viewed\.html$/i)).map((node) => ({
    at: iso(when(node)),
    u: ownerOf(node)?.u ?? null,
    title: field(node, 'Ad title') ?? null,
    libraryUrl: field(node, 'Ad library public URL') ?? null,
  }));

  // Each name is its own leaf block rather than a field value — the field
  // labels here are whole sentences describing the category, and the list
  // hangs beneath them. Both categories ("uploaded a list" and "matched from
  // your visit to their site") are merged: the question this answers is how
  // many advertisers hold data on the user, not how they obtained it.
  const namesFrom = (pattern) => {
    const found = new Set();
    for (const node of nodesOf(pickAll(files, pattern))) {
      for (const value of leafValues(node)) {
        const name = value.trim();
        if (name && name.length < 120) found.add(name);
      }
    }
    return [...found];
  };

  const advertisers = namesFrom(/advertisers_using_your_activity_or_information\.html$/i);
  const topics = namesFrom(/other_categories_used_to_reach_you\.html$/i);

  const seeLessTopics = nodesOf(pickAll(files, /see_less_topics\.html$/i)).map((node) => ({
    topic: node.heading ?? node.text.split('\n')[0] ?? null,
    at: iso(when(node)),
  }));

  const hiddenAds = nodesOf(pickAll(files, /ad_preferences\.html$/i)).length;

  // One file per business that sent the user's activity to Meta from outside
  // Instagram — the clearest measure of off-platform tracking reach.
  const offMeta = [];
  for (const { html } of pickAll(files, /your_activity_off_meta_technologies\/.+\.html$/i)) {
    for (const node of nodes(html)) {
      const app = node.heading;
      if (!app) continue;
      const events = [];
      const walk = (n) => {
        const kind = n.fields.get('Event');
        if (kind) events.push({ event: kind, at: iso(when(n, 'Received on')) });
        n.children.forEach(walk);
      };
      walk(node);
      offMeta.push({ app, events });
    }
  }

  return {
    adsViewed,
    advertisers: [...advertisers],
    topics: [...topics],
    seeLessTopics,
    hiddenAds,
    offMeta,
  };
}
