// index.js — run every analytics module over a parsed export.

import { audience } from './audience.js';
import { attribution } from './attribution.js';
import { content } from './content.js';
import { affinity } from './affinity.js';
import { fans } from './fans.js';
import { insights } from './insights.js';
import { consumption } from './consumption.js';
import { ads } from './ads.js';
import { messages } from './messages.js';
import { privacy } from './privacy.js';
import { summary } from './summary.js';
import { passport } from './passport.js';
import { trends } from './trends.js';

/**
 * @param {object} data      parsed export
 * @param {object} [history] previously uploaded history file, if any
 * @param {object} [archive] the ZIP listing, for the export passport. Absent
 *   when running against an extracted directory, in which case the passport is
 *   simply omitted rather than guessed at.
 */
export function analyse(data, history, archive = {}) {
  // The newest stored snapshot is the comparison point for "since last time".
  const snapshots = [...(history?.snapshots ?? [])].sort((a, b) =>
    String(a.generatedAt).localeCompare(String(b.generatedAt)),
  );
  const previous = snapshots.filter((s) => s.generatedAt !== data.meta.generatedAt).at(-1) ?? null;

  const results = {
    audience: audience(data, previous),
    attribution: attribution(data),
    content: content(data),
    affinity: affinity(data),
    consumption: consumption(data),
    ads: ads(data),
    messages: messages(data),
    privacy: privacy(data),
    // null for a personal account — the export simply has no creator stats.
    // Every reader must handle that, including the tab registry.
    insights: insights(data),
  };

  // Reads affinity's output as well as the parsed data — the two-way ranking
  // needs both directions — so it runs after the block above rather than in it.
  results.fans = fans(data, results.affinity);

  // Reads the archive listing rather than the parsed data; null without one.
  results.passport = passport(archive.manifest, archive.files);

  // Last, and deliberately so: it summarises the others, so every module it
  // reads has to have run already.
  results.summary = summary(data, results);

  results.trends = trends(history);
  results.comparedWith = previous?.generatedAt ?? null;
  return results;
}

export {
  audience, attribution, content, affinity, fans, insights,
  consumption, ads, messages, privacy, summary, passport, trends,
};
