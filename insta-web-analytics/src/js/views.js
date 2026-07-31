// views.js — one renderer per tab.

import {
  h, fmt, pct, shortDate, duration, tile, table, card, chartCard, section, notice, handle, chip,
} from './ui.js';
import {
  columnChart, stackedChart, lineChart, barsChart, heatmapChart, sparkline,
} from './charts.js';
import { goTo } from './nav.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourLabel = (h24) => `${((h24 + 11) % 12) + 1}${h24 < 12 ? 'am' : 'pm'}`;

const peopleColumns = [
  { key: 'u', label: 'Account', render: (v) => handle(v) },
  { key: 'name', label: 'Name' },
  { key: 'at', label: 'Since', render: (v) => shortDate(v) },
];

/** Wraps a card so an overview tile can scroll straight to it. */
const anchored = (id, node) => h('div', { id }, node);

/**
 * Link one of your own posts.
 *
 * The export gives no permalink for your own media, so the destination is your
 * profile grid and the label says when the post went out — enough to find it.
 */
function postLink(username, caption, row) {
  const text = caption || `${shortDate(row.at)} · ${row.type}`;
  if (!username) return caption || h('span', { class: 'muted' }, '(none)');
  return h('a', {
    href: `https://www.instagram.com/${encodeURIComponent(username)}/`,
    target: '_blank',
    rel: 'noopener noreferrer',
    title: 'Opens your profile grid — Instagram does not include post links in an export',
    class: caption ? null : 'muted',
  }, text);
}

/**
 * `lat, lng` as one linked cell — two raw float columns helped nobody.
 *
 * Rounded rather than padded: this data mixes metre-precise points
 * (12.972867074498) with country centroids (15), and padding the latter to
 * "15.00000" would imply a precision the record does not have. The link always
 * carries the exact value.
 */
function coordsCell(row) {
  if (typeof row.lat !== 'number' || typeof row.lng !== 'number') return '—';
  const trim = (n) => String(Math.round(n * 1e5) / 1e5);
  const shown = `${trim(row.lat)}, ${trim(row.lng)}`;
  return h('a', {
    href: `https://www.google.com/maps?q=${row.lat},${row.lng}`,
    target: '_blank',
    rel: 'noopener noreferrer',
    title: 'Open this exact spot in Google Maps',
  }, shown);
}

const countTable = (rows, keyLabel, valueLabel) => () =>
  table(
    [{ key: 'key', label: keyLabel }, { key: 'count', label: valueLabel, num: true }],
    rows,
    { filter: rows.length > 15 },
  );

/** Coverage of the data, worded for a human. */
function coverageLabel(meta) {
  if (!meta.spliced) return 'All time';
  return `${shortDate(meta.rangeStart)} – ${shortDate(meta.rangeEnd)}`;
}

/**
 * Account identity: name above handle, then state-carrying chips, with the
 * generation date pushed to the right.
 */
function profileHeader(data) {
  const p = data.profile;
  const chips = [
    chip(p.isPrivate ? 'lock' : 'globe', `${p.isPrivate ? 'Private' : 'Public'} account`),
    p.createdAt ? chip('calendar', `Joined ${shortDate(p.createdAt)}`) : null,
    p.basedIn?.city ? chip('pin', p.basedIn.city) : null,
    // The one chip that changes tone: a sliced window is a caveat on every
    // number below it, so it must not look like ordinary metadata.
    chip('history', coverageLabel(data.meta), { tone: data.meta.spliced ? 'warn' : null }),
  ].filter(Boolean);

  return h('header', { class: 'profile-head' },
    h('div', { class: 'profile-id' },
      // Read straight out of the archive as a blob: URL — decorative, since the
      // name it sits beside already carries the identity.
      p.avatarUrl
        ? h('img', { class: 'profile-avatar', src: p.avatarUrl, alt: '', width: 64, height: 64 })
        : null,
      h('div', {},
        h('h2', {}, p.name || p.username || 'Your account'),
        p.name && p.username ? h('p', { class: 'profile-handle' }, `@${p.username}`) : null,
      ),
    ),
    h('div', { class: 'profile-chips' }, ...chips),
    h('p', { class: 'profile-generated' }, `Generated ${shortDate(data.meta.generatedAt)}`),
  );
}

// ── Overview ───────────────────────────────────────────────────────────────
export function overview(data, results) {
  const a = results.audience.insights;
  const change = results.audience.change;
  const spliced = Boolean(data.meta.spliced);
  const frag = document.createDocumentFragment();

  frag.append(profileHeader(data));

  if (spliced) {
    frag.append(notice(
      '<strong>This is part of your timeline, not all of it.</strong> Your follower list covers only the ' +
      'date range you picked; your following list is complete either way. Mutuals, fans and follow-back ' +
      'rate are not like-for-like. Request your data again with the <strong>complete timeline</strong>.',
      'warn',
    ));
  }

  frag.append(section(null, null,
    h('div', { class: 'grid cols-4' },
      tile(spliced ? 'New followers (in range)' : 'Followers', a.followers, {
        delta: change ? change.newFollowers.length - change.unfollowers.length : null,
        deltaLabel: 'since last upload',
        onClick: () => goTo('audience', 'list-followers'),
      }),
      tile('Following', a.following, {
        delta: change ? change.newlyFollowing.length - change.youUnfollowed.length : null,
        deltaLabel: 'since last upload',
        goodWhenUp: null,
        onClick: () => goTo('audience', 'list-following'),
      }),
      tile('Mutuals', a.mutuals, {
        sub: `${pct(a.mutualPercentage)} of followers`,
        onClick: () => goTo('audience', 'list-mutuals'),
      }),
      tile('Follow-back rate', pct(a.followBackRate), { sub: `${a.notFollowingBack} don't follow back` }),
    ),
  ));

  // Every number here has a list behind it, so each tile is a way in rather
  // than a dead end — the reader should not have to hunt for the names.
  frag.append(section('Your relationships', null,
    h('div', { class: 'grid cols-4' },
      tile("Don't follow you back", a.notFollowingBack, {
        goodWhenUp: false,
        onClick: () => goTo('audience', 'list-not-following-back'),
      }),
      tile('Fans', a.fans, {
        sub: "follow you, you don't follow back",
        onClick: () => goTo('audience', 'list-fans'),
      }),
      change
        ? tile('Unfollowed you', change.unfollowers.length, {
            goodWhenUp: false,
            onClick: () => goTo('audience', 'list-unfollowers'),
          })
        : tile('Unfollowed you', '—', { sub: 'needs a second upload' }),
      change
        ? tile('New followers', change.newFollowers.length, {
            onClick: () => goTo('audience', 'list-new-followers'),
          })
        : tile('New followers', '—', { sub: 'needs a second upload' }),
    ),
  ));

  const adWin = results.ads.adShareWindow;
  frag.append(section('Your activity', null,
    h('div', { class: 'grid cols-4' },
      tile('Posts published', results.content.totals.published, {
        sub: `${results.content.totals.posts} posts · ${results.content.totals.stories} stories · ${results.content.totals.reels} reels`,
      }),
      tile('Things you watched', results.consumption.totals.impressions, {
        // Instagram keeps only recent impressions whatever range you ask for,
        // so this figure is never lifetime. Say the window rather than imply one.
        sub: `last ${results.consumption.activeDays} days · ${fmt(results.consumption.perActiveDay.median ?? 0)}/day typical`,
      }),
      tile('Likes given', data.engagement.likes, {
        sub: `${fmt(data.engagement.comments)} comments written`,
      }),
      tile('Ads shown to you', results.ads.totals.adsViewed, {
        sub: adWin
          ? `${pct(results.ads.adShare)} of what you saw in those ${adWin.days} days`
          : `${pct(results.ads.adShare)} of what you saw`,
      }),
    ),
  ));

  const acquisition = results.audience.acquisition;
  if (acquisition.length > 1) {
    frag.append(section('When your current followers arrived', null,
      chartCard(
        'Cumulative followers by join month',
        'Counts only followers you still have — anyone who left is absent from your data, so this is a floor.',
        lineChart(acquisition.map((p) => ({ key: p.month.slice(2), value: p.cumulative })), { label: 'followers' }),
        {
          tableView: () => table(
            [
              { key: 'month', label: 'Month' },
              { key: 'added', label: 'Joined', num: true },
              { key: 'cumulative', label: 'Running total', num: true },
            ],
            acquisition,
          ),
        },
      ),
    ));
  }

  if (!results.trends.available) {
    frag.append(section(null, null, notice(
      '<strong>This is your first upload.</strong> Download the history file from the Export tab before you ' +
      'close this page — nothing is saved. Upload it next time for trend lines and who followed or left.',
    )));
  }
  return frag;
}

// ── Audience ───────────────────────────────────────────────────────────────
export function audienceView(data, results) {
  const r = results.audience;
  const frag = document.createDocumentFragment();

  frag.append(section('Relationships', null,
    h('div', { class: 'grid cols-4' },
      tile('Mutuals', r.insights.mutuals),
      tile("Don't follow you back", r.insights.notFollowingBack, { goodWhenUp: false }),
      tile('Fans', r.insights.fans, { sub: 'follow you, you don\'t follow back' }),
      tile('Follower / following', r.insights.followerFollowingRatio),
    ),
    h('div', { class: 'grid cols-2 stack' },
      anchored('list-followers',
        card('Followers', `${r.followers.length} accounts.`,
          table(peopleColumns, r.followers, { filter: true }))),
      anchored('list-following',
        card('Following', `${r.following.length} accounts.`,
          table(peopleColumns, r.following, { filter: true }))),
      anchored('list-mutuals',
        card('Mutuals', 'You follow each other.',
          table(peopleColumns, r.mutuals, { filter: true }))),
      anchored('list-not-following-back',
        card("Don't follow you back", 'You follow them; they don\'t follow you.',
          table(peopleColumns, r.notFollowingBack, { filter: true }))),
      anchored('list-fans',
        card('Fans', 'They follow you; you don\'t follow back.',
          table(peopleColumns, r.fans, { filter: true }))),
    ),
  ));

  if (r.change) {
    frag.append(section('Since your last upload', `Compared with the data generated ${shortDate(results.comparedWith)}.`,
      h('div', { class: 'grid cols-4' },
        tile('New followers', r.change.newFollowers.length),
        tile('Unfollowed you', r.change.unfollowers.length, { goodWhenUp: false }),
        tile('Churn rate', pct(r.change.churnRate), { goodWhenUp: false }),
        tile('Retention', pct(r.change.retentionRate)),
      ),
      h('div', { class: 'grid cols-2 stack' },
        anchored('list-unfollowers',
          card('Who unfollowed you', null, table(peopleColumns, r.change.unfollowers, { filter: true }))),
        anchored('list-new-followers',
          card('Who started following', null, table(peopleColumns, r.change.newFollowers, { filter: true }))),
      ),
    ));
  }

  const rec = r.reciprocity;
  if (rec.rows.length) {
    frag.append(section('Reciprocity',
      'How long you took to follow back.',
      h('div', { class: 'grid cols-3' },
        tile('Median follow-back gap', rec.medianLagHours === null ? '—' : duration(Math.abs(rec.medianLagHours) * 3600)),
        tile('Same-minute follow-backs', rec.instant, { sub: 'straight from the notification' }),
        tile('You followed first', rec.youFirst, { sub: `of ${rec.rows.length} mutuals` }),
      ),
    ));
  }

  if (r.cohorts.length > 1) {
    frag.append(section('Cohort retention',
      'Of the followers who arrived each month, how many are still here.',
      card(null, null, table(
        [
          { key: 'month', label: 'Joined' },
          { key: 'joined', label: 'Followers', num: true },
          { key: 'retained', label: 'Still here', num: true },
          { key: 'rate', label: 'Retention', num: true, render: (v) => pct(v) },
        ],
        r.cohorts,
      )),
    ));
  }

  frag.append(section('Departures and blocks', 'Recorded by Instagram directly.',
    h('div', { class: 'grid cols-2' },
      card('Recently unfollowed by you', null, table(peopleColumns, r.recentlyUnfollowed)),
      card('Blocked accounts', null, table(peopleColumns, r.blocked)),
    ),
  ));
  return frag;
}

// ── Growth attribution ─────────────────────────────────────────────────────
export function growthView(data, results) {
  const at = results.attribution;
  const frag = document.createDocumentFragment();

  frag.append(section('Which posts brought followers in',
    `Each follower is credited to the last post before they arrived, within ${at.windowDays} days. ` +
    'Correlation, not proof.',
    h('div', { class: 'grid cols-4' },
      tile('Followers attributed', at.attributed, { sub: `${at.unattributed} arrived with no recent post` }),
      tile('Baseline', `${at.baselinePerDay}/day`, { sub: 'your ordinary acquisition rate' }),
      tile('Best day to post', at.bestDay ? at.bestDay.key : '—', {
        sub: at.bestDay ? `${at.bestDay.perPost} followers per post` : null,
      }),
      tile('Best hour', at.bestHour ? hourLabel(Number(at.bestHour.key)) : '—', {
        sub: at.bestHour ? `${at.bestHour.perPost} followers per post` : null,
      }),
    ),
    h('div', { class: 'grid cols-3' },
      tile('Best format', at.bestType ? at.bestType.type : '—', {
        sub: at.bestType ? `${at.bestType.perPost} per post across ${at.bestType.posts}` : null,
      }),
      tile('Weakest format', at.worstType ? at.worstType.type : '—', {
        sub: at.worstType ? `${at.worstType.perPost} per post across ${at.worstType.posts}` : null,
        goodWhenUp: false,
      }),
      // Older half of your posting history against the newer half — whether
      // what you post now pulls more people in than what you used to post.
      at.trend
        ? tile('Recent vs earlier', `${at.trend.newerAvg} per post`, {
            delta: at.trend.change,
            deltaLabel: `vs ${at.trend.olderAvg} earlier`,
          })
        : tile('Recent vs earlier', '—', { sub: 'needs more posts to compare' }),
    ),
  ));

  if (at.confidence === 'low') {
    frag.append(notice(
      `<strong>Too little data to rank reliably.</strong> This account has ${at.sample.followers} followers ` +
      `across ${at.sample.posts} published items. The arithmetic is right, but one follower moves the ranking.`,
      'warn',
    ));
  }

  if (at.posts.length) {
    frag.append(section(null, null, card(
      'Posts ranked by followers gained',
      'Each follower counted once. "Lift" compares the 7-day gain with your baseline.',
      table(
        [
          { key: 'at', label: 'Published', render: (v) => shortDate(v) },
          { key: 'type', label: 'Type' },
          {
            key: 'caption',
            label: 'Caption',
            // Your own posts carry no permalink anywhere in the export — no URL,
            // no shortcode, no media ID — so this opens your grid rather than
            // pretending to deep-link. Captionless posts still need a label, or
            // the anchor would be an invisible click target.
            render: (v, row) => postLink(data.profile.username, v, row),
          },
          { key: 'lastTouch', label: 'Followers', num: true },
          { key: 'gained24h', label: '24h', num: true },
          { key: 'gained7d', label: '7d', num: true },
          { key: 'lift', label: 'Lift', num: true },
        ],
        at.posts,
        // Sorted by followers gained, so the tail is all zeros. Sort or filter
        // reaches the rest without making the page enormous by default.
        { filter: true, limit: 50 },
      ),
    )));
  }

  if (at.byDay.length) {
    frag.append(section('Timing', null,
      h('div', { class: 'grid cols-2' },
        chartCard('Followers gained per post, by weekday', null,
          columnChart(
            DAY_NAMES.map((name) => {
              const row = at.byDay.find((d) => d.key === name);
              return { key: name, count: row ? row.perPost : 0 };
            }),
            { label: 'followers per post' },
          ),
          { tableView: countTable(at.byDay.map((d) => ({ key: d.key, count: d.perPost })), 'Day', 'Per post') },
        ),
        chartCard('By content type', null,
          barsChart(at.byType.map((t) => ({ key: t.type, count: t.perPost })), { label: 'followers per post' }),
          { tableView: countTable(at.byType.map((t) => ({ key: t.type, count: t.perPost })), 'Type', 'Per post') },
        ),
      ),
    ));
  }
  return frag;
}

// ── Content ────────────────────────────────────────────────────────────────
export function contentView(data, results) {
  const c = results.content;
  const frag = document.createDocumentFragment();

  frag.append(section('What you publish',
    `${shortDate(c.firstAt)} to ${shortDate(c.lastAt)}.`,
    h('div', { class: 'grid cols-4' },
      tile('Published items', c.totals.published, { sub: `${c.perActiveMonth}/month when active · ${c.activeMonths} of ${c.elapsedMonths} months` }),
      tile('Active days', c.streaks.activeDays, { sub: `longest streak ${c.streaks.longestStreak} days` }),
      tile('Longest silence', `${c.streaks.longestGapDays}d`, {
        sub: c.streaks.gapFrom ? `${shortDate(c.streaks.gapFrom)} → ${shortDate(c.streaks.gapTo)}` : null,
        goodWhenUp: false,
      }),
      tile('Geotagged', c.flags.geotagged, { sub: `${pct(c.flags.geotaggedPct)} of posts`, goodWhenUp: false }),
    ),
  ));

  if (c.cadence.length) {
    frag.append(section(null, null, chartCard(
      'Publishing cadence by month',
      'Posts, stories and reels stacked.',
      stackedChart(c.cadence, [
        { key: 'post', name: 'Posts' },
        { key: 'story', name: 'Stories' },
        { key: 'reel', name: 'Reels' },
      ]),
      {
        legend: [{ name: 'Posts' }, { name: 'Stories' }, { name: 'Reels' }],
        tableView: () => table(
          [
            { key: 'month', label: 'Month' },
            { key: 'post', label: 'Posts', num: true },
            { key: 'story', label: 'Stories', num: true },
            { key: 'reel', label: 'Reels', num: true },
            { key: 'total', label: 'Total', num: true },
          ],
          c.cadence,
        ),
      },
    )));
  }

  frag.append(section(null, null, h('div', { class: 'grid cols-2' },
    chartCard('When you post', 'Weekday against hour of day.',
      heatmapChart(c.heatmap, { label: 'posts' }),
      {
        tableView: () => table(
          [{ key: 'name', label: 'Day' }, { key: 'count', label: 'Posts', num: true }],
          c.byWeekday,
        ),
      }),
    chartCard('Hour of day', null,
      columnChart(c.byHour.map((b) => ({ key: String(b.hour), count: b.count })), { label: 'posts' }),
      { tableView: countTable(c.byHour.map((b) => ({ key: hourLabel(b.hour), count: b.count })), 'Hour', 'Posts') }),
  )));

  if (c.hashtags.length) {
    frag.append(section(null, null, h('div', { class: 'grid cols-2' },
      chartCard('Hashtags you use', null, barsChart(c.hashtags, { label: 'posts' }),
        { tableView: countTable(c.hashtags, 'Hashtag', 'Posts') }),
      card('Content flags', null, table(
        [{ key: 'k', label: 'Flag' }, { key: 'v', label: 'Count', num: true }],
        [
          { k: 'Carousels', v: c.totals.carousels },
          { k: 'Paid partnership', v: c.flags.paidPartnership },
          { k: 'Marked as advertisement', v: c.flags.advertisement },
          { k: 'Marked AI generated', v: c.flags.aiGenerated },
          { k: 'Audio muted', v: c.flags.audioMuted },
          { k: 'Deleted (recoverable)', v: c.totals.deleted },
        ],
      )),
    )));
  }

  if (c.geo.length) {
    frag.append(section('Location-tagged content',
      'Metre-precise, and in your data even though the image files are stripped of EXIF.',
      card(null, null, table(
        [
          { key: 'at', label: 'When', render: (v) => shortDate(v) },
          { key: 'place', label: 'Place' },
          { key: 'lat', label: 'Coordinates', num: true, render: (v, row) => coordsCell(row) },
          { key: 'caption', label: 'Caption' },
        ],
        c.geo,
      )),
    ));
  }
  return frag;
}

// ── Your engagement ────────────────────────────────────────────────────────
export function engagementView(data, results) {
  const af = results.affinity;
  const frag = document.createDocumentFragment();

  frag.append(section('Who you pay attention to',
    'Your data records no engagement received — only what you gave. This is that.',
    h('div', { class: 'grid cols-4' },
      tile('Creators you engaged with', af.engagedCreators),
      tile('Creators you watched', af.watchedCreators, {
        sub: af.watchedCoverage ? `last ${af.watchedCoverage.days} days` : null,
      }),
      tile('Likes given', data.engagement.likes),
      tile('Comments written', data.engagement.comments),
      tile('Story responses', af.storyResponseCount, {
        sub: 'polls, quizzes, sliders, countdowns',
      }),
    ),
  ));

  if (af.recentLinks.length) {
    frag.append(section('What you interacted with',
      `The most recent ${af.recentLinks.length}. Your own posts carry no link, so these are the only real ones.`,
      card(null, null, table(
        [
          { key: 'at', label: 'When', render: (v) => shortDate(v) },
          { key: 'kind', label: 'What' },
          { key: 'u', label: 'Creator', render: (v) => handle(v) },
          {
            key: 'url',
            label: 'Post',
            render: (v) => (v
              ? h('a', { href: v, target: '_blank', rel: 'noopener noreferrer' }, 'Open ↗')
              : '—'),
          },
        ],
        af.recentLinks,
        { filter: true },
      )),
    ));
  }

  // Two lists, not one merged score. Deliberate interactions reach back years
  // while view history reaches back days, so a single ranking simply buried
  // the viewing data — every top creator scored with zero views.
  const owner = (rows, valueKey, label) => () => table(
    [
      { key: 'u', label: 'Creator', render: (v) => handle(v) },
      { key: valueKey, label, num: true },
      { key: 'youFollow', label: 'You follow', render: (v) => (v ? 'yes' : '—') },
      { key: 'followsYou', label: 'Follows you', render: (v) => (v ? 'yes' : '—') },
    ],
    rows,
    { filter: true },
  );

  frag.append(section(null, null, h('div', { class: 'grid cols-2' },
    chartCard(
      'Creators you engage with',
      `Likes, comments and saves${af.engagedCoverage ? ` across ${af.engagedCoverage.days} days` : ''}. ` +
      `Weighted: comment ×${af.weights.comment}, save ×${af.weights.save}, like ×${af.weights.like}.`,
      barsChart(af.engaged.slice(0, 12).map((c) => ({ key: c.u, count: c.score })), { label: 'affinity' }),
      { tableView: owner(af.engaged, 'score', 'Affinity') },
    ),
    chartCard(
      'Creators you watch',
      `Stories, reels and posts viewed${af.watchedCoverage ? ` in the last ${af.watchedCoverage.days} days` : ''}. ` +
      'Instagram keeps only recent viewing history.',
      barsChart(af.watched.slice(0, 12).map((c) => ({ key: c.u, count: c.view })), { label: 'views' }),
      { tableView: owner(af.watched, 'view', 'Views') },
    ),
  )));

  frag.append(section('One-sided follows',
    'Accounts you follow that have never produced a like, comment, save or view from you.',
    h('div', { class: 'grid cols-3' },
      tile('One-sided follows', af.oneSidedCount, { sub: `${pct(af.oneSidedPct)} of everyone you follow`, goodWhenUp: false }),
      tile('You engage, they ignore', af.unreciprocated.length, { sub: 'no follow back from them', goodWhenUp: false }),
      tile('Engaged mutuals', af.mutualEngaged.length),
    ),
    h('div', { class: 'grid cols-2 stack' },
      card('You follow, never engaged', null, table(
        [
          { key: 'u', label: 'Account', render: (v) => handle(v) },
          { key: 'at', label: 'Followed since', render: (v) => shortDate(v) },
          { key: 'everSeen', label: 'Seen in feed', render: (v) => (v ? 'yes' : 'never') },
        ],
        af.oneSidedFollows,
        { filter: true },
      )),
      card('You engage, they don\'t follow back', null, table(
        [
          { key: 'u', label: 'Creator', render: (v) => handle(v) },
          { key: 'interactions', label: 'Interactions', num: true },
          { key: 'score', label: 'Affinity', num: true },
        ],
        af.unreciprocated,
        { filter: true },
      )),
    ),
  ));

  frag.append(section('Quiet followers',
    'Followers whose content has never appeared in anything you did — no like, comment, save or view.',
    h('div', { class: 'grid cols-3' },
      tile('Quiet followers', af.quietCount, {
        sub: `${pct(af.quietPct)} of your followers`,
        goodWhenUp: null,
      }),
      tile('Followers you engage with', Math.max(0, results.audience.insights.followers - af.quietCount), {
        sub: 'their content reaches you',
      }),
      // Quiet *and* followed back is the pointed subset: a following slot spent
      // on someone whose posts you have never once looked at.
      tile('Quiet, and you follow back', af.quietFollowers.filter((p) => p.youFollow).length, {
        sub: 'you follow them, you never engage',
        goodWhenUp: false,
      }),
    ),
    notice(
      '<strong>This is not "who ignores you".</strong> That needs the engagement your posts received, and ' +
      'Instagram puts none of it in an export — every engagement file records something <em>you</em> did.',
    ),
    card(null, null, table(
      [
        { key: 'u', label: 'Account', render: (v) => handle(v) },
        { key: 'name', label: 'Name' },
        { key: 'at', label: 'Following you since', render: (v) => shortDate(v) },
        { key: 'youFollow', label: 'You follow back', render: (v) => (v ? 'yes' : '—') },
      ],
      af.quietFollowers,
      { filter: true },
    )),
  ));
  return frag;
}

// ── Consumption ────────────────────────────────────────────────────────────
export function consumptionView(data, results) {
  const c = results.consumption;
  const frag = document.createDocumentFragment();

  frag.append(section('How much you watch',
    'Volume and timing only — impressions carry no duration.',
    h('div', { class: 'grid cols-4' },
      tile('Items viewed', c.totals.impressions, { sub: `over ${c.activeDays} active days` }),
      tile('Typical day', c.perActiveDay.median ?? 0, { sub: `busiest ${fmt(c.perActiveDay.max)} on ${shortDate(c.perActiveDay.maxDay)}` }),
      tile('Late night', pct(c.lateNight.pct), { sub: `${fmt(c.lateNight.count)} items between midnight and 5am`, goodWhenUp: false }),
      tile('Ads in the mix', pct(results.ads.adShare), { goodWhenUp: false }),
    ),
  ));

  if (c.daily.length > 1) {
    frag.append(section(null, null, chartCard(
      'Items viewed per day', null,
      lineChart(c.daily.map((d) => ({ key: d.key.slice(5), value: d.count })), { label: 'items' }),
      { tableView: countTable(c.daily.map((d) => ({ key: d.key, count: d.count })), 'Day', 'Items') },
    )));
  }

  frag.append(section(null, null, h('div', { class: 'grid cols-2' },
    chartCard('When you scroll', 'Weekday against hour of day.', heatmapChart(c.heatmap),
      { tableView: countTable(c.byHour.map((b) => ({ key: hourLabel(b.hour), count: b.count })), 'Hour', 'Items') }),
    chartCard('Creators you watch most', null, barsChart(c.topCreators, { label: 'items' }),
      { tableView: countTable(c.topCreators, 'Creator', 'Items') }),
  )));

  frag.append(section(null, null, h('div', { class: 'grid cols-2' },
    chartCard('Hashtags in what you watch', null, barsChart(c.hashtags, { label: 'items' }),
      { tableView: countTable(c.hashtags, 'Hashtag', 'Items') }),
    card('In-app browsing', `${c.links.total} links opened inside Instagram.`,
      h('div', {},
        h('p', { class: 'sub' },
          `Total dwell ${duration(c.links.totalSeconds)} · median ${duration(c.links.medianSeconds)} per visit. ` +
          'The only duration data anywhere in your Instagram data.'),
        table([{ key: 'key', label: 'Site' }, { key: 'count', label: 'Visits', num: true }], c.links.hosts))),
  )));

  if (c.searches.length) {
    frag.append(section('Searches', null, card(null, null, table(
      [{ key: 'q', label: 'Search' }, { key: 'at', label: 'When', render: (v) => shortDate(v) }],
      c.searches, { filter: true },
    ))));
  }
  return frag;
}

// ── Ads & tracking ─────────────────────────────────────────────────────────
export function adsView(data, results) {
  const a = results.ads;
  const frag = document.createDocumentFragment();

  frag.append(section('Advertising and tracking', null,
    h('div', { class: 'grid cols-4' },
      tile('Ads shown to you', a.totals.adsViewed, { sub: `${a.perDay}/day`, goodWhenUp: false }),
      tile('Share of your feed', pct(a.adShare), { goodWhenUp: false }),
      tile('Advertisers holding your data', a.totals.advertisersWithYourData, { goodWhenUp: false }),
      tile('Apps reporting you to Meta', a.totals.offMetaApps, {
        sub: `${fmt(a.totals.offMetaEvents)} events`, goodWhenUp: false,
      }),
    ),
  ));

  if (a.daily.length > 1) {
    frag.append(section(null, null, chartCard('Ads seen per day', null,
      lineChart(a.daily.map((d) => ({ key: d.key.slice(5), value: d.count })), { label: 'ads' }),
      { tableView: countTable(a.daily.map((d) => ({ key: d.key, count: d.count })), 'Day', 'Ads') })));
  }

  frag.append(section(null, null, h('div', { class: 'grid cols-2' },
    chartCard('Accounts advertising to you', null, barsChart(a.topAdvertiserAccounts, { label: 'ads' }),
      { tableView: countTable(a.topAdvertiserAccounts, 'Account', 'Ads') }),
    card('Activity sent from other apps',
      'Businesses that reported your activity to Meta from outside Instagram.',
      table(
        [
          { key: 'app', label: 'App or site' },
          { key: 'events', label: 'Events', num: true },
          { key: 'kinds', label: 'Kinds', render: (v) => v.join(', ') },
          { key: 'last', label: 'Last seen', render: (v) => shortDate(v) },
        ],
        a.offMeta,
      )),
  )));

  frag.append(section(null, null, h('div', { class: 'grid cols-2' },
    card(`${fmt(a.advertisers.length)} advertisers hold data on you`,
      'Companies that uploaded a contact list matching you, or matched you after a site visit.',
      table([{ key: 'name', label: 'Advertiser' }], a.advertisers.map((name) => ({ name })), { filter: true, limit: 100 })),
    card('Ad interest categories', null,
      table([{ key: 'name', label: 'Category' }], a.topics.map((name) => ({ name })), { filter: a.topics.length > 15 })),
  )));
  return frag;
}

// ── Messages ───────────────────────────────────────────────────────────────
export function messagesView(data, results) {
  const m = results.messages;
  const frag = document.createDocumentFragment();

  frag.append(section('Direct messages',
    'Counts and timing only. Message text is measured, then discarded — never written to the history file.',
    h('div', { class: 'grid cols-4' },
      tile('Threads', m.totals.threads, { sub: `${m.totals.requests} message requests` }),
      tile('Messages', m.totals.messages, { sub: `${pct(m.sentPct)} sent by you` }),
      tile('Median reply time', duration(m.medianReplySeconds)),
      tile('Reshared posts', m.totals.shares, { sub: `${pct(m.sharePct)} of all messages` }),
    ),
  ));

  frag.append(section(null, null, h('div', { class: 'grid cols-2' },
    chartCard('Messaging by hour', `Busiest at ${hourLabel(m.peakHour)}.`,
      columnChart(m.byHour.map((b) => ({ key: String(b.hour), count: b.count })), { label: 'messages' }),
      { tableView: countTable(m.byHour.map((b) => ({ key: hourLabel(b.hour), count: b.count })), 'Hour', 'Messages') }),
    chartCard('Busiest threads', null,
      barsChart(m.busiest.map((t) => ({ key: t.title, count: t.total })), { label: 'messages' }),
      { tableView: countTable(m.busiest.map((t) => ({ key: t.title, count: t.total })), 'Thread', 'Messages') }),
  )));

  frag.append(section(null, null, card('All threads', null, table(
    [
      { key: 'title', label: 'Thread' },
      { key: 'total', label: 'Messages', num: true },
      { key: 'sent', label: 'You sent', num: true },
      { key: 'sentPct', label: 'Your share', num: true, render: (v) => pct(v) },
      { key: 'medianReplySeconds', label: 'Your median reply', num: true, render: (v) => duration(v) },
      { key: 'last', label: 'Last message', render: (v) => shortDate(v) },
    ],
    m.threads,
    { filter: true },
  ))));
  return frag;
}

// ── Privacy audit ──────────────────────────────────────────────────────────
export function privacyView(data, results) {
  const p = results.privacy;
  const frag = document.createDocumentFragment();

  frag.append(section('What this ZIP would tell an attacker',
    'Read in memory only, never written to the history file. Check it before you send your data to anyone.',
    h('div', { class: 'grid cols-4' },
      tile('Findings', p.findings.length, { goodWhenUp: false }),
      tile('IP addresses', p.identifiers.ipCount, { goodWhenUp: false }),
      tile("Other people's numbers", p.identifiers.contactCount, { sub: 'from contact syncing', goodWhenUp: false }),
      tile('Precise GPS points', p.identifiers.gpsCount, { goodWhenUp: false }),
    ),
  ));

  frag.append(section(null, null, card('Findings', null,
    h('div', {}, ...p.findings.map((f) => h('div', { class: 'finding' },
      h('span', { class: `sev sev-${f.severity}` }),
      h('div', {},
        h('h4', {}, f.title),
        h('p', {}, f.detail),
        h('code', {}, f.file)),
    ))),
  )));

  frag.append(section(null, null, h('div', { class: 'grid cols-2' },
    card('Not present — confirmed', 'Absent from your data, so a leak would not immediately hand over your account.',
      h('div', {}, ...p.cleared.map((c) => h('div', { class: 'finding' },
        h('span', { class: 'sev sev-low' }),
        h('div', {}, h('h4', {}, c.title), h('p', {}, c.detail)))))),
    card('Settings worth checking', null, table(
      [
        { key: 'label', label: 'Setting' },
        {
          key: 'value',
          label: 'Current',
          render: (v, row) => h('span', { class: `pill ${row.good ? 'good' : ''}` },
            typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v)),
        },
      ],
      p.settings,
    )),
  )));

  frag.append(section(null, null, notice(
    '<strong>Before sharing this ZIP with anyone</strong>, delete at minimum: ' +
    '<code>personal_information/personal_information/personal_information.html</code>, ' +
    '<code>signup_details.html</code>, <code>synced_contacts.html</code>, ' +
    '<code>login_activity.html</code>, <code>profile_activity.html</code>, and the ' +
    '<code>media/*.html</code> manifests that carry coordinates.',
    'danger',
  )));
  return frag;
}

// ── Trends ─────────────────────────────────────────────────────────────────
export function trendsView(data, results) {
  const t = results.trends;
  const frag = document.createDocumentFragment();

  if (!t.available) {
    frag.append(section('Trends',
      'Trends need two or more exports.',
      notice(
        '<strong>You have uploaded one export.</strong> Download the history file from the Export tab, keep it ' +
        'somewhere safe, and upload it together with your next Instagram export. You will then get: a trend line ' +
        'on every number in this dashboard, the names of everyone who followed and unfollowed in between, ' +
        'true cohort retention, and any advertisers that newly acquired your data.',
      )));
    return frag;
  }

  const signed = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${fmt(v)}`);
  const counted = (key) => t.metrics.find((m) => m.key === key && m.group === 'counts') ?? null;
  const followersM = counted('followers');
  const followingM = counted('following');

  frag.append(section('Growth', `Across ${t.snapshots} snapshots, ${shortDate(t.span.from)} to ${shortDate(t.span.to)}.`,
    h('div', { class: 'grid cols-4' },
      tile('Follower growth', signed(followersM?.changeTotal), { sub: 'since your first upload' }),
      // Per upload rather than in total: the figure that stays comparable as
      // snapshots accumulate, and the one the desktop app reports.
      tile('Average per upload', signed(followersM?.changePerSnapshot), {
        sub: `over ${t.snapshots - 1} interval${t.snapshots === 2 ? '' : 's'}`,
      }),
      tile('Following growth', signed(followingM?.changeTotal), { goodWhenUp: null }),
      tile('Average per upload', signed(followingM?.changePerSnapshot), { goodWhenUp: null }),
    ),
  ));

  frag.append(section('Every upload, side by side',
    'One row per interval between snapshots — what each upload changed.',
    card(null, null, table(
      [
        { key: 'to', label: 'Upload', render: (v) => shortDate(v) },
        { key: 'followersAfter', label: 'Followers', num: true },
        { key: 'net', label: 'Δ followers', num: true, render: (v) => signed(v) },
        { key: 'followingAfter', label: 'Following', num: true },
        { key: 'netFollowing', label: 'Δ following', num: true, render: (v) => signed(v) },
        { key: 'churnRate', label: 'Churn', num: true, render: (v) => pct(v) },
        { key: 'retentionRate', label: 'Retention', num: true, render: (v) => pct(v) },
      ],
      t.churn,
    )),
  ));

  frag.append(section('Every metric',
    null,
    card(null, null, table(
      [
        { key: 'key', label: 'Metric' },
        { key: 'group', label: 'Group' },
        { key: 'first', label: 'First', num: true, render: (v) => fmt(v) },
        { key: 'last', label: 'Latest', num: true, render: (v) => fmt(v) },
        { key: 'change', label: 'Since previous', num: true, render: (v) => signed(v) },
        { key: 'changeTotal', label: 'Overall', num: true, render: (v) => signed(v) },
        { key: 'changePerSnapshot', label: 'Per upload', num: true, render: (v) => signed(v) },
        {
          key: 'points',
          label: 'Trend',
          render: (points) => sparkline(points.map((p) => p.value)),
        },
      ],
      t.metrics,
      { filter: true },
    )),
  ));

  frag.append(section('Follower movement', null,
    ...t.churn.map((c) => card(
      `${shortDate(c.from)} → ${shortDate(c.to)}`,
      `Net ${c.net > 0 ? '+' : ''}${c.net} · churn ${pct(c.churnRate)} · retention ${pct(c.retentionRate)}`,
      h('div', { class: 'grid cols-2' },
        card('Gained', null, c.gained.length
          ? h('div', {}, ...c.gained.map((u) => h('div', {}, handle(u))))
          : h('p', { class: 'empty' }, 'None.')),
        card('Lost', null, c.lost.length
          ? h('div', {}, ...c.lost.map((u) => h('div', {}, handle(u))))
          : h('p', { class: 'empty' }, 'None.')),
      ),
    )),
  ));

  if (t.newAdvertisers.length) {
    frag.append(section('Newly acquired your data',
      'Advertisers present in your latest export that were not in your first.',
      card(null, null, table([{ key: 'name', label: 'Advertiser' }],
        t.newAdvertisers.map((name) => ({ name })), { filter: true, limit: 100 }))));
  }
  return frag;
}
