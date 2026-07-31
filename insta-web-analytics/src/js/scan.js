// scan.js — reader for Meta's HTML export markup.
//
// DOMParser does not exist in Web Workers, and the heavy files have to be
// parsed off the main thread (stories_viewed.html alone is ~17 MB), so this
// walks the markup directly. That is tolerable only because the markup is
// machine-generated and rigidly regular:
//
//   <div class="pam ... uiBoxWhite noborder">      one record
//     <h2>Owner</h2>                              optional section heading
//     <td class="_a6_q">Label</td><td>Value</td>   two-cell field
//     <td colspan="2" class="_a6_q">Label<div>Value</div></td>   nested field
//     <div class="pam ...">                       nested sub-record
//
// Records nest (a liked post contains an Owner block containing a Name field),
// so a naive split on the record marker yields empty leading records. Depth is
// tracked to emit only the outermost ones.

const RECORD_CLASS = 'uiBoxWhite noborder';
const DIV_TAG = /<div\b([^>]*)>|<\/div>/g;

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#039': "'",
};

export function decodeEntities(text) {
  if (text.indexOf('&') === -1) return text;
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, body) => {
    const lower = body.toLowerCase();
    if (NAMED_ENTITIES[lower]) return NAMED_ENTITIES[lower];
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return whole;
  });
}

/**
 * Split markup into its text runs, one per element boundary.
 *
 * Tags become separators rather than being deleted: a follower record is
 * `<div>name</div><div>date</div>`, and simply removing tags would fuse those
 * into "nameApr 15, 2026". Each run is trimmed at the ends only, so the blank
 * lines inside a caption — which live in a single text node — survive intact.
 */
export function textParts(html) {
  return html
    .split(/<[^>]*>/)
    .map((part) => decodeEntities(part).trim())
    .filter(Boolean);
}

/** Text content of a fragment, one run per line. */
export function textOf(html) {
  return textParts(html).join('\n');
}

/**
 * Walk the outermost record blocks of a document, calling `fn` with the raw
 * HTML of each. Single pass, no tree is built.
 */
export function eachRecord(html, fn) {
  const from = html.indexOf('<main');
  const to = html.lastIndexOf('</main>');
  const region = from >= 0 && to > from ? html.slice(from, to) : html;

  DIV_TAG.lastIndex = 0;
  let depth = 0;
  let start = -1;
  let startDepth = 0;
  let index = 0;
  let m;

  while ((m = DIV_TAG.exec(region)) !== null) {
    if (m[0].charCodeAt(1) === 47 /* "/" */) {
      depth--;
      if (start >= 0 && depth === startDepth) {
        fn(region.slice(start, DIV_TAG.lastIndex), index++);
        start = -1;
      }
    } else {
      if (start < 0 && m[1].indexOf(RECORD_CLASS) !== -1) {
        start = m.index;
        startDepth = depth;
      }
      depth++;
    }
  }
  return index;
}

/** Collect the outermost record blocks as an array. */
export function records(html) {
  const out = [];
  eachRecord(html, (rec) => out.push(rec));
  return out;
}

// Blank out nested record blocks so a parent's field scan cannot capture a
// child's fields, while keeping every offset stable.
function maskChildren(html) {
  const kids = [];
  let masked = html;
  const inner = html.slice(html.indexOf('>') + 1);
  const base = html.length - inner.length;

  DIV_TAG.lastIndex = 0;
  let depth = 0;
  let start = -1;
  let startDepth = 0;
  let m;
  const spans = [];

  while ((m = DIV_TAG.exec(inner)) !== null) {
    if (m[0].charCodeAt(1) === 47) {
      depth--;
      if (start >= 0 && depth === startDepth) {
        spans.push([start, DIV_TAG.lastIndex]);
        start = -1;
      }
    } else {
      if (start < 0 && m[1].indexOf(RECORD_CLASS) !== -1) {
        start = m.index;
        startDepth = depth;
      }
      depth++;
    }
  }

  for (let i = spans.length - 1; i >= 0; i--) {
    const [a, b] = spans[i];
    kids.unshift(inner.slice(a, b));
    masked = masked.slice(0, base + a) + ' '.repeat(b - a) + masked.slice(base + b);
  }
  return { masked, kids };
}

const H2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/;
const TWO_CELL = /<td[^>]*class="[^"]*_a6_q[^"]*"[^>]*>([^<]*)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
const NESTED_CELL = /<td[^>]*class="[^"]*_a6_q[^"]*"[^>]*>([^<]*?)<div[^>]*>([\s\S]*?)<\/td>/g;
const DIV_LABEL = /<div[^>]*class="[^"]*_a6_q[^"]*"[^>]*>([^<]*)<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>/g;
const ANCHOR = /<a\b[^>]*href="([^"]*)"[^>]*>/g;

/**
 * Parse one record block into a node.
 *
 * @returns {{heading: string|null, fields: Map<string,string>, links: string[],
 *            media: string[], text: string, children: object[]}}
 */
export function parseRecord(html) {
  const { masked, kids } = maskChildren(html);

  const headingMatch = H2.exec(masked);
  const heading = headingMatch ? textOf(headingMatch[1]) : null;
  const body = headingMatch ? masked.replace(H2, ' ') : masked;

  const fields = new Map();
  const put = (label, value) => {
    const key = textOf(label);
    if (key && !fields.has(key)) fields.set(key, textOf(value));
  };

  let m;
  TWO_CELL.lastIndex = 0;
  while ((m = TWO_CELL.exec(body)) !== null) put(m[1], m[2]);
  NESTED_CELL.lastIndex = 0;
  while ((m = NESTED_CELL.exec(body)) !== null) put(m[1], m[2]);
  DIV_LABEL.lastIndex = 0;
  while ((m = DIV_LABEL.exec(body)) !== null) put(m[1], m[2]);

  const links = [];
  const media = [];
  ANCHOR.lastIndex = 0;
  while ((m = ANCHOR.exec(body)) !== null) {
    (/^https?:/i.test(m[1]) ? links : media).push(decodeEntities(m[1]));
  }

  return {
    heading,
    fields,
    links,
    media,
    text: textOf(body),
    children: kids.map(parseRecord),
  };
}

/** First field with this label, searching the node then its descendants. */
export function field(node, label) {
  if (node.fields.has(label)) return node.fields.get(label);
  for (const child of node.children) {
    const found = field(child, label);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Descendant section introduced by `<h2>heading</h2>`. */
export function section(node, heading) {
  for (const child of node.children) {
    if (child.heading === heading) return child;
    const found = section(child, heading);
    if (found) return found;
  }
  return undefined;
}

/** Text of every leaf node beneath `node` — how list sections store their items. */
export function leafValues(node) {
  const out = [];
  const walk = (n) => {
    if (!n.children.length) {
      if (n.text) out.push(n.text);
      return;
    }
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/;
const TIME_ATTR = /<time\b[^>]*datetime="([^"]+)"/g;

/**
 * Document header. The three <time> elements are the export's generation
 * moment and the window it covers — needed to merge snapshots without
 * corrupting the trend line when a narrower range is re-exported.
 */
export function readHeader(html) {
  // The inline stylesheet runs to several KB, so the header can sit well past
  // any fixed window. Everything before <main> is header by construction.
  const mainAt = html.indexOf('<main');
  const head = html.slice(0, mainAt > 0 ? mainAt : Math.min(html.length, 20000));
  const title = TITLE.exec(head);
  const stamps = [];
  TIME_ATTR.lastIndex = 0;
  let m;
  while ((m = TIME_ATTR.exec(head)) !== null) stamps.push(m[1]);
  return {
    title: title ? textOf(title[1]) : null,
    generatedAt: stamps[0] ?? null,
    rangeStart: stamps[1] ?? null,
    rangeEnd: stamps[2] ?? null,
  };
}

const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};
const STAMP = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})(?:,)? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i;

/**
 * Parse the export's own date format, e.g. "Apr 15, 2026 9:16 am".
 * These carry no timezone; they are already rendered in the requester's local
 * time, so they are read as local and compared only against each other.
 *
 * @returns {Date|null}
 */
export function parseStamp(value) {
  if (!value) return null;
  const m = STAMP.exec(value.trim());
  if (!m) {
    const iso = Date.parse(value);
    return Number.isNaN(iso) ? null : new Date(iso);
  }
  let hour = Number(m[4]);
  const meridiem = m[7]?.toLowerCase();
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return new Date(Number(m[3]), MONTHS[m[1]], Number(m[2]), hour, Number(m[5]), Number(m[6] ?? 0));
}

/** The trailing "Apr 15, 2026 9:16 am" a record ends with, if present. */
export function trailingStamp(node) {
  const parts = node.text.split('\n').map((s) => s.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const when = parseStamp(parts[i]);
    if (when) return when;
  }
  return null;
}
