// messages.js — direct message threads.
//
// Only shape is retained: who sent what, when, how long. Message bodies are
// read to measure length and emoji use and are then dropped — they are never
// held past parsing and never reach any exported file.

import { pickAll, nodes, when, iso } from './common.js';

const THREAD_PATH = /messages\/(inbox|message_requests|archived_threads)\/([^/]+)\/message_(\d+)\.html$/i;

export function parseMessages(files, selfName) {
  const byThread = new Map();

  for (const { name, html } of pickAll(files, THREAD_PATH)) {
    const m = THREAD_PATH.exec(name);
    if (!m) continue;
    const [, folder, slug] = m;

    let thread = byThread.get(slug);
    if (!thread) {
      thread = { slug, folder, title: null, messages: [] };
      byThread.set(slug, thread);
    }

    for (const node of nodes(html)) {
      const sender = node.heading;
      if (!sender) continue;
      // Everything between the sender heading and the trailing timestamp is
      // the body; the timestamp line itself is not content.
      const lines = node.text.split('\n').filter((l) => l && l !== sender);
      const at = when(node);
      const body = lines.slice(0, -1).join('\n');

      thread.messages.push({
        from: sender,
        isMe: selfName ? sender === selfName : false,
        at: iso(at),
        length: body.length,
        emoji: (body.match(/\p{Extended_Pictographic}/gu) ?? []).length,
        hasLink: node.links.length > 0,
        isShare: /sent an attachment|Liked a message/i.test(body),
      });
    }
  }

  const threads = [...byThread.values()].map((thread) =>
    summariseThread(thread.messages, thread));

  threads.sort((a, b) => b.total - a.total);

  // Everything inbound rests on knowing which sender is the user. Without a
  // display name to compare against, `isMe` is false for every message and the
  // whole thread reads as incoming — so say so rather than let a downstream
  // ranking quietly present the user's own messages as fan mail.
  return { threads, selfIdentified: Boolean(selfName) };
}

/**
 * Reduce one thread's messages to counts and timing.
 *
 * Exported because the JSON export path builds the same rows from a completely
 * different file format, and the two shapes have to stay identical — anything
 * reading `data.messages.threads` cannot tell which parser produced it. Keeping
 * one implementation is what stops the two drifting.
 *
 * @param {Array} raw   messages as `{from, isMe, at, emoji, isShare}`
 * @param {{slug: string, folder: string, title?: string|null}} meta
 */
export function summariseThread(raw, meta) {
  const messages = raw
    .filter((x) => x.at)
    .sort((a, b) => a.at.localeCompare(b.at));
  const sent = messages.filter((x) => x.isMe).length;
  const inbound = messages.filter((x) => !x.isMe);

  // Distinct senders, so a group chat can be told apart from a one-to-one.
  // `title` below takes the first non-me sender, which is meaningless for a
  // group — anything ranking individual people has to drop those.
  const senders = new Set(messages.map((x) => x.from));

  // Which calendar months this person actually wrote in. Someone who replied
  // across eleven months is a different kind of contact from someone who sent
  // the same number of messages in one week, and total volume cannot tell them
  // apart.
  const inboundMonths = new Set(inbound.map((x) => x.at.slice(0, 7)));

  // Who opens conversations: a message more than six hours after the previous
  // one starts a new exchange.
  let opened = 0;
  let openedByMe = 0;
  for (let i = 0; i < messages.length; i++) {
    const gap = i === 0 ? Infinity : Date.parse(messages[i].at) - Date.parse(messages[i - 1].at);
    if (gap > 6 * 3600 * 1000) {
      opened++;
      if (messages[i].isMe) openedByMe++;
    }
  }

  // Reply latency: time to answer the other party, ignoring consecutive
  // messages from the same side.
  const replies = [];
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].isMe && !messages[i - 1].isMe) {
      replies.push(Date.parse(messages[i].at) - Date.parse(messages[i - 1].at));
    }
  }
  replies.sort((a, b) => a - b);

  return {
    slug: meta.slug,
    folder: meta.folder,
    // The counterparty's display name, taken from the messages themselves.
    title: meta.title ?? inbound[0]?.from ?? meta.slug,
    participants: senders.size,
    isGroup: senders.size > 2,
    total: messages.length,
    sent,
    received: inbound.length,
    // Reels and posts they sent *you* — engaging with content in your
    // direction, as opposed to the ones you forwarded out.
    receivedShares: inbound.filter((x) => x.isShare).length,
    inboundMonths: inboundMonths.size,
    inboundFirst: inbound[0]?.at ?? null,
    inboundLast: inbound.at(-1)?.at ?? null,
    first: messages[0]?.at ?? null,
    last: messages.at(-1)?.at ?? null,
    opened,
    openedByMe,
    openedByThem: opened - openedByMe,
    medianReplySeconds: replies.length ? Math.round(replies[replies.length >> 1] / 1000) : null,
    emoji: messages.reduce((s, x) => s + x.emoji, 0),
    shares: messages.filter((x) => x.isShare).length,
    hours: messages.reduce((acc, x) => {
      const h = new Date(x.at).getHours();
      acc[h] = (acc[h] ?? 0) + 1;
      return acc;
    }, {}),
  };
}
