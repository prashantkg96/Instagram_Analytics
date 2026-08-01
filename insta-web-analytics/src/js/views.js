// views.js — one renderer per tab.

import {
  h, fmt, pct, shortDate, duration, tile, table, card, chartCard, section, notice, handle, chip,
  stateSwitch,
} from './ui.js';
import {
  columnChart, stackedChart, lineChart, barsChart, heatmapChart, sparkline, arcGauge,
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
 * A follow relationship as a switch.
 *
 * Untoned deliberately: following someone back is neither good nor bad, unlike
 * a privacy setting. The switch is here for consistency with the settings
 * tables, not to grade anyone.
 *
 * These come from set membership (affinity.js, fans.js, audience.js), so the
 * sets are complete and a missing key genuinely means "no" — there is no third
 * state to represent, which is why `binaryState` is not used here.
 */
const followSwitch = (value, label) =>
  stateSwitch(['Yes', 'No'], value ? 'Yes' : 'No', { label });

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

/**
 * The narrative opener: a few sentences, and one score with its workings.
 *
 * The "show the math" panel is not optional decoration. A score on a dial reads
 * as authoritative whether or not it deserves to, so the inputs, their weights
 * and their contributions sit one click away — and the copy says outright that
 * this is not an Instagram metric.
 */
function atAGlance(results) {
  const s = results.summary;
  if (!s.sentences.length) return document.createDocumentFragment();

  const prose = h('div', {}, ...s.sentences.map((line) => h('p', { class: 'sub' }, line)));

  if (!s.grounded) {
    // Too little parsed for a composite to mean anything — say the sentences
    // and stop, rather than put a confident dial on top of two data points.
    return section('At a glance', null, card(null, null, prose));
  }

  const math = h('details', { class: 'steps-panel' },
    h('summary', {}, 'Show the math'),
    h('p', { class: 'sub' },
      'Each part scores 0–100 from your own export, then they are blended by weight and mapped onto ' +
      `${s.min}–${s.max}. Anything your export does not cover is left out and the remaining weights ` +
      'are shared over what is left, so a missing section never counts against you.'),
    table(
      [
        { key: 'key', label: 'Input' },
        { key: 'value', label: 'Scores', num: true, render: (v) => Math.round(v) },
        { key: 'share', label: 'Weight', num: true, render: (v) => pct(v) },
        { key: 'contributes', label: 'Contributes', num: true },
        { key: 'detail', label: 'From' },
      ],
      s.breakdown,
    ),
  );

  return section('At a glance', null,
    h('div', { class: 'grid cols-2' },
      card(null, null, prose),
      card('Your export score', `${s.band} — not an Instagram metric, and not comparable between accounts.`,
        arcGauge(s.score, { min: s.min, max: s.max, label: s.band }),
        math),
    ));
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

  frag.append(atAGlance(results));

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
    h('div', { class: 'grid cols-2' },
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
      h('div', { class: 'grid cols-2' },
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
      h('div', { class: 'grid cols-2' },
        // byHour was computed all along and only ever used for a single tile.
        chartCard('Followers gained per post, by hour', null,
          columnChart(
            Array.from({ length: 24 }, (_, hour) => {
              const row = at.byHour.find((b) => Number(b.key) === hour);
              return { key: String(hour), count: row ? row.perPost : 0 };
            }),
            { label: 'followers per post' },
          ),
          {
            tableView: countTable(
              at.byHour.map((b) => ({ key: hourLabel(Number(b.key)), count: b.perPost })),
              'Hour', 'Per post',
            ),
          },
        ),
        chartCard('By number of items', 'Whether carousels outperform single images.',
          barsChart(at.byCarousel.map((c) => ({ key: c.key, count: c.perPost })), { label: 'followers per post' }),
          { tableView: countTable(at.byCarousel.map((c) => ({ key: c.key, count: c.perPost })), 'Post', 'Per post') },
        ),
      ),
    ));
  }

  // When you post, against when posting works. Only worth a section when the
  // two disagree — if they already match there is nothing to act on.
  const mism = at.timing;
  if (mism && (!mism.hour.aligned || !mism.day.aligned) && mism.hour.best && mism.day.best) {
    frag.append(section('When you post vs when it works', null,
      h('div', { class: 'grid cols-4' },
        tile('You post most at', hourLabel(Number(mism.hour.posted.key)), {
          sub: `${mism.hour.posted.posts} posts · ${mism.hour.posted.perPost} followers each`,
        }),
        tile('Best hour', hourLabel(Number(mism.hour.best.key)), {
          sub: `${mism.hour.best.posts} posts · ${mism.hour.best.perPost} followers each`,
        }),
        tile('You post most on', mism.day.posted.key, {
          sub: `${mism.day.posted.posts} posts · ${mism.day.posted.perPost} followers each`,
        }),
        tile('Best day', mism.day.best.key, {
          sub: `${mism.day.best.posts} posts · ${mism.day.best.perPost} followers each`,
        }),
      ),
    ));
  }

  if (at.byPlace.length >= 3) {
    frag.append(section('Where you posted from', null,
      card(null, 'Locations tagged on your posts, ranked by followers gained.', table(
        [
          { key: 'key', label: 'Place' },
          { key: 'posts', label: 'Posts', num: true },
          { key: 'gained', label: 'Followers', num: true },
          { key: 'perPost', label: 'Per post', num: true },
        ],
        at.byPlace,
        { filter: at.byPlace.length > 15 },
      )),
    ));
  }

  // Hidden rather than shown empty: ranking hashtags needs tags that actually
  // repeat, and most accounts that barely use them would get a table of noise.
  if (at.byHashtag.length >= 3) {
    frag.append(section('Hashtags', null,
      card(null, 'Tags used on at least two posts, ranked by followers gained.', table(
        [
          { key: 'key', label: 'Hashtag', render: (v) => `#${v}` },
          { key: 'posts', label: 'Posts', num: true },
          { key: 'gained', label: 'Followers', num: true },
          { key: 'perPost', label: 'Per post', num: true },
        ],
        at.byHashtag,
        { filter: at.byHashtag.length > 15 },
      )),
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
    // Cadence measured on posts and reels only — stories go out in same-day
    // bursts and would drag every gap here to zero.
    c.gaps
      ? h('div', { class: 'grid cols-3' },
          tile('Typical gap between posts', `${c.gaps.medianDays}d`, {
            sub: 'median, stories excluded',
            goodWhenUp: false,
          }),
          tile('Longest gap between posts', `${c.gaps.longestDays}d`, { goodWhenUp: false }),
          tile('Since your last post', `${c.gaps.sinceLastDays}d`, {
            sub: shortDate(c.gaps.lastAt),
            goodWhenUp: false,
          }),
        )
      : null,
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

  // cols-3, not cols-4: six tiles under a 170px minimum pack six to a row and
  // each one ends up too narrow for its label. The wider minimum gives four
  // per row with room to read them.
  frag.append(section('Who you pay attention to',
    'Your data records no engagement received — only what you gave. This is that.',
    h('div', { class: 'grid cols-3' },
      tile('Creators you engaged with', af.engagedCreators),
      tile('Creators you watched', af.watchedCreators, {
        sub: af.watchedCoverage ? `last ${af.watchedCoverage.days} days` : null,
      }),
      tile('Likes given', data.engagement.likes),
      tile('Comments written', data.engagement.comments),
      tile('Story responses', af.storyResponseCount, {
        sub: 'polls, quizzes, sliders, countdowns',
      }),
      tile('Notes and reposts', af.notesRepostCount, {
        sub: af.notesRepostCount ? 'people whose notes you engaged with' : null,
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
      { key: 'youFollow', label: 'You follow', render: (v) => followSwitch(v, 'You follow') },
      { key: 'followsYou', label: 'Follows you', render: (v) => followSwitch(v, 'Follows you') },
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
    h('div', { class: 'grid cols-2' },
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
        { key: 'youFollow', label: 'You follow back', render: (v) => followSwitch(v, 'You follow back') },
      ],
      af.quietFollowers,
      { filter: true },
    )),
  ));
  return frag;
}

// ── Fan followers ──────────────────────────────────────────────────────────
//
// The mirror of the tab above: people engaging with you, not the other way
// round. Read fans.js before changing anything here — the honest scope of this
// data is narrow, and the copy on this page is load-bearing rather than
// decorative.
export function fansView(data, results) {
  const f = results.fans;
  const frag = document.createDocumentFragment();

  // Someone's display name, linked when it resolved to a handle and plain text
  // when it did not. Never guess: an unresolved name is left unlinked.
  const person = (row) => (row.u
    ? handle(row.u)
    : h('span', { title: 'No handle in your follower or following list matches this name' },
      row.name));

  if (!f.reliable) {
    frag.append(section('Fan followers', null, notice(
      '<strong>Cannot rank this export.</strong> Your display name is missing from it, so there is no way ' +
      'to tell your own messages apart from everyone else\'s — every message would count as incoming. ' +
      'Re-export with your profile information included.', 'danger',
    )));
    return frag;
  }

  frag.append(section('Who engages with you',
    'From your inbox — the one place an export records other people acting toward you.',
    h('div', { class: 'grid cols-4' },
      tile('People who wrote to you', f.totals.people),
      tile('Consistent', f.totals.consistent, {
        sub: 'wrote in 3+ separate months',
      }),
      tile('Messages received', f.totals.messagesIn),
      tile('Posts and reels sent to you', f.totals.sharesIn, {
        sub: 'they shared content in your direction',
      }),
    ),
  ));

  // The single most important thing on this page. Stated before the leaderboard
  // rather than under it, so nobody reads the ranking as something it is not.
  frag.append(section(null, null, notice(
    '<strong>Instagram does not export who liked, commented on or saved your posts.</strong> ' +
    'Not in summary, not per post — every engagement file in the archive records something ' +
    '<em>you</em> did. So this ranking is built from your inbox, which is where story replies and ' +
    'shared reels arrive, and it is the only per-person record of inbound engagement that exists. ' +
    'Totals for likes and replies your posts received are in <em>Reach &amp; insights</em>, if your ' +
    'export includes them.',
  )));

  const fanColumns = [
    { key: 'name', label: 'Person', render: (v, row) => person(row) },
    { key: 'score', label: 'Fan score', num: true },
    { key: 'received', label: 'Messages', num: true },
    { key: 'shares', label: 'Sent you', num: true },
    { key: 'openedByThem', label: 'They started', num: true },
    { key: 'months', label: 'Months active', num: true },
    { key: 'last', label: 'Last heard', render: (v) => shortDate(v) },
  ];

  frag.append(section(null, null, chartCard(
    'Fan followers',
    `Inbound only — nothing you did counts toward this. Weighted: conversation they started ` +
    `×${f.weights.opened}, post or reel they sent ×${f.weights.share}, message ×${f.weights.message}, ` +
    'plus a bonus for writing across many months. Group chats are excluded.',
    barsChart(f.fans.slice(0, 12).map((r) => ({ key: r.u ?? r.name, count: r.score })), { label: 'fan score' }),
    { tableView: () => table(fanColumns, f.fans, { filter: true }) },
  )));

  frag.append(section('Closest accounts',
    'Two-way: their inbound score plus your own engagement with them, for people who follow you back. ' +
    'This is as near as an export gets to "who consistently engages with my content".',
    card(null,
      f.totals.resolvedPct < 100
        ? `${f.totals.resolvedPct}% of the people who message you could be matched to a handle — ` +
          'only those can appear here, because your side of the score is keyed by username.'
        : null,
      table(
        [
          { key: 'u', label: 'Account', render: (v) => handle(v) },
          { key: 'combined', label: 'Combined', num: true },
          { key: 'score', label: 'Their side', num: true },
          { key: 'yourScore', label: 'Your side', num: true },
          { key: 'months', label: 'Months active', num: true },
          { key: 'youFollow', label: 'You follow back', render: (v) => followSwitch(v, 'You follow back') },
        ],
        f.closest,
        { filter: true },
      )),
  ));

  if (f.totals.groupThreads) {
    frag.append(section(null, null, notice(
      `<strong>${fmt(f.totals.groupThreads)} group chats were left out.</strong> A group thread names ` +
      'only whoever spoke first, so counting one would credit every message in it to a single ' +
      'arbitrary person.',
    )));
  }
  return frag;
}

/**
 * What Meta actually sent — folders, sizes, and the files that are absent.
 *
 * Exported for the Export tab, which is where the archive is already the
 * subject. Returns nothing when the dataset came from a directory rather than a
 * ZIP, since there is no central directory to report on.
 */
export function passportSection(results) {
  const p = results.passport;
  if (!p) return document.createDocumentFragment();
  const frag = document.createDocumentFragment();

  frag.append(section('What Meta actually sent',
    'The archive itself, not what is in it. Every number in this dashboard traces back to one of ' +
    'these files.',
    h('div', { class: 'grid cols-4' },
      tile('Files in the archive', p.totals.entries, { sub: `${p.totals.megabytes} MB uncompressed` }),
      tile('Data files', p.totals.dataFiles, { sub: 'the rest is media' }),
      tile('Read by this tool', p.totals.parsed, {
        sub: `${Math.max(0, p.totals.entries - p.totals.parsed)} never opened`,
      }),
      tile('Expected but absent', p.totals.missing, { goodWhenUp: false }),
    ),
  ));

  frag.append(section(null, null, h('div', { class: 'grid cols-2' },
    card('Folders', 'Largest first.', table(
      [
        { key: 'key', label: 'Folder' },
        { key: 'count', label: 'Files', num: true },
        { key: 'data', label: 'Data', num: true },
        { key: 'megabytes', label: 'MB', num: true },
      ],
      p.folders,
    )),
    card('Files Meta left out',
      p.missing.length
        ? 'Sections of this dashboard that will read empty — because the file is absent, not because ' +
          'you did nothing.'
        : 'Nothing this tool looks for is missing.',
      table(
        [{ key: 'file', label: 'Expected file' }, { key: 'needed', label: 'Used for' }],
        p.missing,
        { empty: 'Your export is complete.' },
      )),
  )));
  return frag;
}

// ── Reach & insights ───────────────────────────────────────────────────────
//
// Only rendered when `results.insights` is non-null — see the `when` guard on
// the tab in main.js. Personal-account exports contain none of this.
export function insightsView(data, results) {
  const ins = results.insights;
  const frag = document.createDocumentFragment();
  const m = ins.metrics;
  const r = ins.ratios;

  const window = ins.period.start && ins.period.end
    ? `${shortDate(ins.period.start)} → ${shortDate(ins.period.end)}`
    : 'Instagram did not date this block';

  // A metric that is absent and one that is genuinely zero are different
  // things, and a creator would act on them differently. Absent stays blank.
  const stat = (label, value, opts) => tile(label, value ?? '—', opts);

  frag.append(section('What your content did',
    `Engagement your posts received, as Instagram counted it. ${window}.`,
    h('div', { class: 'grid cols-4' },
      stat('Accounts reached', m.reach),
      stat('Impressions', m.impressions),
      stat('Profile visits', m.profileVisits),
      stat('Accounts engaged', m.accountsEngaged),
      stat('Total interactions', m.totalInteractions),
      stat('Post likes', m.postLikes),
      stat('Story interactions', m.storyInteractions),
      stat('Story replies', m.storyReplies, {
        sub: m.storyReplies !== null ? 'the per-person list is in Fan followers' : null,
      }),
    ),
  ));

  if (!ins.recognised) {
    frag.append(section(null, null, notice(
      '<strong>Creator stats were found but not recognised.</strong> The labels in your export do not ' +
      'match any this build knows. Everything read out of those files is listed at the bottom of this ' +
      'page — nothing has been discarded.', 'warn',
    )));
  }

  // Only the engagement rate is a share of a whole; the rest can legitimately
  // exceed their denominator, so they are multiples. See insights.js.
  const ratioRows = [
    { k: 'Engagement rate', v: r.engagementRate, s: 'accounts engaged ÷ accounts reached', share: true },
    { k: 'Seen per account', v: r.frequency, s: 'impressions ÷ accounts reached' },
    { k: 'Reach vs your followers', v: r.reachVsFollowers, s: 'accounts reached ÷ your follower list' },
    { k: 'Profile visits per account reached', v: r.visitsPerReach, s: 'profile visits ÷ accounts reached' },
    { k: 'Interactions per account reached', v: r.interactionsPerReach, s: 'total interactions ÷ accounts reached' },
  ].filter((row) => row.v !== null);

  if (ratioRows.length) {
    frag.append(section('The ratios that matter',
      'Computed only where both inputs are present — a missing input leaves the row out rather than ' +
      'showing a zero you might act on.',
      card(null, null, table(
        [
          { key: 'k', label: 'Ratio' },
          { key: 'v', label: 'Value', num: true, render: (v, row) => (row.share ? pct(v) : `${v}×`) },
          { key: 's', label: 'How it is worked out' },
        ],
        ratioRows,
      )),
    ));
  }

  const d = ins.demographics;
  const demoCards = [];
  if (d.age.length) {
    demoCards.push(chartCard('Follower age', 'Share of your followers in each bracket.',
      columnChart(d.age, { label: '%' }), { tableView: countTable(d.age, 'Age', 'Share %') }));
  }
  if (d.gender.length) {
    demoCards.push(chartCard('Follower gender', 'As Instagram categorises it.',
      barsChart(d.gender, { label: '%' }), { tableView: countTable(d.gender, 'Gender', 'Share %') }));
  }
  if (d.cities.length) {
    demoCards.push(chartCard('Top cities', 'Where your followers say they are.',
      barsChart(d.cities, { label: '%' }), { tableView: countTable(d.cities, 'City', 'Share %') }));
  }
  if (d.countries.length) {
    demoCards.push(chartCard('Top countries', null,
      barsChart(d.countries, { label: '%' }), { tableView: countTable(d.countries, 'Country', 'Share %') }));
  }
  if (demoCards.length) {
    frag.append(section('Who your followers are',
      'Instagram only reports this in aggregate — there are no usernames attached to any of it.',
      h('div', { class: 'grid cols-2' }, ...demoCards)));
  }

  if (ins.extra.length) {
    frag.append(section('Everything else in those files',
      `${ins.extra.length} values this build has no name for. Listed so nothing your export contains ` +
      'is silently dropped.',
      card(null, null, table(
        [{ key: 'key', label: 'Label' }, { key: 'value', label: 'Value' }],
        ins.extra,
        { filter: ins.extra.length > 15, limit: 120 },
      )),
    ));
  }

  if (ins.sources.length) {
    frag.append(section(null, null, card('Read from',
      'The files these numbers came out of.',
      table([{ key: 'k', label: 'File' }], ins.sources.map((k) => ({ k }))))));
  }
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

  const disc = c.discovery;
  if (disc && disc.suggested) {
    frag.append(section('What Instagram pushed at you',
      'Accounts it suggested unprompted, and how much of that you rejected.',
      h('div', { class: 'grid cols-3' },
        tile('Accounts suggested', disc.suggested),
        tile('Profiles you dismissed', disc.dismissedProfiles, {
          sub: disc.rejectionPct === null ? null : `${pct(disc.rejectionPct)} of what it suggested`,
        }),
        tile('Posts you dismissed', disc.dismissedPosts),
      ),
      h('div', { class: 'grid cols-2' },
        card('Suggested to you', null, table(
          [
            { key: 'u', label: 'Account', render: (v) => handle(v) },
            { key: 'name', label: 'Name' },
            { key: 'at', label: 'When', render: (v) => shortDate(v) },
          ],
          disc.profiles,
          { filter: true },
        )),
        card('You told it to stop', null, table(
          [
            { key: 'u', label: 'Account', render: (v) => handle(v) },
            { key: 'at', label: 'When', render: (v) => shortDate(v) },
          ],
          disc.dismissed,
          { filter: true },
        )),
      ),
    ));
  }

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

  // ── ad pressure ──
  // The same numbers as above, put the way round a reader can feel. A share of
  // 16% and "one in every six" are identical facts with very different weight.
  const p = a.pressure;
  const pressureTiles = [];
  if (p.oneInEvery) {
    pressureTiles.push(tile('One ad in every', p.oneInEvery, {
      sub: 'things Instagram showed you', goodWhenUp: false,
    }));
  }
  pressureTiles.push(tile('Brands that ran ads at you', p.brands, { goodWhenUp: false }));
  if (p.topBrand) {
    pressureTiles.push(tile('Most repeated brand', p.topBrand.count, {
      sub: `${p.topBrand.key} — concentration, not variety`, goodWhenUp: false,
    }));
  }
  if (p.brands) {
    // Meta's own "advertisers using your activity" list is not the same set as
    // the brands that actually reached you, and the gap is usually the story.
    pressureTiles.push(tile('Not on your advertiser list', p.brandsNotOnList, {
      sub: `of ${p.brands} — they reached you another way`, goodWhenUp: false,
    }));
  }
  if (pressureTiles.length > 1) {
    // This row is 2–4 tiles depending on what the export carries. Two tiles in
    // a cols-4 grid stretch to half the page each, which reads as a layout
    // error rather than a pair of numbers — so the column minimum tracks the
    // count instead of being fixed.
    const pressureCols = pressureTiles.length <= 2 ? 'cols-2' : 'cols-4';
    frag.append(section('The pressure on your feed',
      a.adShareWindow
        ? `Over the ${a.adShareWindow.days} days your ad log and viewing history both cover.`
        : null,
      h('div', { class: `grid ${pressureCols}` }, ...pressureTiles)));
  }

  if (p.densest && p.byDaypart.some((b) => b.seen > 0)) {
    frag.append(section(null, null, chartCard(
      'When your feed is most paid',
      `Share of everything you saw that was an ad, by time of day. Heaviest in the ` +
      `${p.densest.key.toLowerCase()} at ${pct(p.densest.count)}.`,
      columnChart(p.byDaypart, { label: '% ads' }),
      {
        tableView: () => table(
          [
            { key: 'key', label: 'Time of day' },
            { key: 'count', label: 'Ads %', num: true, render: (v) => pct(v) },
            { key: 'ads', label: 'Ads', num: true },
            { key: 'seen', label: 'Total seen', num: true },
          ],
          p.byDaypart,
        ),
      },
    )));
  }

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
          key: 'state',
          label: 'Current',
          // `good` is null when the export did not say, and the switch is left
          // untoned — an unknown setting is neither reassuring nor alarming.
          render: (v, row) => stateSwitch(row.options, v, {
            label: row.label,
            tone: row.good === null ? null : (row.good ? 'good' : 'bad'),
            raw: row.raw,
          }),
        },
      ],
      p.settings,
    )),
  )));

  if (p.sessions?.count || p.notifications?.total) {
    frag.append(section('Sessions and notifications', null,
      h('div', { class: 'grid cols-4' },
        // Pairing each logout with the login before it is the only way to get a
        // duration out of this export; nothing else records time spent.
        tile('Sessions measured', p.sessions.count, {
          sub: 'logins paired with a logout',
        }),
        tile('Typical session', p.sessions.medianSeconds === null ? '—' : duration(p.sessions.medianSeconds)),
        tile('Longest session', p.sessions.longestSeconds === null ? '—' : duration(p.sessions.longestSeconds), {
          goodWhenUp: false,
        }),
        tile('Notifications off', `${p.notifications.off} of ${p.notifications.total}`, {
          // Rows whose value is neither on nor off are named rather than
          // folded into one side of the count — several notification settings
          // hold an audience, not a switch.
          sub: p.notifications.unclassified
            ? `${p.notifications.unclassified} not a simple on/off`
            : 'push and email settings',
        }),
      ),
      p.notifications.rows.length
        ? card('Notification settings', null, table(
            [
              { key: 'channel', label: 'Channel' },
              { key: 'type', label: 'Notification' },
              {
                key: 'state',
                label: 'State',
                // `state` is true/false/null from binaryState. A row Meta wrote
                // as an audience rather than a switch lands on null and shows
                // its literal value — previously those rendered as a green
                // tick, asserting "on" for something that was never a toggle.
                render: (v, row) => stateSwitch(['On', 'Off'],
                  v === null ? null : (v ? 'On' : 'Off'),
                  {
                    label: [row.channel, row.type].filter(Boolean).join(' — '),
                    tone: v === null ? null : (v ? null : 'good'),
                    raw: v === null ? (row.value ?? 'not stated') : null,
                  }),
              },
            ],
            p.notifications.rows,
            { filter: p.notifications.rows.length > 15 },
          ))
        : null,
    ));
  }

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
