// insights.js — the creator-stats block professional accounts get.
//
// This is the one part of an export that reports engagement the user RECEIVED
// rather than gave: accounts reached, impressions, profile visits, total
// interactions, story replies, and the follower age/gender/location split.
// Everything else in the archive is outbound. It is aggregate only — there are
// no usernames here — so it complements the per-person inbound ranking in
// analytics/fans.js rather than replacing it.
//
// ⚠️ Personal accounts do not get these files at all. `parseInsights` returns
// null in that case and the whole tab is dropped from the UI, which is why
// nothing downstream may assume the object exists.
//
// ── Why this matches on LABELS, not on filenames ──────────────────────────
//
// Meta has shipped creator stats under several paths and both file formats,
// and this parser was written without a professional-account export to check
// against. Pinning it to `logged_information/past_instagram_insights.json`
// would make it fail silently and invisibly the moment that path differs by a
// directory. So instead it sweeps every plausible file and matches the field
// LABELS, which are the stable part — they are what Instagram shows in the app.
//
// Anything it finds but cannot classify is still returned, under `extra`, and
// the UI renders it. An unrecognised metric therefore shows up as a visible row
// the reader can act on, instead of being dropped on the floor.
//
// To check the real shape of your own export:
//   node tools/probe.mjs <extracted-export-dir> logged_information

import { nodes } from './common.js';

/** Files that could hold creator stats, whatever Meta called them this year. */
const CANDIDATE = /(insight|creator_stats|account_overview|audience)/i;

/**
 * Canonical metric names, and every label seen or plausibly used for each.
 * Compared case-insensitively with punctuation stripped, so "Profile visits",
 * "profile_visits" and "Profile Visits" all land in the same slot.
 */
const METRICS = {
  reach: ['accounts reached', 'reach', 'accounts reached count'],
  impressions: ['impressions', 'views', 'content views', 'total views'],
  profileVisits: ['profile visits', 'profile views'],
  totalInteractions: ['total interactions', 'interactions', 'content interactions'],
  accountsEngaged: ['accounts engaged', 'engaged accounts'],
  postLikes: ['post likes', 'likes'],
  postComments: ['post comments', 'comments'],
  postSaves: ['post saves', 'saves', 'saved'],
  postShares: ['post shares', 'shares'],
  postInteractions: ['post interactions'],
  storyInteractions: ['story interactions'],
  storyReplies: ['story replies', 'replies'],
  follows: ['follows', 'follows and unfollows', 'net follows', 'new followers'],
  followerCount: ['follower count', 'followers'],
};

const norm = (label) => String(label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const LOOKUP = new Map();
for (const [key, labels] of Object.entries(METRICS)) {
  for (const label of labels) LOOKUP.set(norm(label), key);
}

/**
 * A metric value, or null.
 *
 * Instagram writes these with thousands separators and the occasional "1.2K",
 * both of which `Number()` alone turns into NaN.
 */
function numeric(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/,/g, '');
  const scaled = /^(-?[\d.]+)\s*([KkMm])$/.exec(text);
  if (scaled) {
    return Math.round(Number(scaled[1]) * (scaled[2].toLowerCase() === 'k' ? 1e3 : 1e6));
  }
  if (!/^-?\d+(\.\d+)?%?$/.test(text)) return null;
  const value = Number(text.replace('%', ''));
  return Number.isFinite(value) ? value : null;
}

/** Percentage breakdowns — "25-34: 83.4%" style rows. */
function share(raw) {
  if (typeof raw !== 'string') return null;
  const m = /^(-?[\d.]+)\s*%$/.exec(raw.trim());
  return m ? Number(m[1]) : null;
}

/**
 * Walk any JSON shape and yield every label/value pair it contains.
 *
 * Meta uses at least three encodings for the same thing — `string_map_data`
 * dictionaries, `{label, value}` records, and plain nested objects — and which
 * one appears varies by section. Walking generically is shorter than three
 * special cases and does not break when a fourth appears.
 */
function* pairs(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) yield* pairs(item, depth + 1);
    return;
  }
  if (value.string_map_data && typeof value.string_map_data === 'object') {
    for (const [label, cell] of Object.entries(value.string_map_data)) {
      yield [label, cell?.value ?? cell?.timestamp ?? null];
    }
  }
  if (typeof value.label === 'string' && 'value' in value) yield [value.label, value.value];
  for (const [key, item] of Object.entries(value)) {
    if (key === 'string_map_data') continue;
    if (item !== null && typeof item === 'object') yield* pairs(item, depth + 1);
    else yield [key, item];
  }
}

/** The same, for the HTML export: every field of every record. */
function* htmlPairs(html) {
  for (const node of nodes(html)) {
    for (const [label, value] of node.fields) yield [label, value];
    if (node.heading) yield [node.heading, node.text.split('\n').slice(1).join(' ').trim()];
  }
}

/**
 * @param {Map<string,string>} files
 * @returns {object|null} null when the export has no creator stats — the normal
 *   case for a personal account, and not an error.
 */
export function parseInsights(files) {
  const found = {};
  const extra = [];
  const demographics = { gender: [], age: [], cities: [], countries: [] };
  const sources = [];
  let period = { start: null, end: null };

  for (const [name, text] of files) {
    if (!CANDIDATE.test(name)) continue;

    let stream;
    if (/\.json$/i.test(name)) {
      let doc;
      try {
        doc = JSON.parse(text);
      } catch {
        continue; // a malformed file must not sink the export
      }
      stream = pairs(doc);
    } else if (/\.html?$/i.test(name)) {
      stream = htmlPairs(text);
    } else {
      continue;
    }

    let used = false;
    for (const [rawLabel, rawValue] of stream) {
      const label = norm(rawLabel);
      if (!label) continue;

      // Period bounds, wherever they turn up.
      if (/^(start|period start|from|date start)$/.test(label) && rawValue) {
        period.start ??= String(rawValue);
        continue;
      }
      if (/^(end|period end|to|date end)$/.test(label) && rawValue) {
        period.end ??= String(rawValue);
        continue;
      }

      // Demographic rows are percentages keyed by bucket, not named metrics:
      // "18-24" -> "2.9%", "male" -> "52.7%", "Miami" -> "12%".
      const pctValue = share(rawValue);
      if (pctValue !== null) {
        if (/^\d{2}\s\d{2}$|^\d{2}$|^65$/.test(label)) {
          demographics.age.push({ key: String(rawLabel), count: pctValue });
        } else if (/^(male|female|men|women|other|unknown)$/.test(label)) {
          demographics.gender.push({ key: String(rawLabel), count: pctValue });
        } else if (/city|cities/.test(name.toLowerCase())) {
          demographics.cities.push({ key: String(rawLabel), count: pctValue });
        } else if (/countr/.test(name.toLowerCase())) {
          demographics.countries.push({ key: String(rawLabel), count: pctValue });
        } else {
          extra.push({ key: String(rawLabel), value: String(rawValue) });
        }
        used = true;
        continue;
      }

      const key = LOOKUP.get(label);
      const value = numeric(rawValue);
      if (key && value !== null) {
        // Highest wins. The same metric can appear once per period in one file,
        // and the lifetime or widest window is the useful one to headline.
        found[key] = Math.max(found[key] ?? 0, value);
        used = true;
      } else if (value !== null && value !== 0 && label.length > 3) {
        // Kept, not discarded: see the header note. The UI lists these so an
        // unmapped metric is visible rather than silently absent.
        extra.push({ key: String(rawLabel), value: String(rawValue) });
        used = true;
      }
    }
    if (used) sources.push(name);
  }

  if (!Object.keys(found).length && !extra.length) return null;

  const rank = (rows) => rows.sort((a, b) => b.count - a.count).slice(0, 25);
  return {
    ...found,
    period,
    demographics: {
      gender: rank(demographics.gender),
      age: demographics.age.sort((a, b) => String(a.key).localeCompare(String(b.key))),
      cities: rank(demographics.cities),
      countries: rank(demographics.countries),
    },
    // Deduplicated, so a label repeated across a dozen daily rows is one entry.
    extra: [...new Map(extra.map((row) => [`${row.key}=${row.value}`, row])).values()].slice(0, 120),
    sources,
  };
}
