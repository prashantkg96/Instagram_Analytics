// build.mjs — emit dist/instagram-analytics.html: one self-contained file that
// opens straight from disk, with no server and no network.
//
// This is not a bundler in the npm sense — no dependencies, no node_modules,
// nothing to install. It walks the ES module graph from two entry points and
// wraps each module in an IIFE registered in a small map, rewriting imports
// into destructuring assignments. That is needed because a `file://` document
// cannot use ES modules or a module Worker: both are blocked by the opaque
// origin. The worker is inlined as a string and started from a Blob URL, which
// is the one form that does work there.
//
//   node build.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'dist');

const key = (absolute) => relative(SRC, absolute).split(sep).join('/');

const IMPORT = /^import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
const EXPORT_LIST = /^export\s*\{([\s\S]*?)\};?[ \t]*$/gm;
const EXPORT_DECL = /^export\s+(async\s+function|function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;

/** Read a module, collect its dependencies, and rewrite it into an IIFE body. */
async function loadModule(absolute) {
  let source = await readFile(absolute, 'utf8');
  const deps = [];
  const exported = new Set();

  // `export { a, b as c };` — record the external names, drop the statement.
  source = source.replace(EXPORT_LIST, (_, names) => {
    for (const entry of names.split(',')) {
      const parts = entry.trim().split(/\s+as\s+/);
      if (parts[0]) exported.add((parts[1] ?? parts[0]).trim());
    }
    return '';
  });

  for (const match of source.matchAll(EXPORT_DECL)) exported.add(match[2]);
  source = source.replace(EXPORT_DECL, (_, kind, name) => `${kind} ${name}`);

  // `import { a, b as c } from './x.js';` -> `const { a, b: c } = __m['x.js'];`
  source = source.replace(IMPORT, (_, names, spec) => {
    const target = key(normalize(join(dirname(absolute), spec)));
    deps.push(target);
    const bindings = names
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [from, to] = entry.split(/\s+as\s+/).map((s) => s.trim());
        return to ? `${from}: ${to}` : from;
      })
      .join(', ');
    return `const { ${bindings} } = __m[${JSON.stringify(target)}];`;
  });

  // import.meta is a syntax error outside a module. Neither use survives into
  // the bundled build (the worker comes from a Blob, and service worker
  // registration is skipped on file://), but both must still parse.
  source = source.replace(/import\.meta\.url/g, 'location.href');

  return { deps, exported: [...exported], source };
}

/** Depth-first module order, dependencies before dependents. */
async function graph(entry) {
  const modules = new Map();
  const order = [];
  const seen = new Set();

  const visit = async (absolute) => {
    const id = key(absolute);
    if (seen.has(id)) return;
    seen.add(id);
    const module = await loadModule(absolute);
    modules.set(id, module);
    for (const dep of module.deps) await visit(join(SRC, dep));
    order.push(id);
  };

  await visit(entry);
  return { modules, order };
}

async function bundle(entry) {
  const { modules, order } = await graph(entry);
  const parts = ['const __m = {};'];
  for (const id of order) {
    const module = modules.get(id);
    parts.push(
      `__m[${JSON.stringify(id)}] = (function () {\n${module.source}\n` +
      `return { ${module.exported.join(', ')} };\n})();`,
    );
  }
  return parts.join('\n\n');
}

// ── assemble ───────────────────────────────────────────────────────────────
const workerBundle = await bundle(join(SRC, 'js', 'worker.js'));
const mainBundle = await bundle(join(SRC, 'js', 'main.js'));
const css = await readFile(join(SRC, 'css', 'base.css'), 'utf8');
let html = await readFile(join(SRC, 'index.html'), 'utf8');

html = html
  .replace(/[ \t]*<link rel="stylesheet"[^>]*>\n?/, `<style>\n${css}\n</style>\n`)
  .replace(/[ \t]*<link rel="manifest"[^>]*>\n?/, '')
  .replace(
    /[ \t]*<script type="module"[^>]*><\/script>/,
    `<script>\n// The worker, inlined. Started from a Blob URL so it also runs from file://.\n` +
    `const BUNDLED_WORKER = ${JSON.stringify(workerBundle)};\n\n${mainBundle}\n</script>`,
  );

// The hosted build loads scripts from its own origin; a file:// document has an
// opaque origin where 'self' matches nothing, so the inline build leans on
// 'unsafe-inline' and blob:. connect-src stays 'none' either way — that is the
// guarantee, and it is unaffected.
html = html.replace(
  /script-src [^;]*;/,
  "script-src 'unsafe-inline' blob:;",
);

await mkdir(OUT, { recursive: true });
const outFile = join(OUT, 'instagram-analytics.html');
await writeFile(outFile, html);

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`wrote ${relative(ROOT, outFile)}`);
console.log(`  worker bundle ${kb(workerBundle.length)}`);
console.log(`  main bundle   ${kb(mainBundle.length)}`);
console.log(`  css           ${kb(css.length)}`);
console.log(`  total         ${kb(html.length)}`);
