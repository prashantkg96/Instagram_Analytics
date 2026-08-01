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

/**
 * Ticks from 0 to the first round step at or above `max`.
 *
 * Running only to the last step *below* max is what made the axis look frozen:
 * with max = 0.33 and a 0.1 step the ticks stopped at 0.3, so the tallest bar
 * rose above the final gridline and the labels never described the data.
 */
function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  // Count the steps rather than accumulating `v += step`, which drifts on
  // fractional steps (0.1 + 0.1 + 0.1 = 0.30000000000000004).
  const steps = Math.max(1, Math.ceil(max / step - 1e-9));
  return Array.from({ length: steps + 1 }, (_, i) => Number((i * step).toFixed(6)));
}

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : String(n ?? ''));

/**
 * The largest value a chart has to reach, falling back to 1 only when there is
 * nothing to plot.
 *
 * Writing `Math.max(...values, 1)` instead — which is what every chart used to
 * do — pins the axis at 1 for any series whose values are all fractional. The
 * followers-per-post charts peak around 0.16, so they drew a fixed 0–1 axis
 * with bars a sixth of the height whatever the data said: the "static y axis".
 */
const peakOf = (values) => {
  const peak = Math.max(...values, 0);
  return peak > 0 ? peak : 1;
};

/** How many x labels the plot area can hold before they start touching. */
const labelBudget = (width, pad) =>
  Math.max(3, Math.floor((width - pad.left - pad.right) / 56));

/**
 * Draws the gridlines and returns a scale anchored to the TOP TICK.
 *
 * Scaling by the raw max instead pins the tallest bar to the plot ceiling
 * regardless of where the gridlines fall, so every chart looked identically
 * "full" and the axis appeared not to react to the data.
 */
function yAxis(svg, { top, bottom, left, right }, max) {
  const ticks = niceTicks(max);
  const axisMax = ticks.at(-1) || 1;
  const scale = (v) => bottom - (v / axisMax) * (bottom - top);
  for (const tick of ticks) {
    const y = scale(tick);
    el('line', { class: 'grid-line', x1: left, x2: right, y1: y, y2: y }, svg);
    el('text', { x: left - 6, y: y + 3.5, 'text-anchor': 'end' }, svg).textContent = fmt(tick);
  }
  return { scale, max: axisMax };
}

/**
 * Redraw a chart at its container's real pixel width.
 *
 * A chart drawn in fixed user units is scaled to the card by the viewBox — and
 * that scales the TEXT with it. A 720-unit chart in a 340px card renders its
 * 10-unit labels at 4.7px, which is the whole reason axis labels were
 * unreadable. Painting at the measured width keeps one unit equal to one pixel,
 * so a 13px label is 13px on a phone and on a wide desktop card alike.
 */
function responsive(draw, { min = 280 } = {}) {
  const host = document.createElement('div');
  host.className = 'chart-host';
  let painted = 0;
  const paint = (raw) => {
    const width = Math.max(min, Math.round(raw));
    if (width === painted) return;
    painted = width;
    host.replaceChildren(draw(width));
  };
  paint(min);
  // A panel that is still detached (or in a hidden tab) measures 0; the
  // observer fires again with the real width once it is laid out.
  const observer = new ResizeObserver((entries) => paint(entries[0].contentRect.width));
  requestAnimationFrame(() => observer.observe(host));
  return host;
}

/**
 * Columns for a single series.
 * @param {{key:string,count:number}[]} data
 */
export function columnChart(data, opts = {}) {
  return responsive((width) => drawColumns(data, { ...opts, width }));
}

function drawColumns(data, { height = 190, label = 'value', highlight = null, width = 720 } = {}) {
  const pad = { top: 12, right: 8, bottom: 26, left: 44 };
  const svg = svgRoot(width, height);
  if (!data.length) return svg;

  const max = peakOf(data.map((d) => d.count));
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

  // Thin the x labels so they never collide. The budget is derived from the
  // real width, since that is now the phone width on a narrow screen.
  const every = Math.max(1, Math.ceil(data.length / labelBudget(width, pad)));
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
export function stackedChart(rows, keys, opts = {}) {
  return responsive((width) => drawStacked(rows, keys, { ...opts, width }));
}

function drawStacked(rows, keys, { height = 210, xKey = 'month', width = 720 } = {}) {
  const pad = { top: 12, right: 8, bottom: 26, left: 44 };
  const svg = svgRoot(width, height);
  if (!rows.length) return svg;

  const totals = rows.map((r) => keys.reduce((s, k) => s + (r[k.key] ?? 0), 0));
  const max = peakOf(totals);
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

  const every = Math.max(1, Math.ceil(rows.length / labelBudget(width, pad)));
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
export function lineChart(points, opts = {}) {
  return responsive((width) => drawLine(points, { ...opts, width }));
}

function drawLine(points, { height = 210, label = '', areaFill = true, width = 720 } = {}) {
  const pad = { top: 16, right: 54, bottom: 26, left: 44 };
  const svg = svgRoot(width, height);
  if (points.length < 2) return svg;

  const max = peakOf(points.map((p) => p.value));
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

  const every = Math.max(1, Math.ceil(points.length / labelBudget(width, pad)));
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
export function barsChart(data, opts = {}) {
  return responsive((width) => drawBars(data, { ...opts, width }));
}

// Rough advance width of the label font (13px sans) in user units. Only used to
// size the gutter, so being a little generous is the safe direction.
const CHAR = 7.2;

function drawBars(data, { limit = 12, label = '', height = null, width = 720 } = {}) {
  const rows = data.slice(0, limit);
  // A three-category chart at the 24px row height the long ranked lists want
  // renders as a squat band stretched across the full card, which is what made
  // "by content type" look mis-sized. Short lists get taller rows.
  const rowHeight = height ?? (rows.length <= 5 ? 34 : 24);
  const axisHeight = 20;
  const plotBottom = rows.length * rowHeight + 4;
  const svg = svgRoot(width, Math.max(plotBottom + axisHeight, 60));
  if (!rows.length) return svg;

  // The gutter tracks the longest label instead of a fixed 168 units, so "reel"
  // no longer reserves the same space as a 24-character handle — and long
  // handles get more room than they used to.
  const longest = rows.reduce((n, r) => Math.max(n, String(r.key).length), 0);
  const labelWidth = Math.round(
    Math.max(44, Math.min(Math.min(longest, 30) * CHAR + 12, width * 0.42)),
  );
  const fits = Math.max(5, Math.floor((labelWidth - 12) / CHAR));
  const trackWidth = Math.max(24, width - labelWidth - 56);

  const max = peakOf(rows.map((r) => r.count));
  const ticks = niceTicks(max);
  const axisMax = ticks.at(-1) || 1;
  const xOf = (v) => labelWidth + (v / axisMax) * trackWidth;

  // Gridlines first so the bars sit on top of them.
  for (const tick of ticks) {
    const x = xOf(tick);
    el('line', { class: 'grid-line', x1: x, x2: x, y1: 0, y2: plotBottom }, svg);
    el('text', {
      x, y: plotBottom + 15, 'text-anchor': 'middle',
    }, svg).textContent = fmt(tick);
  }

  rows.forEach((row, i) => {
    const y = i * rowHeight + 4;
    const barHeight = Math.min(18, rowHeight - GAP * 2);
    const w = Math.max(2, (row.count / axisMax) * trackWidth);
    const text = String(row.key);

    el('text', {
      x: labelWidth - 10, y: y + barHeight / 2 + 4.5, 'text-anchor': 'end', fill: 'var(--text-secondary)',
    }, svg).textContent = text.length > fits ? `${text.slice(0, fits - 1)}…` : text;

    el('path', {
      d: barPath(labelWidth, y, w, barHeight, 4, true), fill: seriesColor(0),
    }, svg);
    el('text', {
      x: labelWidth + w + 7, y: y + barHeight / 2 + 4.5, fill: 'var(--text-muted)',
    }, svg).textContent = fmt(row.count);

    const hit = el('rect', {
      x: 0, y, width, height: Math.max(rowHeight, 24), fill: 'transparent',
    }, svg);
    hoverable(hit, `<b>${row.key}</b><br>${fmt(row.count)}${label ? ` ${label}` : ''}`);
  });

  el('line', {
    class: 'axis-line', x1: labelWidth, x2: labelWidth, y1: 0, y2: plotBottom,
  }, svg);
  return svg;
}

/**
 * Weekday x hour activity grid. Sequential single-hue ramp: light means near
 * zero, dark means busy — never a rainbow.
 * @param {number[][]} grid 7 rows of 24
 */
export function heatmapChart(grid, opts = {}) {
  return responsive((width) => drawHeatmap(grid, { ...opts, width }));
}

function drawHeatmap(grid, { label = 'items', width = 666 } = {}) {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const left = 34;
  // The cell tracks the available width so the grid is drawn 1:1 instead of
  // being squeezed by the viewBox — which shrank its labels to under 6px on a
  // phone. Capped so a wide card does not inflate it into a wall of tiles.
  const cell = Math.min(30, Math.max(9, Math.floor((width - left - 8) / 24)));
  const top = 16;
  const svg = svgRoot(left + 24 * cell + 8, top + 7 * cell + 6);

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

/**
 * A single value on a fixed scale, drawn as an open arc.
 *
 * The one chart here with no axis, because there is no series to compare
 * against — it shows where one number sits between two bounds. Same marks as
 * everything else: a 2px round-capped stroke in the series hue over a track one
 * step off the surface, never dashed.
 *
 * The endpoints are labelled on purpose. An arc without them is a dial the
 * reader has to guess the range of, and a score whose scale is invisible is
 * indistinguishable from a made-up number.
 *
 * @param {number} value
 * @param {{min?: number, max?: number, label?: string, height?: number}} opts
 */
export function arcGauge(value, { min = 0, max = 100, label = '', height = 168 } = {}) {
  return responsive((width) => drawGauge(value, { min, max, label, height, width }), { min: 220 });
}

function drawGauge(value, { min, max, label, height, width }) {
  const svg = svgRoot(width, height);
  const cx = width / 2;
  const r = Math.min(width / 2 - 34, height - 52);
  const cy = height - 26;
  const stroke = 10;

  // Semicircle, left to right.
  const point = (fraction) => {
    const angle = Math.PI * (1 - Math.min(1, Math.max(0, fraction)));
    return [cx + r * Math.cos(angle), cy - r * Math.sin(angle)];
  };
  // The large-arc flag asks whether the sweep exceeds 180° of the FULL circle.
  // This gauge spans at most a semicircle, so it is always 0. Deriving it from
  // the fraction instead — `to - from > 0.5` — sets it for anything past the
  // halfway mark, and SVG then draws the long way round: the fill balloons out
  // above the track at a visibly larger radius.
  const arc = (from, to) => {
    const [x1, y1] = point(from);
    const [x2, y2] = point(to);
    return `M${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2}`;
  };

  const span = max - min || 1;
  const fraction = Math.min(1, Math.max(0, (value - min) / span));

  el('path', {
    d: arc(0, 1), fill: 'none', stroke: 'var(--gridline)',
    'stroke-width': stroke, 'stroke-linecap': 'round',
  }, svg);
  if (fraction > 0) {
    el('path', {
      d: arc(0, fraction), fill: 'none', stroke: seriesColor(0),
      'stroke-width': stroke, 'stroke-linecap': 'round',
    }, svg);
  }

  const value_ = el('text', {
    x: cx, y: cy - 6, 'text-anchor': 'middle', class: 'gauge-value',
  }, svg);
  value_.textContent = fmt(Math.round(value));

  if (label) {
    const caption = el('text', { x: cx, y: cy + 14, 'text-anchor': 'middle' }, svg);
    caption.textContent = label;
  }
  el('text', { x: cx - r, y: cy + 18, 'text-anchor': 'middle' }, svg).textContent = fmt(min);
  el('text', { x: cx + r, y: cy + 18, 'text-anchor': 'middle' }, svg).textContent = fmt(max);

  svg.setAttribute('aria-label', `${label || 'Score'}: ${Math.round(value)} out of ${max}`);
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
