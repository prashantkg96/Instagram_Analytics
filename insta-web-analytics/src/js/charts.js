// charts.js — hand-rolled SVG charts. No dependency, no CDN, no canvas.
//
// Mark specs held to throughout:
//   bars   <= 24px thick, 4px rounded data-end, square at the baseline
//   lines  2px, round join/cap; markers r >= 4 with a 2px surface ring
//   area   series hue at ~10%
//   grid   solid hairlines one step off the surface, never dashed
//   gaps   2px of surface between touching marks — never a stroke
//
// Every chart is paired with a table view by the card that hosts it, which is
// what makes the sub-3:1 light-mode aqua legal and keeps values reachable
// without a hover.

const NS = 'http://www.w3.org/2000/svg';
const SERIES_VARS = ['--series-1', '--series-2', '--series-3'];
const GAP = 2;

export const seriesColor = (i) => `var(${SERIES_VARS[i % SERIES_VARS.length]})`;

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  parent?.appendChild(node);
  return node;
}

function svgRoot(width, height) {
  const svg = el('svg', {
    class: 'chart',
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
  });
  svg.style.height = `${height}px`;
  return svg;
}

/** Rect with only the data-end corners rounded; the baseline end stays square. */
function barPath(x, y, w, h, r = 4, horizontal = false) {
  const radius = Math.max(0, Math.min(r, horizontal ? w : h, w / 2, h / 2));
  if (horizontal) {
    return `M${x},${y} H${x + w - radius} A${radius},${radius} 0 0 1 ${x + w},${y + radius}` +
      ` V${y + h - radius} A${radius},${radius} 0 0 1 ${x + w - radius},${y + h} H${x} Z`;
  }
  return `M${x},${y + h} V${y + radius} A${radius},${radius} 0 0 1 ${x + radius},${y}` +
    ` H${x + w - radius} A${radius},${radius} 0 0 1 ${x + w},${y + radius} V${y + h} Z`;
}

// ── shared tooltip ─────────────────────────────────────────────────────────
let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.setAttribute('role', 'status');
    document.body.appendChild(tip);
  }
  return tip;
}

function showTip(event, html) {
  const node = tooltip();
  node.innerHTML = html;
  node.classList.add('show');
  const box = node.getBoundingClientRect();
  const x = Math.min(event.clientX + 14, window.innerWidth - box.width - 8);
  const y = Math.max(8, event.clientY - box.height - 12);
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
}

export function hideTip() {
  if (tip) tip.classList.remove('show');
}

/**
 * Attach hover and keyboard reveal to a mark. The hit target is a separate,
 * larger rect so small marks are still reachable.
 */
function hoverable(node, html) {
  node.addEventListener('mousemove', (e) => showTip(e, html));
  node.addEventListener('mouseleave', hideTip);
  node.setAttribute('tabindex', '0');
  node.addEventListener('focus', (e) => {
    const box = e.target.getBoundingClientRect();
    showTip({ clientX: box.left + box.width / 2, clientY: box.top }, html);
  });
  node.addEventListener('blur', hideTip);
}

function niceTicks(max, count = 4) {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : String(n ?? ''));

function yAxis(svg, { top, bottom, left, right }, max) {
  const ticks = niceTicks(max);
  const scale = (v) => bottom - (max ? (v / max) * (bottom - top) : 0);
  for (const tick of ticks) {
    const y = scale(tick);
    el('line', { class: 'grid-line', x1: left, x2: right, y1: y, y2: y }, svg);
    el('text', { x: left - 6, y: y + 3.5, 'text-anchor': 'end' }, svg).textContent = fmt(tick);
  }
  return { scale, max };
}

/**
 * Columns for a single series.
 * @param {{key:string,count:number}[]} data
 */
export function columnChart(data, { height = 190, label = 'value', highlight = null } = {}) {
  const width = 720;
  const pad = { top: 12, right: 8, bottom: 26, left: 44 };
  const svg = svgRoot(width, height);
  if (!data.length) return svg;

  const max = Math.max(...data.map((d) => d.count), 1);
  const { scale } = yAxis(svg, { ...pad, right: width - pad.right, bottom: height - pad.bottom }, max);
  const band = (width - pad.left - pad.right) / data.length;
  // Cap the bar so the band keeps some air, and leave the 2px surface gap.
  const barWidth = Math.max(1, Math.min(24, band - GAP));

  data.forEach((d, i) => {
    const x = pad.left + i * band + (band - barWidth) / 2;
    const y = scale(d.count);
    const h = height - pad.bottom - y;
    const isHot = highlight === d.key;
    el('path', {
      d: barPath(x, y, barWidth, Math.max(h, d.count > 0 ? 1 : 0)),
      fill: isHot ? seriesColor(1) : seriesColor(0),
    }, svg);

    // Hit target spans the whole band and the full height, so a 1px bar is
    // still hoverable.
    const hit = el('rect', {
      x: pad.left + i * band, y: pad.top,
      width: band, height: height - pad.bottom - pad.top,
      fill: 'transparent',
    }, svg);
    hoverable(hit, `<b>${d.key}</b><br>${fmt(d.count)} ${label}`);
  });

  el('line', {
    class: 'axis-line', x1: pad.left, x2: width - pad.right,
    y1: height - pad.bottom, y2: height - pad.bottom,
  }, svg);

  // Thin the x labels so they never collide.
  const every = Math.ceil(data.length / 12);
  data.forEach((d, i) => {
    if (i % every) return;
    el('text', {
      x: pad.left + i * band + band / 2, y: height - pad.bottom + 14, 'text-anchor': 'middle',
    }, svg).textContent = d.key;
  });
  return svg;
}

/**
 * Stacked columns.
 * @param {object[]} rows
 * @param {{key:string,name:string}[]} keys
 */
export function stackedChart(rows, keys, { height = 210, xKey = 'month' } = {}) {
  const width = 720;
  const pad = { top: 12, right: 8, bottom: 26, left: 44 };
  const svg = svgRoot(width, height);
  if (!rows.length) return svg;

  const totals = rows.map((r) => keys.reduce((s, k) => s + (r[k.key] ?? 0), 0));
  const max = Math.max(...totals, 1);
  const { scale } = yAxis(svg, { ...pad, right: width - pad.right, bottom: height - pad.bottom }, max);
  const band = (width - pad.left - pad.right) / rows.length;
  const barWidth = Math.max(1, Math.min(24, band - GAP));

  rows.forEach((row, i) => {
    const x = pad.left + i * band + (band - barWidth) / 2;
    let cursor = height - pad.bottom;
    keys.forEach((k, s) => {
      const value = row[k.key] ?? 0;
      if (!value) return;
      const h = (height - pad.bottom - scale(value)) - 0;
      const segH = Math.max(1, h - GAP); // 2px of surface separates segments
      const y = cursor - segH;
      el('path', {
        d: barPath(x, y, barWidth, segH, s === keys.length - 1 ? 4 : 0),
        fill: seriesColor(s),
      }, svg);
      cursor -= segH + GAP;
    });

    const detail = keys.map((k) => `${k.name}: ${fmt(row[k.key] ?? 0)}`).join('<br>');
    const hit = el('rect', {
      x: pad.left + i * band, y: pad.top, width: band,
      height: height - pad.bottom - pad.top, fill: 'transparent',
    }, svg);
    hoverable(hit, `<b>${row[xKey]}</b><br>${detail}<br><b>${fmt(totals[i])} total</b>`);
  });

  el('line', {
    class: 'axis-line', x1: pad.left, x2: width - pad.right,
    y1: height - pad.bottom, y2: height - pad.bottom,
  }, svg);

  const every = Math.ceil(rows.length / 12);
  rows.forEach((row, i) => {
    if (i % every) return;
    el('text', {
      x: pad.left + i * band + band / 2, y: height - pad.bottom + 14, 'text-anchor': 'middle',
    }, svg).textContent = String(row[xKey]).slice(2);
  });
  return svg;
}

/**
 * Line with a 10% area wash and a labelled endpoint.
 * @param {{key:string,value:number}[]} points
 */
export function lineChart(points, { height = 210, label = '', areaFill = true } = {}) {
  const width = 720;
  const pad = { top: 16, right: 54, bottom: 26, left: 44 };
  const svg = svgRoot(width, height);
  if (points.length < 2) return svg;

  const max = Math.max(...points.map((p) => p.value), 1);
  const { scale } = yAxis(svg, { ...pad, right: width - pad.right, bottom: height - pad.bottom }, max);
  const step = (width - pad.left - pad.right) / (points.length - 1);
  const x = (i) => pad.left + i * step;

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${scale(p.value)}`).join('');
  if (areaFill) {
    el('path', {
      d: `${path}L${x(points.length - 1)},${height - pad.bottom}L${x(0)},${height - pad.bottom}Z`,
      fill: seriesColor(0), 'fill-opacity': 0.1,
    }, svg);
  }
  el('path', {
    d: path, fill: 'none', stroke: seriesColor(0),
    'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }, svg);

  // Endpoint marker with the 2px surface ring, plus a direct label — the only
  // point labelled, so the labels stay meaningful.
  const last = points.at(-1);
  el('circle', {
    cx: x(points.length - 1), cy: scale(last.value), r: 4,
    fill: seriesColor(0), stroke: 'var(--surface-1)', 'stroke-width': 2,
  }, svg);
  el('text', {
    x: x(points.length - 1) + 9, y: scale(last.value) + 3.5, fill: 'var(--text-secondary)',
  }, svg).textContent = fmt(last.value);

  el('line', {
    class: 'axis-line', x1: pad.left, x2: width - pad.right,
    y1: height - pad.bottom, y2: height - pad.bottom,
  }, svg);

  const every = Math.ceil(points.length / 10);
  points.forEach((p, i) => {
    if (i % every && i !== points.length - 1) return;
    el('text', { x: x(i), y: height - pad.bottom + 14, 'text-anchor': 'middle' }, svg).textContent = p.key;
  });

  // Crosshair band per point — wide hit area rather than a pinpoint dot.
  points.forEach((p, i) => {
    const hit = el('rect', {
      x: x(i) - step / 2, y: pad.top, width: Math.max(step, 12),
      height: height - pad.bottom - pad.top, fill: 'transparent',
    }, svg);
    hoverable(hit, `<b>${p.key}</b><br>${fmt(p.value)}${label ? ` ${label}` : ''}`);
  });
  return svg;
}

/**
 * Horizontal bars for ranked lists — the right form for long category names.
 * @param {{key:string,count:number}[]} data
 */
export function barsChart(data, { limit = 12, label = '', height = 24 } = {}) {
  const rows = data.slice(0, limit);
  const width = 720;
  const labelWidth = 168;
  const total = rows.length * height + 8;
  const svg = svgRoot(width, Math.max(total, 40));
  if (!rows.length) return svg;

  const max = Math.max(...rows.map((r) => r.count), 1);
  const trackWidth = width - labelWidth - 64;

  rows.forEach((row, i) => {
    const y = i * height + 4;
    const barHeight = Math.min(16, height - GAP * 2);
    const w = Math.max(2, (row.count / max) * trackWidth);

    el('text', {
      x: labelWidth - 10, y: y + barHeight / 2 + 3.5, 'text-anchor': 'end', fill: 'var(--text-secondary)',
    }, svg).textContent = String(row.key).length > 24 ? `${String(row.key).slice(0, 23)}…` : String(row.key);

    el('path', {
      d: barPath(labelWidth, y, w, barHeight, 4, true), fill: seriesColor(0),
    }, svg);
    el('text', {
      x: labelWidth + w + 7, y: y + barHeight / 2 + 3.5, fill: 'var(--text-muted)',
    }, svg).textContent = fmt(row.count);

    const hit = el('rect', {
      x: 0, y, width, height: Math.max(height, 24), fill: 'transparent',
    }, svg);
    hoverable(hit, `<b>${row.key}</b><br>${fmt(row.count)}${label ? ` ${label}` : ''}`);
  });
  return svg;
}

/**
 * Weekday x hour activity grid. Sequential single-hue ramp: light means near
 * zero, dark means busy — never a rainbow.
 * @param {number[][]} grid 7 rows of 24
 */
export function heatmapChart(grid, { label = 'items' } = {}) {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const cell = 26;
  const left = 34;
  const top = 16;
  const width = left + 24 * cell + 8;
  const svg = svgRoot(width, top + 7 * cell + 6);

  const max = Math.max(...grid.flat(), 1);
  const STEPS = ['--seq-100', '--seq-250', '--seq-400', '--seq-550', '--seq-700'];
  const stepFor = (v) => {
    if (!v) return null;
    const ratio = v / max;
    return STEPS[Math.min(STEPS.length - 1, Math.floor(ratio * STEPS.length))];
  };

  for (let h = 0; h < 24; h += 3) {
    el('text', { x: left + h * cell + cell / 2, y: 10, 'text-anchor': 'middle' }, svg).textContent = String(h);
  }

  grid.forEach((row, d) => {
    el('text', {
      x: left - 7, y: top + d * cell + cell / 2 + 3.5, 'text-anchor': 'end',
    }, svg).textContent = DAYS[d];

    row.forEach((value, h) => {
      const step = stepFor(value);
      const rect = el('rect', {
        x: left + h * cell + GAP / 2, y: top + d * cell + GAP / 2,
        width: cell - GAP, height: cell - GAP, rx: 3,
        fill: step ? `var(${step})` : 'var(--gridline)',
        'fill-opacity': step ? 1 : 0.45,
      }, svg);
      hoverable(rect, `<b>${DAYS[d]} ${String(h).padStart(2, '0')}:00</b><br>${fmt(value)} ${label}`);
    });
  });
  return svg;
}

/** 12-point sparkline for a stat tile or trend row. */
export function sparkline(values, { width = 104, height = 26 } = {}) {
  const svg = svgRoot(width, height);
  const points = values.filter((v) => typeof v === 'number');
  if (points.length < 2) return svg;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const y = (v) => height - 3 - ((v - min) / span) * (height - 6);

  el('path', {
    d: points.map((v, i) => `${i ? 'L' : 'M'}${i * step},${y(v)}`).join(''),
    fill: 'none', stroke: seriesColor(0), 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }, svg);
  el('circle', {
    cx: (points.length - 1) * step, cy: y(points.at(-1)), r: 2.5,
    fill: seriesColor(0), stroke: 'var(--surface-1)', 'stroke-width': 2,
  }, svg);
  return svg;
}

/** Legend markup — always rendered for two or more series. */
export function legend(items) {
  const node = document.createElement('div');
  node.className = 'legend';
  items.forEach((item, i) => {
    const span = document.createElement('span');
    const swatch = document.createElement('i');
    swatch.style.background = item.color ?? seriesColor(i);
    span.append(swatch, document.createTextNode(item.name));
    node.appendChild(span);
  });
  return node;
}
