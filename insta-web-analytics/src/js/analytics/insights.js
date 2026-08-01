// insights.js — creator stats, normalised for the view.
//
// The parser (parsers/insights.js) is deliberately permissive about where the
// numbers came from. This module decides what can be said about them: which
// ratios are safe to compute, and which are only meaningful when both of their
// inputs are actually present.
//
// Everything here is aggregate. There are no usernames in this data — for the
// per-person side see fans.js.

import { percent, round } from './util.js';

/**
 * A ratio, or null when either input is missing.
 *
 * Returning 0 for "no data" would be a lie the UI cannot tell apart from a real
 * zero, and these are exactly the numbers a creator would act on.
 */
function ratio(numerator, denominator) {
  if (typeof numerator !== 'number' || typeof denominator !== 'number' || !denominator) return null;
  return percent(numerator, denominator);
}

/**
 * The same, expressed as a multiple rather than a percentage.
 *
 * Used wherever the numerator can legitimately exceed the denominator, which
 * is most of these: impressions count repeat views, profile visits count
 * visits rather than visitors, and reach routinely runs past the follower count
 * because non-followers are reached too. Rendering those as "129%" invites the
 * reader to hunt for a bug that is not there; "1.29×" is the same number
 * saying what it means.
 */
function times(numerator, denominator) {
  if (typeof numerator !== 'number' || typeof denominator !== 'number' || !denominator) return null;
  return round(numerator / denominator, 2);
}

export function insights(data) {
  const raw = data.insights;
  if (!raw) return null;

  const n = (key) => (typeof raw[key] === 'number' ? raw[key] : null);

  const reach = n('reach');
  const impressions = n('impressions');
  const interactions = n('totalInteractions');
  const engaged = n('accountsEngaged');
  const profileVisits = n('profileVisits');

  // Story replies are the aggregate counterpart of the per-person inbound
  // ranking: the inbox shows *who* replied, this shows how many there were in
  // total, including anyone whose thread has since been deleted.
  const storyReplies = n('storyReplies');

  const followers = data.followers.length;

  return {
    period: raw.period ?? { start: null, end: null },

    metrics: {
      reach,
      impressions,
      profileVisits,
      totalInteractions: interactions,
      accountsEngaged: engaged,
      postLikes: n('postLikes'),
      postComments: n('postComments'),
      postSaves: n('postSaves'),
      postShares: n('postShares'),
      postInteractions: n('postInteractions'),
      storyInteractions: n('storyInteractions'),
      storyReplies,
      follows: n('follows'),
    },

    ratios: {
      // The one true share here: both sides count accounts, and the numerator
      // is a subset of the denominator, so a percentage is the honest form.
      engagementRate: ratio(engaged, reach),
      // How many times the average reached account saw you.
      frequency: times(impressions, reach),
      // Reach measured against the follower list this same export carries —
      // the one cross-check available between the two halves of the file.
      // Over 1× means you are reaching well beyond your own followers.
      reachVsFollowers: times(reach, followers),
      visitsPerReach: times(profileVisits, reach),
      interactionsPerReach: times(interactions, reach),
    },

    demographics: raw.demographics ?? { gender: [], age: [], cities: [], countries: [] },

    // Labels the parser found but could not classify. Surfaced rather than
    // dropped, so a metric this build does not know about is still visible.
    extra: raw.extra ?? [],
    sources: raw.sources ?? [],
    // False when nothing but unclassified rows came back — the view says so
    // instead of showing a wall of empty tiles.
    recognised: Object.values({
      reach, impressions, profileVisits, interactions, engaged, storyReplies,
    }).some((v) => v !== null),
  };
}
