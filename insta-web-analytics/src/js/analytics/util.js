// util.js — small shared helpers for the analytics modules.
//
// Pure computation, no DOM: everything here runs inside the Web Worker.

/**
 * The values Instagram writes for an on/off setting, and what each means.
 *
 * Strict, whole-string matching on purpose. Anything outside this table is
 * UNKNOWN rather than assumed off — Meta renames these strings without notice,
 * and the previous loose `/off|false/` test meant an audience-style value such
 * as "From people I follow" was silently counted as ON.
 */
const BINARY_VALUES = new Map([
  ['on', true], ['true', true], ['yes', true], ['enabled', true],
  ['off', false], ['false', false], ['no', false], ['disabled', false],
]);

/**
 * Classify a raw export value.
 *
 * Lives here rather than in ui.js because the analytics layer counts with it
 * and the view renders with it; the two disagreeing is the bug this replaces.
 * @returns {true|false|null} null when absent or unrecognised
 */
export function binaryState(value) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return null;
  return BINARY_VALUES.get(String(value).trim().toLowerCase()) ?? null;
}

export function countBy(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null || key === undefined || key === '') continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/** Map -> array of {key, count}, largest first. */
export function ranked(map, limit = Infinity) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)))
    .slice(0, limit);
}

/** Map -> array of {key, count} in key order — for time series. */
export function chronological(map) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

export const dayOf = (x) => (x.at ? x.at.slice(0, 10) : null);
export const monthOf = (x) => (x.at ? x.at.slice(0, 7) : null);
export const hourOf = (x) => (x.at ? new Date(x.at).getHours() : null);
export const weekdayOf = (x) => (x.at ? new Date(x.at).getDay() : null);

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Fill every hour 0-23 so charts do not have gaps. */
export function hourHistogram(items) {
  const counts = countBy(items, hourOf);
  return Array.from({ length: 24 }, (_, hour) => ({ hour, count: counts.get(hour) ?? 0 }));
}

/** Fill every weekday so charts do not have gaps. */
export function weekdayHistogram(items) {
  const counts = countBy(items, weekdayOf);
  return DAY_NAMES.map((name, day) => ({ day, name, count: counts.get(day) ?? 0 }));
}

/**
 * Weekday x hour grid, for the activity heatmap.
 * @returns {number[][]} 7 rows of 24
 */
export function heatmap(items) {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const item of items) {
    if (!item.at) continue;
    const d = new Date(item.at);
    grid[d.getDay()][d.getHours()]++;
  }
  return grid;
}

/** Every day between the first and last item, zero-filled. */
export function dailySeries(items) {
  const counts = countBy(items, dayOf);
  const days = [...counts.keys()].sort();
  if (!days.length) return [];
  const out = [];
  const cursor = new Date(`${days[0]}T00:00:00`);
  const end = new Date(`${days.at(-1)}T00:00:00`);
  while (cursor <= end) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    out.push({ key, count: counts.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function median(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const percent = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
export const round = (n, places = 2) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/** Longest run of consecutive active days, and the longest silence. */
export function streaks(items) {
  const days = [...new Set(items.map(dayOf).filter(Boolean))].sort();
  if (!days.length) return { longestStreak: 0, longestGapDays: 0, activeDays: 0 };
  let longest = 1;
  let run = 1;
  let gap = 0;
  let gapFrom = null;
  let gapTo = null;
  for (let i = 1; i < days.length; i++) {
    const delta = Math.round(
      (Date.parse(`${days[i]}T00:00:00`) - Date.parse(`${days[i - 1]}T00:00:00`)) / 864e5,
    );
    if (delta === 1) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 1;
      if (delta - 1 > gap) {
        gap = delta - 1;
        gapFrom = days[i - 1];
        gapTo = days[i];
      }
    }
  }
  return { longestStreak: longest, longestGapDays: gap, gapFrom, gapTo, activeDays: days.length };
}
