// ui.js — DOM helpers and the reusable pieces every tab is built from.

import { legend as legendNode } from './charts.js';

/** Terse element builder. Children may be nodes, strings, or nullish. */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const fmt = (n) =>
  typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : (n ?? '—');

/** Compact form for stat tiles: 1,284 / 12.9K / 3.4M. */
function compact(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

export const pct = (n) => (typeof n === 'number' ? `${n}%` : '—');

export function shortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(+d) ? String(iso).slice(0, 10)
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function duration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

/** Stat tile. `delta` is signed and coloured by direction x whether up is good. */
export function tile(label, value, { delta, deltaLabel, goodWhenUp = true, sub } = {}) {
  const parts = [
    h('span', { class: 'label' }, label),
    h('span', { class: 'value' }, typeof value === 'number' ? compact(value) : value),
  ];
  if (delta !== null && delta !== undefined && delta !== 0) {
    const rising = delta > 0;
    const good = rising === goodWhenUp;
    parts.push(h('span', { class: `delta ${good ? 'up' : 'down'}` },
      `${rising ? '+' : ''}${fmt(delta)}${deltaLabel ? ` ${deltaLabel}` : ''}`));
  } else if (sub) {
    parts.push(h('span', { class: 'delta' }, sub));
  }
  return h('div', { class: 'card tile' }, ...parts);
}

/**
 * Sortable, filterable table.
 *
 * @param {{key:string,label:string,num?:boolean,render?:Function}[]} columns
 * @param {object[]} rows
 */
export function table(columns, rows, { filter = false, limit = 100, empty = 'Nothing here.' } = {}) {
  if (!rows.length) return h('p', { class: 'empty' }, empty);

  const wrap = h('div');
  let sortKey = null;
  let sortDir = 'descending';
  let query = '';

  const body = h('tbody');
  const head = h('tr');

  const render = () => {
    let view = rows;
    if (query) {
      const needle = query.toLowerCase();
      view = view.filter((row) =>
        columns.some((c) => String(row[c.key] ?? '').toLowerCase().includes(needle)));
    }
    if (sortKey) {
      const column = columns.find((c) => c.key === sortKey);
      view = [...view].sort((a, b) => {
        const x = a[sortKey];
        const y = b[sortKey];
        const cmp = column?.num
          ? (Number(x) || 0) - (Number(y) || 0)
          : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true });
        return sortDir === 'ascending' ? cmp : -cmp;
      });
    }
    body.replaceChildren(
      ...view.slice(0, limit).map((row) =>
        h('tr', {}, ...columns.map((c) =>
          h('td', { class: c.num ? 'num' : null },
            c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—'))))),
    );
    if (view.length > limit) {
      body.append(h('tr', {}, h('td', { colspan: columns.length, class: 'muted' },
        `Showing first ${limit.toLocaleString()} of ${view.length.toLocaleString()} rows.`)));
    }
  };

  columns.forEach((column) => {
    const th = h('th', {
      class: column.num ? 'num' : null,
      scope: 'col',
      tabindex: '0',
      onclick: () => {
        sortDir = sortKey === column.key && sortDir === 'descending' ? 'ascending' : 'descending';
        sortKey = column.key;
        head.querySelectorAll('th').forEach((n) => n.removeAttribute('aria-sort'));
        th.setAttribute('aria-sort', sortDir);
        render();
      },
    }, column.label);
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); }
    });
    head.append(th);
  });

  if (filter) {
    wrap.append(h('input', {
      class: 'tablefilter',
      type: 'search',
      name: 'table-filter',
      placeholder: 'Filter…',
      'aria-label': 'Filter table',
      oninput: (e) => { query = e.target.value; render(); },
    }));
  }

  render();
  wrap.append(h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, head), body)));
  return wrap;
}

/**
 * Card wrapping a chart, with a toggle to the equivalent table.
 *
 * The toggle is not a nicety: several palette slots fall below 3:1 on the
 * light surface, and the relief rule requires that every value stay reachable
 * without relying on hue or a hover.
 */
export function chartCard(title, subtitle, chart, { legend, tableView } = {}) {
  const holder = h('div', {}, chart);
  const card = h('div', { class: 'card' });
  const header = h('header', {}, h('h3', {}, title));

  if (tableView) {
    let showing = 'chart';
    const toggle = h('button', {
      class: 'btn chart-toggle',
      type: 'button',
      'aria-pressed': 'false',
      onclick: () => {
        showing = showing === 'chart' ? 'table' : 'chart';
        toggle.textContent = showing === 'chart' ? 'Table' : 'Chart';
        toggle.setAttribute('aria-pressed', showing === 'table' ? 'true' : 'false');
        holder.replaceChildren(showing === 'chart' ? chart : tableView());
      },
    }, 'Table');
    header.append(toggle);
  }

  card.append(header);
  if (subtitle) card.append(h('p', { class: 'sub' }, subtitle));
  card.append(holder);
  if (legend?.length) card.append(legendNode(legend));
  return card;
}

/** Plain card with arbitrary content. */
export function card(title, subtitle, ...content) {
  return h('div', { class: 'card' },
    title ? h('header', {}, h('h3', {}, title)) : null,
    subtitle ? h('p', { class: 'sub' }, subtitle) : null,
    ...content);
}

export function section(title, subtitle, ...content) {
  return h('section', { class: 'section' },
    h('h2', {}, title),
    subtitle ? h('p', { class: 'sub' }, subtitle) : null,
    ...content);
}

export function notice(text, kind = '') {
  return h('div', { class: `notice ${kind}`.trim(), html: text });
}

/** Link to a profile. Rendered as text in the single-file build too. */
export function handle(u) {
  if (!u) return '—';
  return h('a', {
    class: 'handle',
    href: `https://www.instagram.com/${encodeURIComponent(u)}`,
    target: '_blank',
    rel: 'noopener noreferrer',
  }, `@${u}`);
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
