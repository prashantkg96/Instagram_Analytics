// index.js — turn a set of export files into one normalized dataset.

import { readMeta } from './common.js';
import { parseProfile } from './profile.js';
import { parseConnections } from './connections.js';
import { parseContent } from './content.js';
import { parseEngagement } from './engagement.js';
import { parseConsumption } from './consumption.js';
import { parseAds } from './ads.js';
import { parseMessages } from './messages.js';
import { parseSecurity } from './security.js';
import { parseJsonExport } from './json.js';

/** Which export format a file set is in. Meta offers HTML or JSON. */
export function detectFormat(files) {
  let html = 0;
  let json = 0;
  for (const name of files.keys()) {
    if (/\.html?$/i.test(name)) html++;
    else if (/\.json$/i.test(name)) json++;
  }
  if (!html && !json) return 'empty';
  return json > html ? 'json' : 'html';
}

/**
 * @param {Map<string,string>} files  path -> file contents
 * @returns {object} normalized dataset
 */
export function parseExport(files) {
  const format = detectFormat(files);
  if (format === 'empty') {
    throw new Error(
      'No Instagram data files found. Upload the ZIP exactly as Instagram provided it.',
    );
  }

  // JSON exports are a different serialization of the same data, so that
  // adapter builds this exact dataset shape itself rather than faking markup.
  if (format === 'json') return parseJsonExport(files);

  const profile = parseProfile(files);
  const connections = parseConnections(files);

  return {
    format,
    meta: readMeta(files),
    profile,
    ...connections,
    content: parseContent(files),
    engagement: parseEngagement(files),
    consumption: parseConsumption(files),
    ads: parseAds(files),
    messages: parseMessages(files, profile.name),
    security: parseSecurity(files),
  };
}
