// index.js — turn a set of export files into one normalized dataset.

import { readMeta, coverageOf } from './common.js';
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

  const data = {
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

  // What each section actually covers. Instagram's retention limits differ wildly
  // per section — likes can reach back years while ads reach back days — so
  // anything comparing two sections has to know their real windows rather than
  // assume the requested range applies to both.
  data.coverage = {
    followers: coverageOf(data.followers),
    following: coverageOf(data.following),
    posts: coverageOf(data.content.published),
    likes: coverageOf(data.engagement.likes),
    comments: coverageOf(data.engagement.comments),
    saved: coverageOf(data.engagement.saved),
    storiesViewed: coverageOf(data.consumption.storiesViewed),
    postsViewed: coverageOf(data.consumption.postsViewed),
    videosWatched: coverageOf(data.consumption.videosWatched),
    adsViewed: coverageOf(data.ads.adsViewed),
  };

  return data;
}
