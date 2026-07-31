// Flag imported bindings that are never referenced, and exported names that
// nothing imports. Not a real linter — just enough to keep the module graph
// honest without adding a toolchain.
//
//   node tools/lint-imports.mjs
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src');

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (full.endsWith('.js')) yield full;
  }
}

const IMPORT = /^import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
const EXPORT_DECL = /^export\s+(?:async\s+function|function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^export\s*\{([\s\S]*?)\};?[ \t]*$/gm;

const files = [];
for await (const f of walk(SRC)) files.push(f);

const imported = new Map();
let problems = 0;

for (const file of files) {
  const source = await readFile(file, 'utf8');
  const rel = relative(SRC, file).split(sep).join('/');
  const body = source.replace(IMPORT, '');

  for (const match of source.matchAll(IMPORT)) {
    const target = relative(SRC, normalize(join(dirname(file), match[2]))).split(sep).join('/');
    for (const raw of match[1].split(',')) {
      const entry = raw.trim();
      if (!entry) continue;
      const local = (entry.split(/\s+as\s+/)[1] ?? entry).trim();
      const original = entry.split(/\s+as\s+/)[0].trim();
      (imported.get(target) ?? imported.set(target, new Set()).get(target)).add(original);

      if (!new RegExp(`\\b${local}\\b`).test(body)) {
        console.log(`  UNUSED IMPORT  ${rel}: "${local}" from ${match[2]}`);
        problems++;
      }
    }
  }
}

for (const file of files) {
  const source = await readFile(file, 'utf8');
  const rel = relative(SRC, file).split(sep).join('/');
  if (rel === 'js/main.js' || rel === 'js/worker.js' || rel === 'sw.js') continue;

  const names = new Set();
  for (const m of source.matchAll(EXPORT_DECL)) names.add(m[1]);
  for (const m of source.matchAll(EXPORT_LIST)) {
    for (const raw of m[1].split(',')) {
      const entry = raw.trim();
      if (entry) names.add((entry.split(/\s+as\s+/)[1] ?? entry).trim());
    }
  }
  const used = imported.get(rel) ?? new Set();
  for (const name of names) {
    if (!used.has(name)) console.log(`  unused export   ${rel}: "${name}"`);
  }
}

console.log(problems ? `\n${problems} unused import(s)` : '\nno unused imports');
process.exit(problems ? 1 : 0);
