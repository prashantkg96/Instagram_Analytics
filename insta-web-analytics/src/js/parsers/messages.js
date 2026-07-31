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

  const threads = [...byThread.values()].map((thread) => {
    const messages = thread.messages
      .filter((x) => x.at)
      .sort((a, b) => a.at.localeCompare(b.at));
    const sent = messages.filter((x) => x.isMe).length;

    // Who opens conversations: a message more than six hours after the
    // previous one starts a new exchange.
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
      slug: thread.slug,
      folder: thread.folder,
      // The counterparty's display name, taken from the messages themselves.
      title: messages.find((x) => !x.isMe)?.from ?? thread.slug,
      total: messages.length,
      sent,
      received: messages.length - sent,
      first: messages[0]?.at ?? null,
      last: messages.at(-1)?.at ?? null,
      opened,
      openedByMe,
      medianReplySeconds: replies.length ? Math.round(replies[replies.length >> 1] / 1000) : null,
      emoji: messages.reduce((s, x) => s + x.emoji, 0),
      shares: messages.filter((x) => x.isShare).length,
      hours: messages.reduce((acc, x) => {
        const h = new Date(x.at).getHours();
        acc[h] = (acc[h] ?? 0) + 1;
        return acc;
      }, {}),
    };
  });

  threads.sort((a, b) => b.total - a.total);
  return { threads };
}
