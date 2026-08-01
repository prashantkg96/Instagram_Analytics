// Run the *bundled* worker from dist/instagram-analytics.html against a real
// export, so the module-graph rewrite in build.mjs is verified functionally
// and not merely by parsing.
//
//   node tools/test-bundle.mjs <export.zip>
import { readFile } from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const zipPath = process.argv[2];
if (!zipPath) {
  console.error('usage: node tools/test-bundle.mjs <export.zip>');
  process.exit(1);
}

const html = await readFile(join(ROOT, 'dist', 'instagram-analytics.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error('no inline script in the built file');

// Pull the worker source back out of the string constant the build embedded.
//
// The pattern must understand backslash escapes. A lazy `"[\s\S]*?"` stops at
// the first `";` it sees — and JSON.stringify turns any double-quoted string in
// the worker source into `\"…\"`, so a single line like `carry "on"/"off";`
// inside a comment truncated the match and produced an unterminated literal.
// `(?:[^"\\]|\\.)*` skips escaped characters, which is the actual grammar of a
// JSON string.
const workerSource = new Function(
  `${script.match(/const BUNDLED_WORKER = ("(?:[^"\\]|\\.)*");/)[0]}\nreturn BUNDLED_WORKER;`,
)();
console.log(`worker bundle: ${(workerSource.length / 1024).toFixed(0)} KB`);

// Minimal worker-global shim: the bundle only touches self.onmessage,
// self.postMessage and performance.
const messages = [];
const shim = {
  onmessage: null,
  postMessage: (m) => messages.push(m),
  location: { href: 'file:///' },
};

new Function('self', 'performance', workerSource)(shim, performance);
if (typeof shim.onmessage !== 'function') throw new Error('bundled worker never registered onmessage');

const done = new Promise((resolve, reject) => {
  const timer = setInterval(() => {
    const last = messages.at(-1);
    if (last?.type === 'done') { clearInterval(timer); resolve(last); }
    if (last?.type === 'error') { clearInterval(timer); reject(new Error(last.message)); }
  }, 25);
  setTimeout(() => { clearInterval(timer); reject(new Error('timed out')); }, 120000);
});

await shim.onmessage({ data: { file: await openAsBlob(zipPath), historyText: null } });
const result = await done;

const progress = messages.filter((m) => m.type === 'progress');
console.log(`progress messages: ${progress.length} (last: "${progress.at(-1)?.label}")`);
console.log(`processed in ${result.stats.ms}ms — ${result.stats.files} files, ${result.stats.skippedMedia} media skipped`);

const checks = [
  ['summary carries the username', Boolean(result.summary.profile.username)],
  ['audience computed', result.results.audience.insights.followers > 0],
  ['attribution computed', typeof result.results.attribution.attributed === 'number'],
  ['content computed', result.results.content.totals.published > 0],
  ['affinity computed', result.results.affinity.totalCreators > 0],
  ['consumption computed', result.results.consumption.totals.impressions > 0],
  ['ads computed', result.results.ads.totals.advertisersWithYourData > 0],
  ['messages computed', result.results.messages.totals.threads > 0],
  ['privacy findings', result.results.privacy.findings.length > 0],
  ['history built', result.history.snapshots.length === 1],
  ['no sensitive keys in history', !JSON.stringify(result.history).includes('sensitive')],
  // The avatar is the only binary taken out of the archive; the bundled build
  // has to reach it through the same rewritten module graph as everything else.
  ['profile photo extracted', result.avatar?.bytes?.length > 0],
  ['profile photo typed as an image', /^image\//.test(result.avatar?.type ?? '')],
];

let bad = 0;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (!pass) bad++;
}
console.log(bad ? `\n${bad} FAILURE(S)` : '\nBUNDLED WORKER OK');
process.exit(bad ? 1 : 0);
