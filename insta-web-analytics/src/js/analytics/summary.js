// summary.js — the export in a few sentences, plus one composite score.
//
// Everything here is derived from figures the other modules already computed.
// Nothing new is measured, and nothing is estimated: if an input is missing the
// sentence that would have used it is simply not written, rather than filled
// with a plausible number.
//
// The score deserves a word of caution, because a single number on a dial
// invites more trust than it has earned. It is a weighted blend of things this
// export can actually see, listed openly in `breakdown` and rendered as a
// table beside the dial. It is not an Instagram metric, it is not comparable
// between accounts, and the UI says so. The reason to have it at all is that it
// gives the dashboard somewhere to start; the reason to show its workings is
// that a number whose derivation is hidden is indistinguishable from one that
// was made up.

import { percent, round } from './util.js';

const clamp = (n, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

/** Score bounds, chosen to be obviously a scale rather than a percentage. */
export const SCORE_MIN = 300;
export const SCORE_MAX = 850;

const BANDS = [
  { from: 800, label: 'Exceptional' },
  { from: 740, label: 'Very good' },
  { from: 670, label: 'Good' },
  { from: 580, label: 'Fair' },
  { from: 0, label: 'Needs work' },
];

/**
 * Four things an export can honestly say about how an account is doing.
 *
 * Each returns 0-100, and each is skipped when its inputs are absent so a
 * missing section drags nothing down. Weights are relative, not absolute — the
 * total is renormalised over whichever components survived.
 */
function components(data, results) {
  const a = results.audience.insights;
  const af = results.affinity;
  const fn = results.fans;
  const out = [];

  // Reciprocity: how much of your following list follows back. A ratio, so it
  // works the same for 200 followers and 200,000.
  if (a.following > 0) {
    out.push({
      key: 'Reciprocity',
      weight: 3,
      value: clamp(a.mutualPercentage),
      detail: `${a.mutuals} mutuals — ${percent(a.mutuals, a.following)}% of the ${a.following} you follow`,
    });
  }

  // Reach into your own audience: the share of followers whose content you have
  // ever engaged with. The complement of "quiet followers".
  if (a.followers > 0) {
    out.push({
      key: 'Audience contact',
      weight: 2,
      value: clamp(100 - af.quietPct),
      detail: `${round(100 - af.quietPct, 1)}% of followers have appeared in something you did`,
    });
  }

  // Inbound: whether anyone actually talks to you, scaled against follower
  // count. Deliberately gentle — 2% of followers in your inbox is a lot.
  if (fn && a.followers > 0) {
    const rate = percent(fn.totals.people, a.followers);
    out.push({
      key: 'Inbound conversation',
      weight: 3,
      value: clamp(rate * 20),
      detail: `${fn.totals.people} people have messaged you (${rate}% of followers), ` +
        `${fn.totals.consistent} of them across three or more months`,
    });
  }

  // Attention spent on you versus attention sold against you. High ad share
  // means the feed you get is mostly paid.
  if (results.ads.adShareSample.ads + results.ads.adShareSample.organic > 0) {
    out.push({
      key: 'Feed quality',
      weight: 2,
      value: clamp(100 - results.ads.adShare * 2),
      detail: `${results.ads.adShare}% of what you were shown was an ad`,
    });
  }

  return out;
}

export function summary(data, results) {
  const parts = components(data, results);
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);

  const normalised = parts.map((p) => ({
    ...p,
    share: totalWeight ? round((p.weight / totalWeight) * 100, 1) : 0,
    contributes: totalWeight ? round((p.value * p.weight) / totalWeight, 1) : 0,
  }));

  const raw = normalised.reduce((s, p) => s + p.contributes, 0);
  const score = Math.round(SCORE_MIN + (raw / 100) * (SCORE_MAX - SCORE_MIN));
  const band = BANDS.find((b) => score >= b.from)?.label ?? 'Needs work';

  return {
    score,
    band,
    min: SCORE_MIN,
    max: SCORE_MAX,
    breakdown: normalised,
    // False when too little of the export parsed for the dial to mean anything.
    grounded: normalised.length >= 3,
    sentences: sentences(data, results),
  };
}

/**
 * The narrative block.
 *
 * Written as whole sentences rather than a template with holes, because a
 * sentence that reads "You follow 0 accounts and 0 follow you back" is worse
 * than no sentence. Each one is appended only when its numbers exist.
 */
function sentences(data, results) {
  const a = results.audience.insights;
  const af = results.affinity;
  const fn = results.fans;
  const out = [];
  const n = (x) => Number(x ?? 0).toLocaleString();

  if (a.followers || a.following) {
    out.push(
      `You have ${n(a.followers)} followers and follow ${n(a.following)} accounts back, ` +
      `${n(a.mutuals)} of them mutually.`,
    );
  }

  if (af.oneSidedCount) {
    out.push(
      `${n(af.oneSidedCount)} of the accounts you follow — ${af.oneSidedPct}% — have never produced ` +
      'a single like, comment, save or view from you.',
    );
  }

  if (fn?.totals.people) {
    out.push(
      `${n(fn.totals.people)} people have written to you, ${n(fn.totals.consistent)} of them across ` +
      'three or more separate months.',
    );
  }

  const ads = results.ads;
  if (ads.pressure?.oneInEvery) {
    const brand = ads.pressure.topBrand;
    out.push(
      `About one in every ${ads.pressure.oneInEvery} things Instagram showed you was an ad, from ` +
      `${n(ads.pressure.brands)} different brands` +
      (brand ? `, and ${brand.key} came back ${n(brand.count)} times` : '') + '.',
    );
  }

  if (results.insights?.metrics.reach) {
    out.push(
      `Your own posts reached ${n(results.insights.metrics.reach)} accounts in the period Instagram ` +
      `reported on, and ${n(results.insights.metrics.accountsEngaged ?? 0)} of them engaged.`,
    );
  }

  return out;
}
