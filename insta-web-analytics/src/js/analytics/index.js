// index.js — run every analytics module over a parsed export.

import { audience } from './audience.js';
import { attribution } from './attribution.js';
import { content } from './content.js';
import { affinity } from './affinity.js';
import { consumption } from './consumption.js';
import { ads } from './ads.js';
import { messages } from './messages.js';
import { privacy } from './privacy.js';
import { trends } from './trends.js';

/**
 * @param {object} data      parsed export
 * @param {object} [history] previously uploaded history file, if any
 */
export function analyse(data, history) {
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
  };

  results.trends = trends(history);
  results.comparedWith = previous?.generatedAt ?? null;
  return results;
}

export { audience, attribution, content, affinity, consumption, ads, messages, privacy, trends };
