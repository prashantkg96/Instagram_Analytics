// messages.js — direct message shape. Counts and timing only; no content.

import { median, percent, round, DAY_NAMES } from './util.js';

export function messages(data) {
  const threads = data.messages.threads;
  const total = threads.reduce((s, t) => s + t.total, 0);
  const sent = threads.reduce((s, t) => s + t.sent, 0);

  const hours = new Array(24).fill(0);
  for (const thread of threads) {
    for (const [hour, count] of Object.entries(thread.hours)) hours[Number(hour)] += count;
  }

  const replies = threads.map((t) => t.medianReplySeconds).filter((n) => n !== null && n > 0);

  // A thread where the user sends far more than they receive reads very
  // differently from a balanced one, so the ratio is surfaced per thread.
  const withBalance = threads.map((thread) => ({
    ...thread,
    sentPct: percent(thread.sent, thread.total),
    initiationPct: thread.opened ? percent(thread.openedByMe, thread.opened) : null,
    spanDays:
      thread.first && thread.last
        ? Math.max(1, Math.round((Date.parse(thread.last) - Date.parse(thread.first)) / 864e5))
        : null,
  }));

  return {
    totals: {
      threads: threads.length,
      messages: total,
      sent,
      received: total - sent,
      requests: threads.filter((t) => t.folder === 'message_requests').length,
      shares: threads.reduce((s, t) => s + t.shares, 0),
      emoji: threads.reduce((s, t) => s + t.emoji, 0),
    },
    sentPct: percent(sent, total),
    // How much of the DM life is reshared reels rather than conversation.
    sharePct: percent(threads.reduce((s, t) => s + t.shares, 0), total),
    byHour: hours.map((count, hour) => ({ hour, count })),
    peakHour: hours.indexOf(Math.max(...hours)),
    medianReplySeconds: median(replies),
    threads: withBalance.slice(0, 50),
    busiest: withBalance.slice(0, 10),
    conversationsOpened: threads.reduce((s, t) => s + t.opened, 0),
    openedByMePct: percent(
      threads.reduce((s, t) => s + t.openedByMe, 0),
      threads.reduce((s, t) => s + t.opened, 0),
    ),
    averageThreadSize: threads.length ? round(total / threads.length, 1) : 0,
    dayNames: DAY_NAMES,
  };
}
