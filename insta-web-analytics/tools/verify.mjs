// End-to-end verification: parse -> analyse -> snapshot -> history round-trip,
// including an assertion that no personal data reaches the exported file.
//
//   node tools/verify.mjs <export.zip | extracted-dir>
import { loadExport } from './load.mjs';
import { parseExport } from '../src/js/parsers/index.js';
import { analyse } from '../src/js/analytics/index.js';
import {
  buildSnapshot, mergeSnapshot, parseHistory, serializeHistory, historyToCsv, historyFilename,
} from '../src/js/history.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: node tools/verify.mjs <export.zip | extracted-dir>');
  process.exit(1);
}

let failures = 0;
const ok = (label, condition, detail = '') => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!condition) failures++;
};
const hr = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`);

const files = await loadExport(path);
const data = parseExport(files);
const results = analyse(data, null);

// ── record counts ──────────────────────────────────────────────────────────
hr('parsed counts');
const counts = {
  followers: data.followers.length,
  following: data.following.length,
  posts: data.content.posts.length,
  stories: data.content.stories.length,
  reels: data.content.reels.length,
  likes: data.engagement.likes.length,
  comments: data.engagement.comments.length,
  storiesViewed: data.consumption.storiesViewed.length,
  adsViewed: data.ads.adsViewed.length,
  advertisers: data.ads.advertisers.length,
  threads: data.messages.threads.length,
};
for (const [key, value] of Object.entries(counts)) {
  console.log(`  ${key.padEnd(16)} ${String(value).padStart(7)}`);
}

// ── analytics sanity ───────────────────────────────────────────────────────
hr('analytics invariants');
const a = results.audience.insights;
ok('mutuals + notFollowingBack === following', a.mutuals + a.notFollowingBack === a.following,
  `${a.mutuals} + ${a.notFollowingBack} = ${a.following}`);
ok('mutuals + fans === followers', a.mutuals + a.fans === a.followers,
  `${a.mutuals} + ${a.fans} = ${a.followers}`);
ok('no follower appears in fans and mutuals',
  !results.audience.fans.some((f) => results.audience.mutuals.some((m) => m.u === f.u)));
ok('acquisition curve is monotonic',
  results.audience.acquisition.every((p, i, arr) => i === 0 || p.cumulative >= arr[i - 1].cumulative));
ok('acquisition total === followers with dates',
  (results.audience.acquisition.at(-1)?.cumulative ?? 0) === data.followers.filter((f) => f.at).length);

const at = results.attribution;
ok('last-touch attribution never exceeds follower count',
  at.attributed <= data.followers.length, `${at.attributed} <= ${data.followers.length}`);
ok('attributed + unattributed === followers',
  at.attributed + at.unattributed === data.followers.length);
ok('attribution confidence is reported', Boolean(at.confidence), `confidence=${at.confidence}`);
ok('one-sided follows <= following', results.affinity.oneSidedCount <= data.following.length,
  `${results.affinity.oneSidedCount} of ${data.following.length}`);
ok('messages sent <= total', results.messages.totals.sent <= results.messages.totals.messages);
ok('privacy audit produced findings', results.privacy.findings.length > 0,
  `${results.privacy.findings.length} findings`);

// ── inbound engagement (fan followers) ─────────────────────────────────────
hr('fan followers — inbound only');
const fn = results.fans;
ok('the ranking is usable', fn.reliable,
  fn.reliable ? '' : 'no display name for the account holder');
ok('group threads are excluded from the ranking',
  fn.fans.every((r) => data.messages.threads.find((t) => t.title === r.name)?.isGroup !== true),
  `${fn.totals.groupThreads} group thread(s) set aside`);
ok('every fan actually sent something', fn.fans.every((r) => r.received > 0));
ok('fan scores descend', fn.fans.every((r, i) => i === 0 || fn.fans[i - 1].score >= r.score));
// The whole point of the module: nothing the user did may reach this score.
ok('score is inbound only',
  fn.fans.every((r) => r.score <= (r.received * fn.weights.message
    + r.shares * fn.weights.share + r.openedByThem * fn.weights.opened) * 1.61),
  `weights ${JSON.stringify(fn.weights)}`);
ok('display names resolve to handles where the export allows',
  fn.totals.resolved > 0, `${fn.totals.resolved}/${fn.totals.people} (${fn.totals.resolvedPct}%)`);
ok('an unresolvable name is left unlinked rather than guessed',
  fn.fans.some((r) => r.u === null), 'at least one name has no handle');
ok('two-way list is a subset of fans who follow you',
  fn.closest.every((r) => r.followsYou && r.u), `${fn.closest.length} account(s)`);
ok('combined score is their side plus yours',
  fn.closest.every((r) => Math.abs(r.combined - (r.score + r.yourScore)) < 0.11));

// ── narrative, score, ad pressure, passport ────────────────────────────────
hr('at a glance');
const sum = results.summary;
ok('the export is described in sentences', sum.sentences.length >= 3,
  `${sum.sentences.length} sentence(s)`);
ok('no sentence has an empty slot in it',
  sum.sentences.every((line) => !/undefined|null|NaN/.test(line)));
ok('the score sits inside its own scale',
  sum.score >= sum.min && sum.score <= sum.max, `${sum.score} of ${sum.min}-${sum.max}`);
ok('every score input is shown with its weight',
  sum.breakdown.every((b) => b.detail && b.share > 0), `${sum.breakdown.length} inputs`);
// Weights are renormalised over whatever survived, so they must still total 100
// — otherwise a missing section silently drags the score down.
ok('weights are renormalised over the inputs that exist',
  Math.abs(sum.breakdown.reduce((s, b) => s + b.share, 0) - 100) < 0.5,
  `${sum.breakdown.reduce((s, b) => s + b.share, 0)}%`);
ok('the score is the sum of the contributions',
  Math.abs(sum.score - (sum.min + (sum.breakdown.reduce((s, b) => s + b.contributes, 0) / 100)
    * (sum.max - sum.min))) < 1);

const pressure = results.ads.pressure;
ok('ad share and "one in every N" agree',
  pressure.oneInEvery === null
    || Math.abs((100 / results.ads.adShare) - pressure.oneInEvery) < 0.6,
  `${results.ads.adShare}% ≈ 1 in ${pressure.oneInEvery}`);
ok('daypart shares never exceed 100%',
  pressure.byDaypart.every((b) => b.count >= 0 && b.count <= 100));
ok('each daypart counts its ads within its total',
  pressure.byDaypart.every((b) => b.ads <= b.seen));

// The passport needs the ZIP central directory, which a directory load has no
// equivalent of — so synthesise one here purely to exercise the module.
const manifest = [...files].map(([name, text]) => ({ name, uncompressedSize: text.length }));
const withPassport = analyse(data, null, { manifest, files }).passport;
ok('the archive manifest is summarised', withPassport !== null,
  `${withPassport?.totals.entries} entries over ${withPassport?.totals.folders} folders`);
ok('folder file counts add up to the archive',
  withPassport.folders.reduce((s, f) => s + f.count, 0) === withPassport.totals.entries);
ok('absent files are named, not just counted',
  withPassport.missing.every((m) => m.file && m.needed),
  `${withPassport.totals.missing} missing`);
ok('the passport is omitted when there is no archive listing',
  analyse(data, null).passport === null);

// ── creator stats (professional accounts) ──────────────────────────────────
hr('reach & insights');
const ins = results.insights;
if (!ins) {
  ok('no creator stats, and none claimed', data.insights === null,
    'personal-account export — the Reach tab is dropped');
} else {
  ok('creator stats recognised', ins.recognised, `from ${ins.sources.length} file(s)`);
  ok('the reporting period is dated', Boolean(ins.period.start && ins.period.end),
    `${ins.period.start} → ${ins.period.end}`);
  ok('engagement rate is a real share', ins.ratios.engagementRate === null
    || (ins.ratios.engagementRate >= 0 && ins.ratios.engagementRate <= 100),
    `${ins.ratios.engagementRate}%`);
  // The bug this catches: expressing reach-vs-followers or visits-per-reach as
  // a percentage produces "14820%", which reads as broken rather than as
  // "you reach 148x your follower count".
  ok('open-ended ratios are multiples, not percentages',
    [ins.ratios.frequency, ins.ratios.reachVsFollowers, ins.ratios.visitsPerReach]
      .every((v) => v === null || v >= 0),
    `frequency ${ins.ratios.frequency}x, reach/followers ${ins.ratios.reachVsFollowers}x`);
  ok('a metric with no source is null, never zero',
    Object.values(ins.metrics).every((v) => v === null || typeof v === 'number'));
  ok('unmapped labels are kept rather than dropped', ins.extra.length > 0,
    `${ins.extra.length} unclassified value(s)`);
  ok('follower demographics parsed',
    ins.demographics.age.length > 0 && ins.demographics.cities.length > 0,
    `${ins.demographics.age.length} age bands, ${ins.demographics.cities.length} cities`);
  ok('demographic shares are percentages',
    [...ins.demographics.age, ...ins.demographics.gender]
      .every((row) => row.count >= 0 && row.count <= 100));

  // A personal account must lose the whole section, not render it empty.
  const withoutInsights = new Map(
    [...files].filter(([name]) => !/insight/i.test(name)),
  );
  ok('a personal-account export produces no insights at all',
    analyse(parseExport(withoutInsights), null).insights === null,
    `${files.size - withoutInsights.size} insight file(s) removed`);
}

// ── history round-trip ─────────────────────────────────────────────────────
hr('history round-trip');
const snapshot = buildSnapshot(data, results);
let history = mergeSnapshot(null, snapshot, data.profile.username);
const text = serializeHistory(history);
const reread = parseHistory(text);
ok('history parses back', reread.snapshots.length === 1);
ok('username preserved', reread.username === data.profile.username, reread.username);

// Re-importing the same export must not create a second data point.
history = mergeSnapshot(reread, buildSnapshot(data, results), data.profile.username);
ok('re-uploading the same export is a no-op', history.snapshots.length === 1,
  `${history.snapshots.length} snapshot(s)`);

const trendResults = analyse(data, history);
ok('trends inactive with one snapshot', trendResults.trends.available === false);

console.log(`  history size: ${(text.length / 1024).toFixed(1)} KB  (${historyFilename(data.profile.username)})`);
console.log(`  csv columns:  ${historyToCsv(history).split('\n')[0].split(',').length}`);

// ── privacy assertion ──────────────────────────────────────────────────────
hr('no personal data in the exported history');
// Only values distinctive enough to mean something are worth searching for.
// A coordinate of "15" or a two-digit port will match by chance inside a date
// or a count, which would make this check noise rather than a guarantee.
const distinctive = (value) => {
  const s = String(value ?? '');
  if (s.length < 6) return false;
  if (/^-?\d+$/.test(s)) return s.length >= 8;
  return true;
};

const secrets = [
  ['recovery email', data.profile.sensitive.email],
  ['phone number', data.profile.sensitive.phone],
  ['date of birth', data.profile.sensitive.dateOfBirth],
  ['signup IP', data.profile.sensitive.signupIp],
  ...data.security.uniqueIps.map((ip, i) => [`login IP ${i + 1}`, ip]),
  ...data.security.deviceIds.map((id, i) => [`device ID ${i + 1}`, id]),
  ...data.content.published
    .filter((m) => m.coords)
    .flatMap((m, i) => [
      [`GPS ${i + 1} lat`, m.coords.lat],
      [`GPS ${i + 1} lng`, m.coords.lng],
    ]),
  ...data.security.logins.map((l, i) => [`user agent ${i + 1}`, l.userAgent]),
].filter(([, value]) => distinctive(value));

let leaked = 0;
for (const [label, value] of secrets) {
  if (text.includes(String(value))) {
    console.log(`  FAIL  ${label} appears in the history file — "${value}"`);
    leaked++;
    failures++;
  }
}
ok(`${secrets.length} distinctive sensitive values checked, none present`, leaked === 0);

// Message bodies and contact numbers must not survive either.
ok('no synced contact numbers in history', !/\b[6-9]\d{9}\b/.test(text));

// The profile picture is read out of the ZIP and shown in the header. Neither
// the image nor the path to it may reach the file the user shares.
ok('profile photo path resolved', Boolean(data.profile.photoPath), data.profile.photoPath ?? 'none');
ok(
  'profile photo path absent from history',
  !data.profile.photoPath || !text.includes(data.profile.photoPath),
);
ok('no image data in history', !/\bdata:image\/|\bmedia\/other\//.test(text));

// ── the statistics ported from the desktop app ─────────────────────────────
hr('ported statistics');
const af = results.affinity;
ok('quiet followers computed', Array.isArray(af.quietFollowers),
  `${af.quietCount} of ${results.audience.insights.followers} (${af.quietPct}%)`);
ok('quiet followers never exceed followers', af.quietCount <= results.audience.insights.followers);
ok('quiet followers are all followers', (() => {
  const followers = new Set(data.followers.map((p) => p.u.toLowerCase()));
  return af.quietFollowers.every((p) => followers.has(p.u.toLowerCase()));
})());

ok('story responses parsed', af.storyResponseCount > 0, `${af.storyResponseCount} polls/quizzes/sliders`);
ok('recent interactions all carry a real permalink',
  af.recentLinks.length > 0 && af.recentLinks.every((r) => /^https:\/\/www\.instagram\.com\//.test(r.url)),
  `${af.recentLinks.length} links`);

ok('best and weakest format named', Boolean(at.bestType) && Boolean(at.worstType),
  `${at.bestType?.type} ${at.bestType?.perPost} vs ${at.worstType?.type} ${at.worstType?.perPost}`);
ok('best format really is the best', !at.worstType || at.bestType.perPost >= at.worstType.perPost);
ok('older-vs-newer trend computed', at.trend !== null,
  at.trend ? `${at.trend.olderAvg} -> ${at.trend.newerAvg} (${at.trend.direction})` : 'null');
ok('trend halves cover every post',
  !at.trend || at.trend.olderCount + at.trend.newerCount === at.posts.length);

// ── the newer breakdowns ───────────────────────────────────────────────────
// Invariants rather than fixed values, so these hold for the fixture and for
// any real account regardless of how it posts.
hr('post breakdowns');
const feedPosts = data.content.published.filter((m) => m.type !== 'story');
ok('carousel buckets account for every post',
  at.byCarousel.reduce((s, b) => s + b.posts, 0) === at.posts.length,
  `${at.byCarousel.map((b) => `${b.key}:${b.posts}`).join(' ')}`);
ok('carousel buckets are ranked by per-post',
  at.byCarousel.every((b, i) => i === 0 || at.byCarousel[i - 1].perPost >= b.perPost));
ok('place ranking never claims more posts than were geotagged',
  at.byPlace.every((p) => p.posts <= at.posts.length), `${at.byPlace.length} places`);
ok('hashtag ranking only keeps tags used more than once',
  at.byHashtag.every((t) => t.posts >= 2), `${at.byHashtag.length} rankable tags`);
ok('every ranked bucket gained no more than the total attributed',
  [...at.byPlace, ...at.byHashtag, ...at.byCarousel].every((b) => b.gained <= at.attributed));
ok('timing names both where you post and what works',
  Boolean(at.timing.hour.posted && at.timing.hour.best && at.timing.day.posted && at.timing.day.best),
  `posts ${at.timing.hour.posted?.key}h/${at.timing.day.posted?.key}, best ${at.timing.hour.best?.key}h/${at.timing.day.best?.key}`);
ok('most-posted really is the most posted',
  at.byHour.every((b) => b.posts <= at.timing.hour.posted.posts));

hr('cadence, discovery, sessions');
ok('posting gaps exclude stories', !results.content.gaps || feedPosts.length >= 2,
  results.content.gaps ? `median ${results.content.gaps.medianDays}d over ${feedPosts.length} posts` : 'too few posts');
ok('longest gap is at least the median',
  !results.content.gaps || results.content.gaps.longestDays >= results.content.gaps.medianDays);
ok('days since last post is never negative',
  !results.content.gaps || results.content.gaps.sinceLastDays >= 0);

const disc = results.consumption.discovery;
ok('suggested profiles parsed', disc.suggested > 0, `${disc.suggested} suggested`);
ok('rejection rate matches its inputs',
  disc.rejectionPct === null
    || Math.abs(disc.rejectionPct - (disc.dismissedProfiles / disc.suggested) * 100) < 0.11,
  `${disc.dismissedProfiles}/${disc.suggested} = ${disc.rejectionPct}%`);

const sess = results.privacy.sessions;
ok('sessions never run longer than a day',
  sess.longestSeconds === null || sess.longestSeconds <= 86400, `${sess.count} sessions`);
ok('median session is not longer than the longest',
  sess.medianSeconds === null || sess.medianSeconds <= sess.longestSeconds);
ok('notification preferences parsed',
  results.privacy.notifications.total > 0,
  `${results.privacy.notifications.off} off of ${results.privacy.notifications.total}`);
ok('checkout details raised as a finding',
  !data.profile.payment || results.privacy.findings.some((f) => /checkout/i.test(f.title)),
  data.profile.payment ? 'payment record present' : 'no payment record');
ok('checkout email never reaches the history file',
  !data.profile.payment?.email || !text.includes(data.profile.payment.email));

// ── chart axes fit the data (item 4) ───────────────────────────────────────
// Reproduces the tick maths so the regression is caught here rather than by
// eye: an axis whose top tick sits below the tallest bar is the defect.
hr('chart axis covers the data');
const niceTicks = (max, count = 4) => {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const steps = Math.max(1, Math.ceil(max / step - 1e-9));
  return Array.from({ length: steps + 1 }, (_, i) => Number((i * step).toFixed(6)));
};
const axisCovers = (max) => niceTicks(max).at(-1) >= max;
// `peakOf` in charts.js: the real max, falling back to 1 only when empty. The
// old `Math.max(...values, 1)` floored every fractional series at 1, which is
// what made the followers-per-post charts look frozen.
const peakOf = (values) => {
  const peak = Math.max(...values, 0);
  return peak > 0 ? peak : 1;
};
// niceTicks overshoots by less than half the max, so the tallest bar always
// fills more than 60% of the plot. A floored axis fails this badly (0.16/1).
const axisFits = (values) => {
  const peak = peakOf(values);
  return peak / niceTicks(peak).at(-1) > 0.6;
};

const perPost = at.byDay.map((d) => d.perPost);
const perPostMax = peakOf(perPost);
ok('weekday followers-per-post axis covers its max', axisCovers(perPostMax),
  `max ${perPostMax}, top tick ${niceTicks(perPostMax).at(-1)}`);
ok('weekday axis is not floored at 1', axisFits(perPost),
  `max ${perPostMax} fills ${Math.round((perPostMax / niceTicks(perPostMax).at(-1)) * 100)}% of the plot`);
ok('by-type axis is not floored at 1', axisFits(at.byType.map((t) => t.perPost)));
ok('an all-zero series still gets a usable axis', peakOf([0, 0, 0]) === 1);
ok('axis covers the max for a spread of values',
  [0.16, 0.33, 1, 7, 23, 99, 101, 1234, 0.007].every(axisCovers));
ok('axis fits the data across that spread',
  [0.16, 0.33, 1, 7, 23, 99, 101, 1234, 0.007].every((v) => axisFits([v])));
ok('ticks ascend from zero', (() => {
  const t2 = niceTicks(0.16);
  return t2[0] === 0 && t2.every((v, i) => i === 0 || v > t2[i - 1]);
})(), niceTicks(0.16).join(', '));

// ── two-snapshot trends ────────────────────────────────────────────────────
// Simulate the second upload: same account a month later, having gained two
// followers, lost one, and picked up a new advertiser.
hr('trends across two snapshots');
const later = structuredClone(snapshot);
later.generatedAt = '2026-08-31T12:01Z';
const dropped = later.followers.shift();
later.followers.push(
  { u: 'brand_new_one', at: '2026-08-02T10:00:00.000Z' },
  { u: 'brand_new_two', at: '2026-08-19T18:30:00.000Z' },
);
later.counts = { ...later.counts, followers: later.followers.length };
later.advertisers = [...later.advertisers, 'A Brand New Advertiser Ltd'];

const twoDeep = mergeSnapshot(history, later, data.profile.username);
ok('second snapshot stored', twoDeep.snapshots.length === 2);

const t = analyse(data, twoDeep).trends;
ok('trends now available', t.available === true, `${t.snapshots} snapshots`);

const churn = t.churn.at(-1);
ok('gained followers detected', churn.gained.length === 2, churn.gained.join(', '));
ok('lost follower detected', churn.lost.length === 1 && churn.lost[0] === dropped.u, churn.lost.join(', '));
ok('net change correct', churn.net === 1, `net ${churn.net}`);
ok('retention is the complement of churn',
  Math.abs(churn.retentionRate - (100 - churn.churnRate)) < 0.11,
  `churn ${churn.churnRate}% / retention ${churn.retentionRate}%`);
ok('per-snapshot follower totals recorded',
  churn.followersAfter === later.followers.length,
  `${churn.followersBefore} -> ${churn.followersAfter}`);

const followerSeries = t.metrics.find((m) => m.key === 'followers' && m.group === 'counts');
ok('average growth per upload computed',
  followerSeries.changePerSnapshot === followerSeries.changeTotal,
  `${followerSeries.changePerSnapshot}/upload over 1 interval`);
ok('nfbPercentage now has a trend line',
  t.metrics.some((m) => m.key === 'nfbPercentage'),
  t.metrics.filter((m) => m.group === 'ratios').map((m) => m.key).join(', '));

// A history file written before these keys existed must still load.
const legacy = structuredClone(twoDeep);
for (const s of legacy.snapshots) {
  delete s.ratios.nfbPercentage;
  delete s.ratios.quietFollowerPct;
}
let legacyOk = true;
try {
  const legacyTrends = analyse(data, parseHistory(serializeHistory(legacy))).trends;
  legacyOk = legacyTrends.available && !legacyTrends.metrics.some((m) => m.key === 'nfbPercentage');
} catch {
  legacyOk = false;
}
ok('history written before the new ratios still loads', legacyOk);
ok('new advertiser detected',
  t.newAdvertisers.includes('A Brand New Advertiser Ltd'), `${t.newAdvertisers.length} new`);

const followerMetric = t.metrics.find((m) => m.key === 'followers' && m.group === 'counts');
ok('follower metric series built', followerMetric?.points.length === 2,
  `${followerMetric?.first} -> ${followerMetric?.last} (change ${followerMetric?.change})`);
ok('CSV has one row per snapshot', historyToCsv(twoDeep).trim().split('\n').length === 3);

hr(failures ? `${failures} FAILURE(S)` : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
