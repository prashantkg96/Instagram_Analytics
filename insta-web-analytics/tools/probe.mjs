// Structural probe: prints the shape of each export file so parsers can be
// written against reality rather than assumption.
//   node tools/probe.mjs <extracted-export-dir> [pathFilter]
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { records, parseRecord, readHeader } from '../src/js/scan.js';

const root = process.argv[2];
const filter = process.argv[3];
if (!root) {
  console.error('usage: node tools/probe.mjs <extracted-export-dir> [pathFilter]');
  process.exit(1);
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function shape(node, depth = 0, out = [], path = '') {
  const labels = [...node.fields.keys()];
  if (labels.length || node.heading) {
    out.push(
      `${'  '.repeat(depth)}${node.heading ? `[h2 ${node.heading}] ` : ''}${labels.join(', ') || '(no fields)'}`,
    );
  }
  if (depth < 4) node.children.slice(0, 2).forEach((c) => shape(c, depth + 1, out, path));
  return out;
}

const files = [];
for await (const f of walk(root)) {
  const rel = relative(root, f).split(sep).join('/');
  if (!/\.html$/i.test(rel)) continue;
  if (rel.startsWith('media/') || rel.startsWith('files/')) continue;
  if (filter && !rel.includes(filter)) continue;
  files.push([rel, f]);
}
files.sort();

for (const [rel, full] of files) {
  const size = (await stat(full)).size;
  const html = await readFile(full, 'utf8');
  const recs = records(html);
  const head = readHeader(html);
  console.log('\n' + '='.repeat(78));
  console.log(`${rel}  (${(size / 1024).toFixed(0)} KB, ${recs.length} records)`);
  console.log(`  title="${head.title}"  generated=${head.generatedAt}`);
  if (!recs.length) continue;
  const first = parseRecord(recs[0]);
  for (const line of shape(first)) console.log('  ' + line);
  const links = first.links.slice(0, 2);
  if (links.length) console.log('  links: ' + links.join(' | '));
  const txt = first.text.replace(/\n/g, ' ⏎ ').slice(0, 150);
  console.log('  text: ' + txt);
}
