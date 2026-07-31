// common.js — helpers shared by every section parser.

import { records, parseRecord, field, section, leafValues, readHeader, parseStamp, trailingStamp } from '../scan.js';

/** A parsed export is a Map of path -> text. Paths use forward slashes. */
export function pick(files, ...candidates) {
  for (const name of candidates) {
    if (files.has(name)) return files.get(name);
  }
  return undefined;
}

/**
 * Files matching a pattern, in path order. Instagram splits large sections
 * across numbered files (followers_1, followers_2, message_1, ...), so any
 * parser that ignores the suffix silently truncates large accounts.
 */
export function pickAll(files, pattern) {
  return [...files.keys()]
    .filter((name) => pattern.test(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((name) => ({ name, html: files.get(name) }));
}

/** Parse every record of a document. */
export function nodes(html) {
  return html ? records(html).map(parseRecord) : [];
}

/** Parse every record across a set of documents. */
export function nodesOf(docs) {
  const out = [];
  for (const { html } of docs) out.push(...nodes(html));
  return out;
}

const DEFAULT_TIME_LABELS = ['Time', 'Creation Time', 'Creation time', 'Received on', 'Update time'];

/**
 * Timestamp of a record: the first matching field, else the trailing date.
 *
 * Passing explicit labels suppresses the defaults. That matters for own
 * content, where "Update time" is a later edit and the trailing stamp is the
 * actual publish moment — picking the wrong one would shift every post in the
 * attribution model by months.
 */
export function when(node, ...labels) {
  for (const label of labels.length ? labels : DEFAULT_TIME_LABELS) {
    const raw = field(node, label);
    if (raw) {
      const parsed = parseStamp(raw);
      if (parsed) return parsed;
    }
  }
  return trailingStamp(node);
}

const USER_URL = /instagram\.com\/(?:_u\/)?(?:stories\/)?([A-Za-z0-9._]+)/i;
const NON_PROFILE = new Set(['p', 'reel', 'reels', 'tv', 'explore', 'stories', 's', 'share']);

/** Instagram handle embedded in a profile or story URL, if it is one. */
export function handleFromUrl(url) {
  if (!url) return null;
  const m = USER_URL.exec(url);
  if (!m) return null;
  const handle = m[1];
  return NON_PROFILE.has(handle.toLowerCase()) ? null : handle;
}

/**
 * The account that published a piece of content the user interacted with.
 * Stored as an `Owner` (or `Author`) sub-section holding Username and Name.
 */
export function ownerOf(node) {
  const owner = section(node, 'Owner') ?? section(node, 'Author') ?? section(node, 'Media Owner');
  if (owner) {
    const username = field(owner, 'Username');
    if (username) return { u: username, name: field(owner, 'Name') ?? null };
  }
  const flat = field(node, 'Media Owner') ?? field(node, 'Username');
  if (flat) return { u: flat, name: field(node, 'Name') ?? null };
  return null;
}

/** Hashtags attached to a piece of content. */
export function hashtagsOf(node) {
  const tags = section(node, 'Hashtags');
  return tags ? leafValues(tags).filter((t) => t && t !== 'Name') : [];
}

/** Hashtags written in a caption, lowercased and de-duplicated. */
export function hashtagsInText(text) {
  if (!text) return [];
  const found = text.match(/#[\p{L}\p{N}_]+/gu);
  return found ? [...new Set(found.map((t) => t.slice(1).toLowerCase()))] : [];
}

/** @-mentions written in a caption. */
export function mentionsInText(text) {
  if (!text) return [];
  const found = text.match(/@[A-Za-z0-9._]+/g);
  return found ? [...new Set(found.map((t) => t.slice(1).toLowerCase()))] : [];
}

export function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function toBool(value) {
  return value === 'True' || value === 'true' || value === true;
}

/** Coordinates, ignoring the 0/0 placeholder Instagram writes when absent. */
export function coordsOf(node) {
  const lat = toNumber(field(node, 'Latitude'));
  const lng = toNumber(field(node, 'Longitude'));
  if (lat === null || lng === null) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/** ISO date (YYYY-MM-DD) in local time — the bucket key for every daily chart. */
export function dayKey(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** YYYY-MM bucket key. */
export function monthKey(date) {
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function iso(date) {
  return date ? date.toISOString() : null;
}

/** Export-wide metadata, read from whichever file is available. */
export function readMeta(files) {
  for (const html of files.values()) {
    const head = readHeader(html);
    if (head.generatedAt) {
      return { generatedAt: head.generatedAt, rangeStart: head.rangeStart, rangeEnd: head.rangeEnd };
    }
  }
  return { generatedAt: null, rangeStart: null, rangeEnd: null };
}

export { field, section, leafValues, parseStamp, trailingStamp };
