// Shared loader for the Node-side tools: reads either a ZIP or an already
// extracted export directory into the same Map<path, text> the browser builds.
import { openAsBlob } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { extractText, isDataFile } from '../src/js/unzip.js';

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

export async function loadExport(path) {
  const info = await stat(path);
  if (info.isFile()) {
    return extractText(await openAsBlob(path), { include: isDataFile });
  }
  const files = new Map();
  for await (const full of walk(path)) {
    const rel = relative(path, full).split(sep).join('/');
    if (!isDataFile(rel)) continue;
    files.set(rel, await readFile(full, 'utf8'));
  }
  return files;
}
