// Produce a plausible "previous upload" history file, so the two-snapshot
// trend path can be exercised in the browser without waiting a month for a
// second real export.
//
//   node tools/make-prior-history.mjs <zip|dir> <out.json>
import { writeFile } from 'node:fs/promises';
import { loadExport } from './load.mjs';
import { parseExport } from '../src/js/parsers/index.js';
import { analyse } from '../src/js/analytics/index.js';
import { buildSnapshot, mergeSnapshot, serializeHistory } from '../src/js/history.js';

const [source, out] = process.argv.slice(2);
if (!source || !out) {
  console.error('usage: node tools/make-prior-history.mjs <zip|dir> <out.json>');
  process.exit(1);
}

const data = parseExport(await loadExport(source));
const snapshot = buildSnapshot(data, analyse(data, null));

// Back-date it and wind the account back a little, so the newer export reads
// as growth rather than as an identical duplicate.
snapshot.generatedAt = '2026-06-30T12:01Z';
snapshot.rangeEnd = '2026-06-30T11:57Z';
const removed = snapshot.followers.splice(0, 2).map((p) => p.u);
snapshot.following = snapshot.following.slice(0, -6);
snapshot.advertisers = snapshot.advertisers.slice(0, -40);
snapshot.counts = {
  ...snapshot.counts,
  followers: snapshot.followers.length,
  following: snapshot.following.length,
  advertisers: snapshot.advertisers.length,
  likes: Math.round(snapshot.counts.likes * 0.8),
  impressions: Math.round(snapshot.counts.impressions * 0.75),
  adsViewed: Math.round(snapshot.counts.adsViewed * 0.7),
};

await writeFile(out, serializeHistory(mergeSnapshot(null, snapshot, data.profile.username)));
console.log(`wrote ${out}`);
console.log(`  simulated previous snapshot at ${snapshot.generatedAt}`);
console.log(`  followers ${snapshot.counts.followers} (the newer export should show +${removed.length}: ${removed.join(', ')})`);
