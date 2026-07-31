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
ok('new advertiser detected',
  t.newAdvertisers.includes('A Brand New Advertiser Ltd'), `${t.newAdvertisers.length} new`);

const followerMetric = t.metrics.find((m) => m.key === 'followers' && m.group === 'counts');
ok('follower metric series built', followerMetric?.points.length === 2,
  `${followerMetric?.first} -> ${followerMetric?.last} (change ${followerMetric?.change})`);
ok('CSV has one row per snapshot', historyToCsv(twoDeep).trim().split('\n').length === 3);

hr(failures ? `${failures} FAILURE(S)` : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
