// Smoke test for the ZIP reader against a real export.
//   node tools/smoke-unzip.mjs <path-to-export.zip>
import { openAsBlob } from 'node:fs';
import { extractText, listEntries, isDataFile } from '../src/js/unzip.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: node tools/smoke-unzip.mjs <export.zip>');
  process.exit(1);
}

const zip = await openAsBlob(path);
console.log('zip size:', (zip.size / 1048576).toFixed(1), 'MB');

let t = performance.now();
const all = await listEntries(zip);
console.log(`entries: ${all.length} (${(performance.now() - t).toFixed(0)}ms to read central directory)`);
console.log('compression methods present:', [...new Set(all.map((e) => e.method))].join(', '));

const wanted = all.filter((e) => isDataFile(e.name));
const mb = (n) => (n / 1048576).toFixed(1);
console.log(
  `data files: ${wanted.length} = ${mb(wanted.reduce((s, e) => s + e.uncompressedSize, 0))} MB uncompressed`,
);
console.log(
  `skipped:    ${all.length - wanted.length} = ${mb(
    all.filter((e) => !isDataFile(e.name)).reduce((s, e) => s + e.uncompressedSize, 0),
  )} MB of media never read`,
);

t = performance.now();
const files = await extractText(zip, { include: isDataFile });
console.log(`extracted ${files.size} files in ${((performance.now() - t) / 1000).toFixed(1)}s`);

const big = 'your_instagram_activity/story_interactions/stories_viewed.html';
console.log('stories_viewed.html chars:', files.get(big)?.length.toLocaleString() ?? 'MISSING');
const followers = files.get('connections/followers_and_following/followers_1.html');
console.log('followers_1.html chars: ', followers?.length.toLocaleString() ?? 'MISSING');
console.log('peak RSS:', (process.memoryUsage().rss / 1048576).toFixed(0), 'MB');
