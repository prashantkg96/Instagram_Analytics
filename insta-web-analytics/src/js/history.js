// history.js — the snapshot file the user carries between uploads.
//
// Nothing persists in the browser: no IndexedDB, no localStorage, no cookies.
// Trends exist only because the user downloads this file and hands it back on
// the next visit. That is a deliberate trade — the tool keeps no state about
// anyone, and the cost is that the file must actually be kept.
//
// The snapshot is built by *listing what goes in*, never by copying the
// dataset and deleting keys. A new parser field therefore cannot leak into the
// file by being forgotten: it has to be added here on purpose. The user's own
// handle is the only identifying value written.

export const SCHEMA_VERSION = 1;

/** Fields that must never appear in a snapshot, asserted on the way out. */
const FORBIDDEN = [
  'email', 'phone', 'dateOfBirth', 'signupIp', 'sensitive', 'ip', 'userAgent',
  'deviceId', 'cookie', 'lat', 'lng', 'coords', 'contactInformation',
];

function topCreators(affinityResult, limit = 200) {
  return affinityResult.creators.slice(0, limit).map((c) => ({
    u: c.u,
    score: c.score,
    n: c.interactions,
    v: c.view,
  }));
}

/**
 * The inbound ranking, so fan retention can be tracked between exports.
 *
 * Handle, name and counts only. A person whose display name never matched a
 * follower handle is written with `u: null` — the name is the only identifier
 * there is for them, and it is already in the DM data this file is derived
 * from. No message text, no timestamps beyond the month count.
 */
function topFans(fansResult, limit = 200) {
  return fansResult.fans.slice(0, limit).map((r) => ({
    u: r.u,
    name: r.name,
    score: r.score,
    n: r.received,
    m: r.months,
  }));
}

/**
 * Daily activity, aggregated. The raw impression rows (several thousand of
 * them, each with a caption) are never carried forward — only these buckets —
 * which is what keeps the file in the tens of KB no matter how many snapshots
 * accumulate.
 */
function dailyBuckets(data) {
  const buckets = {};
  const bump = (at, key) => {
    if (!at) return;
    const day = at.slice(0, 10);
    (buckets[day] ??= {})[key] = (buckets[day][key] ?? 0) + 1;
  };
  for (const x of data.consumption.storiesViewed) bump(x.at, 'v');
  for (const x of data.consumption.postsViewed) bump(x.at, 'v');
  for (const x of data.consumption.videosWatched) bump(x.at, 'v');
  for (const x of data.engagement.likes) bump(x.at, 'l');
  for (const x of data.engagement.comments) bump(x.at, 'c');
  for (const x of data.ads.adsViewed) bump(x.at, 'a');
  return buckets;
}

/** Build the snapshot written into the history file. */
export function buildSnapshot(data, results) {
  const snapshot = {
    generatedAt: data.meta.generatedAt ?? new Date().toISOString(),
    rangeStart: data.meta.rangeStart ?? null,
    rangeEnd: data.meta.rangeEnd ?? null,
    format: data.format,

    counts: {
      followers: data.followers.length,
      following: data.following.length,
      mutuals: results.audience.insights.mutuals,
      fans: results.audience.insights.fans,
      notFollowingBack: results.audience.insights.notFollowingBack,
      posts: data.content.posts.length,
      stories: data.content.stories.length,
      reels: data.content.reels.length,
      likes: data.engagement.likes.length,
      comments: data.engagement.comments.length,
      saved: data.engagement.saved.length,
      impressions: results.consumption.totals.impressions,
      adsViewed: data.ads.adsViewed.length,
      advertisers: data.ads.advertisers.length,
      offMetaApps: data.ads.offMeta.length,
      threads: results.messages.totals.threads,
      messages: results.messages.totals.messages,
      messagesSent: results.messages.totals.sent,
      syncedContacts: data.syncedContactCount,
      fans: results.fans.totals.people,
      consistentFans: results.fans.totals.consistent,
    },

    ratios: {
      followBackRate: results.audience.insights.followBackRate,
      fanPercentage: results.audience.insights.fanPercentage,
      mutualPercentage: results.audience.insights.mutualPercentage,
      followerFollowingRatio: results.audience.insights.followerFollowingRatio,
      // The one ratio that names an action ("unfollow these") had no trend line
      // until now. Older history files simply lack the key — `series()` skips
      // null points and the CSV writer unions the keys it finds, so a file
      // written before this existed still loads.
      nfbPercentage: results.audience.insights.nfbPercentage,
      oneSidedFollowPct: results.affinity.oneSidedPct,
      quietFollowerPct: results.affinity.quietPct,
      adSharePct: results.ads.adShare,
      lateNightPct: results.consumption.lateNight.pct,
      sentPct: results.messages.sentPct,
    },

    // Handles plus the dates they arrived — the basis for every delta and for
    // attribution. Plain text by design: this file lives on the user's disk.
    followers: data.followers.map((p) => ({ u: p.u, at: p.at })),
    following: data.following.map((p) => ({ u: p.u, at: p.at })),

    posts: data.content.published.map((m) => ({ at: m.at, type: m.type, n: m.mediaCount })),
    creators: topCreators(results.affinity),
    fans: topFans(results.fans),
    daily: dailyBuckets(data),
    advertisers: data.ads.advertisers.slice(0, 5000),
    offMetaApps: data.ads.offMeta.map((a) => a.app),
  };

  assertClean(snapshot);
  return snapshot;
}

/** Fail loudly if a forbidden key ever reaches the snapshot. */
export function assertClean(value, path = 'snapshot') {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertClean(item, `${path}[${i}]`));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN.includes(key)) {
      throw new Error(`Refusing to write "${key}" into the history file (at ${path}).`);
    }
    assertClean(item, `${path}.${key}`);
  }
}

export function emptyHistory(username) {
  return { schema: SCHEMA_VERSION, username: username ?? null, snapshots: [] };
}

/**
 * Add a snapshot, replacing any earlier one from the same export.
 *
 * `generatedAt` is the dedup key, so re-uploading the same ZIP is a no-op
 * rather than a duplicate data point that would flatten the trend line.
 */
export function mergeSnapshot(history, snapshot, username) {
  const base = history ?? emptyHistory(username);
  const snapshots = base.snapshots.filter((s) => s.generatedAt !== snapshot.generatedAt);
  snapshots.push(snapshot);
  snapshots.sort((a, b) => String(a.generatedAt).localeCompare(String(b.generatedAt)));
  return { schema: SCHEMA_VERSION, username: username ?? base.username, snapshots };
}

/** Read an uploaded history file, rejecting anything that is not one. */
export function parseHistory(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That history file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.snapshots)) {
    throw new Error('That file is not an analysis history — expected a "snapshots" list.');
  }
  if (parsed.schema > SCHEMA_VERSION) {
    throw new Error(
      `That history was written by a newer version (schema ${parsed.schema}). Update the tool first.`,
    );
  }
  return { schema: parsed.schema ?? 1, username: parsed.username ?? null, snapshots: parsed.snapshots };
}

export function serializeHistory(history) {
  return JSON.stringify(history, null, 2);
}

export function historyFilename(username) {
  const safe = (username ?? 'account').replace(/[^A-Za-z0-9._-]/g, '_');
  return `insta-history-${safe}.json`;
}

/**
 * Flat metric-per-snapshot CSV, for spreadsheets.
 *
 * The history file itself stays JSON because a snapshot is nested — follower
 * lists, daily buckets, creator rankings — and flattening it would lose the
 * very data the deltas are computed from. This is a derived view, not the
 * canonical format: it cannot be re-imported.
 */
export function historyToCsv(history) {
  const rows = history.snapshots;
  if (!rows.length) return 'generatedAt\n';

  const columns = ['generatedAt', 'rangeStart', 'rangeEnd'];
  const groups = ['counts', 'ratios'];
  for (const group of groups) {
    const keys = new Set();
    for (const row of rows) for (const key of Object.keys(row[group] ?? {})) keys.add(key);
    for (const key of [...keys].sort()) columns.push(`${group}.${key}`);
  }

  const cell = (row, column) => {
    if (!column.includes('.')) return row[column] ?? '';
    const [group, key] = column.split('.');
    return row[group]?.[key] ?? '';
  };
  const escape = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

  return [
    columns.join(','),
    ...rows.map((row) => columns.map((c) => escape(cell(row, c))).join(',')),
  ].join('\n');
}
