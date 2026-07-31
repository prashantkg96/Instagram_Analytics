// unzip.js — minimal ZIP reader with zero third-party code.
//
// Entries are located through the ZIP central directory and decompressed with
// the browser's native DecompressionStream('deflate-raw'), which is exactly the
// codec ZIP stores method-8 entries in. Two consequences worth knowing:
//
//   1. Nothing is vendored, so there is no minified blob to audit.
//   2. Only the byte ranges we actually want are read. An Instagram export is
//      ~220 MB but the files we parse total ~25 MB, so the media/** blobs are
//      never pulled into memory at all.

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOC = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;

const MAX_COMMENT = 0xffff;
const EOCD_MIN = 22;

const utf8 = new TextDecoder('utf-8');

async function bytesOf(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

// Locate the End Of Central Directory record. It sits at the very end of the
// file unless a trailing comment pushes it back, so scan backwards over the
// largest region a comment could occupy.
async function findEocd(blob) {
  const tailLen = Math.min(blob.size, EOCD_MIN + MAX_COMMENT);
  const tail = await bytesOf(blob, blob.size - tailLen, blob.size);
  const view = new DataView(tail.buffer);

  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (view.getUint32(i, true) !== SIG_EOCD) continue;
    return {
      view,
      offset: i,
      absolute: blob.size - tailLen + i,
      tailStart: blob.size - tailLen,
      tail,
    };
  }
  throw new Error('Not a ZIP file (no end-of-central-directory record found).');
}

// ZIP64 kicks in past 4 GB or 65 535 entries. Instagram exports stay well under
// both, but a truncated read here would look like a corrupt archive rather than
// an unsupported one, so it is worth handling properly.
async function readDirectoryBounds(blob, eocd) {
  let entries = eocd.view.getUint16(eocd.offset + 10, true);
  let size = eocd.view.getUint32(eocd.offset + 12, true);
  let offset = eocd.view.getUint32(eocd.offset + 16, true);

  const needs64 = entries === 0xffff || size === 0xffffffff || offset === 0xffffffff;
  if (!needs64) return { entries, size, offset };

  const locAt = eocd.offset - 20;
  if (locAt < 0 || eocd.view.getUint32(locAt, true) !== SIG_EOCD64_LOC) {
    throw new Error('ZIP64 archive is missing its locator record.');
  }
  const eocd64At = Number(eocd.view.getBigUint64(locAt + 8, true));
  const head = await bytesOf(blob, eocd64At, eocd64At + 56);
  const v = new DataView(head.buffer);
  if (v.getUint32(0, true) !== SIG_EOCD64) {
    throw new Error('ZIP64 end-of-central-directory record is malformed.');
  }
  return {
    entries: Number(v.getBigUint64(32, true)),
    size: Number(v.getBigUint64(40, true)),
    offset: Number(v.getBigUint64(48, true)),
  };
}

// A ZIP64 extra field replaces whichever of these fields was saturated to all
// ones in the fixed-width header. Order is fixed and fields are only present
// when their 32-bit counterpart overflowed.
function applyZip64Extra(extra, entry) {
  let p = 0;
  while (p + 4 <= extra.length) {
    const view = new DataView(extra.buffer, extra.byteOffset + p);
    const id = view.getUint16(0, true);
    const len = view.getUint16(2, true);
    if (id === 0x0001) {
      let q = 4;
      if (entry.uncompressedSize === 0xffffffff) {
        entry.uncompressedSize = Number(view.getBigUint64(q, true));
        q += 8;
      }
      if (entry.compressedSize === 0xffffffff) {
        entry.compressedSize = Number(view.getBigUint64(q, true));
        q += 8;
      }
      if (entry.headerOffset === 0xffffffff) {
        entry.headerOffset = Number(view.getBigUint64(q, true));
      }
      return;
    }
    p += 4 + len;
  }
}

function parseCentralDirectory(bytes, expectedEntries) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  let p = 0;

  while (p + 46 <= bytes.length && entries.length !== expectedEntries) {
    if (view.getUint32(p, true) !== SIG_CENTRAL) break;

    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);

    const entry = {
      name: utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      uncompressedSize: view.getUint32(p + 24, true),
      headerOffset: view.getUint32(p + 42, true),
    };

    if (extraLen) {
      applyZip64Extra(bytes.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen), entry);
    }

    // Directory markers carry no payload.
    if (!entry.name.endsWith('/')) entries.push(entry);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The local header repeats the name and extra fields at different lengths than
// the central directory does, so the payload offset has to be read from it
// rather than assumed.
async function readEntry(blob, entry) {
  const head = await bytesOf(blob, entry.headerOffset, entry.headerOffset + 30);
  const view = new DataView(head.buffer);
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);

  const start = entry.headerOffset + 30 + nameLen + extraLen;
  const raw = await bytesOf(blob, start, start + entry.compressedSize);

  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRaw(raw);
  throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
}

/**
 * List the entries in a ZIP without decompressing anything.
 * @param {Blob} blob
 * @returns {Promise<Array<{name, method, compressedSize, uncompressedSize, headerOffset}>>}
 */
export async function listEntries(blob) {
  const eocd = await findEocd(blob);
  const bounds = await readDirectoryBounds(blob, eocd);
  const dir = await bytesOf(blob, bounds.offset, bounds.offset + bounds.size);
  return parseCentralDirectory(dir, bounds.entries);
}

/**
 * Decompress the entries matching `include` and return them as decoded text.
 *
 * @param {Blob} blob            the ZIP
 * @param {object} opts
 * @param {(name: string) => boolean} opts.include  path filter, applied before
 *        any decompression happens
 * @param {(done: number, total: number, name: string) => void} [opts.onProgress]
 * @returns {Promise<Map<string, string>>} path -> file contents
 */
export async function extractText(blob, { include, onProgress } = {}) {
  const all = await listEntries(blob);
  const wanted = include ? all.filter((e) => include(e.name)) : all;
  const out = new Map();

  for (let i = 0; i < wanted.length; i++) {
    const entry = wanted[i];
    try {
      out.set(entry.name, utf8.decode(await readEntry(blob, entry)));
    } catch (err) {
      // One unreadable file should not sink an otherwise valid export.
      console.warn(`Skipped ${entry.name}: ${err.message}`);
    }
    onProgress?.(i + 1, wanted.length, entry.name);
  }
  return out;
}

/**
 * Decompress exactly one entry and return its raw bytes.
 *
 * Deliberately separate from `extractText`, which decodes UTF-8 and is filtered
 * by `isDataFile`. The only caller wants the profile photo — a binary living
 * under the `media/` prefix that `isDataFile` excludes — and widening that
 * filter would pull every photo and video in the archive into memory.
 *
 * @param {Blob} blob
 * @param {string} path  exact entry name, as returned by `listEntries`
 * @returns {Promise<Uint8Array|null>} null when the entry is absent or unreadable
 */
export async function extractBinary(blob, path) {
  if (!path) return null;
  const wanted = String(path).replace(/^\.?\//, '').toLowerCase();
  const norm = (name) => name.replace(/^\.?\//, '').toLowerCase();
  const entries = await listEntries(blob);
  // Paths inside the HTML are relative to the export root, but the archive may
  // nest everything under a top-level folder, so fall back to a suffix match.
  const entry = entries.find((e) => norm(e.name) === wanted)
    ?? entries.find((e) => norm(e.name).endsWith(`/${wanted}`));
  if (!entry) return null;
  try {
    return await readEntry(blob, entry);
  } catch (err) {
    console.warn(`Could not read ${path}: ${err.message}`);
    return null;
  }
}

/**
 * Paths worth decompressing: the data files, never the media blobs.
 *
 * The exclusion is anchored to the archive root on purpose. `media/` at the
 * top level holds the photo and video binaries, but
 * `your_instagram_activity/media/posts.html` is the post *manifest* — matching
 * `/media/` anywhere would silently drop every post, story and reel.
 */
export function isDataFile(name) {
  const path = name.replace(/^\.?\//, '');
  if (/^media\//i.test(path)) return false;
  if (/^files\//i.test(path)) return false;
  return /\.(html?|json|txt)$/i.test(path);
}
