// worker.js — unzip, parse and analyse off the main thread.
//
// This has to be a worker: a 220 MB ZIP holding ~25 MB of markup, with
// stories_viewed.html alone running to several thousand records, would block
// the UI for seconds on the main thread. It is also why scan.js walks the
// markup directly instead of using DOMParser, which does not exist here.

import { extractText, isDataFile, listEntries } from './unzip.js';
import { parseExport } from './parsers/index.js';
import { analyse, trends } from './analytics/index.js';
import { buildSnapshot, mergeSnapshot, parseHistory } from './history.js';

const post = (message) => self.postMessage(message);

/**
 * Only the fields the views actually read. The full dataset holds thousands of
 * impression rows and every sensitive identifier; none of that needs to cross
 * back to the main thread.
 */
function summarize(data) {
  return {
    format: data.format,
    meta: data.meta,
    profile: {
      username: data.profile.username,
      name: data.profile.name,
      bio: data.profile.bio,
      isPrivate: data.profile.isPrivate,
      createdAt: data.profile.createdAt,
      basedIn: data.profile.basedIn,
    },
    engagement: {
      likes: data.engagement.likes.length,
      comments: data.engagement.comments.length,
      saved: data.engagement.saved.length,
    },
  };
}

self.onmessage = async ({ data: message }) => {
  const started = performance.now();
  try {
    post({ type: 'progress', pct: 2, label: 'Reading the archive…' });

    const entries = await listEntries(message.file);
    const wanted = entries.filter((e) => isDataFile(e.name));
    if (!wanted.length) {
      throw new Error(
        'No Instagram data files in that ZIP. Make sure it is the export Instagram sent you, unmodified.',
      );
    }
    const skipped = entries.length - wanted.length;

    const files = await extractText(message.file, {
      include: isDataFile,
      onProgress: (done, total, name) => {
        // Extraction is the slow half; give it most of the bar.
        post({
          type: 'progress',
          pct: 2 + Math.round((done / total) * 58),
          label: `Extracting ${done} of ${total} — ${name.split('/').pop()}`,
        });
      },
    });

    post({ type: 'progress', pct: 62, label: 'Reading your data…' });
    const parsed = parseExport(files);

    post({ type: 'progress', pct: 84, label: 'Computing analytics…' });
    const history = message.historyText ? parseHistory(message.historyText) : null;
    const results = analyse(parsed, history);

    post({ type: 'progress', pct: 95, label: 'Building your history file…' });
    const snapshot = buildSnapshot(parsed, results);
    const merged = mergeSnapshot(history, snapshot, parsed.profile.username);

    // Trends have to be computed against the merged history, not the uploaded
    // one: this export is itself the latest data point. Reading the pre-merge
    // history would leave the Trends tab claiming a first upload even when a
    // previous snapshot was supplied.
    results.trends = trends(merged);

    post({
      type: 'done',
      summary: summarize(parsed),
      results,
      history: merged,
      stats: {
        files: files.size,
        skippedMedia: skipped,
        ms: Math.round(performance.now() - started),
      },
    });
  } catch (error) {
    post({ type: 'error', message: error?.message ?? String(error) });
  }
};
