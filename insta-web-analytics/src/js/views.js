// views.js — one renderer per tab.

import {
  h, fmt, pct, shortDate, duration, tile, table, card, chartCard, section, notice, handle,
} from './ui.js';
import {
  columnChart, stackedChart, lineChart, barsChart, heatmapChart, sparkline,
} from './charts.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourLabel = (h24) => `${((h24 + 11) % 12) + 1}${h24 < 12 ? 'am' : 'pm'}`;

const peopleColumns = [
  { key: 'u', label: 'Account', render: (v) => handle(v) },
  { key: 'name', label: 'Name' },
  { key: 'at', label: 'Since', render: (v) => shortDate(v) },
];

const countTable = (rows, keyLabel, valueLabel) => () =>
  table(
    [{ key: 'key', label: keyLabel }, { key: 'count', label: valueLabel, num: true }],
    rows,
    { filter: rows.length > 15 },
  );

// ── Overview ───────────────────────────────────────────────────────────────
export function overview(data, results) {
  const a = results.audience.insights;
  const change = results.audience.change;
  const frag = document.createDocumentFragment();

  frag.append(section(
    `@${data.profile.username ?? 'your account'}`,
    `${data.profile.isPrivate ? 'Private' : 'Public'} account, created ${shortDate(data.profile.createdAt)}` +
      `${data.profile.basedIn?.city ? ` · based in ${data.profile.basedIn.city}` : ''}` +
      ` · export generated ${shortDate(data.meta.generatedAt)}`,
    h('div', { class: 'grid cols-4' },
      tile('Followers', a.followers, {
        delta: change ? change.newFollowers.length - change.unfollowers.length : null,
        deltaLabel: 'since last upload',
      }),
      tile('Following', a.following, {
        delta: change ? change.newlyFollowing.length - change.youUnfollowed.length : null,
        deltaLabel: 'since last upload',
        goodWhenUp: false,
      }),
      tile('Mutuals', a.mutuals, { sub: `${pct(a.mutualPercentage)} of followers` }),
      tile('Follow-back rate', pct(a.followBackRate), { sub: `${a.notFollowingBack} don't follow back` }),
    ),
  ));

  frag.append(section('Your activity in this export', null,
    h('div', { class: 'grid cols-4' },
      tile('Posts published', results.content.totals.published, {
        sub: `${results.content.totals.posts} posts · ${results.content.totals.stories} stories · ${results.content.totals.reels} reels`,
      }),
      tile('Things you watched', results.consumption.totals.impressions, {
        sub: `${fmt(results.consumption.perActiveDay.median ?? 0)}/day typical`,
      }),
      tile('Likes given', data.engagement.likes, {
        sub: `${fmt(data.engagement.comments)} comments written`,
      }),
      tile('Ads shown to you', results.ads.totals.adsViewed, {
        sub: `${pct(results.ads.adShare)} of everything you saw`,
      }),
    ),
  ));

  const acquisition = results.audience.acquisition;
  if (acquisition.length > 1) {
    frag.append(section('When your current followers arrived', null,
      chartCard(
        'Cumulative followers by join month',
        'Reconstructed from the date each follower joined, so it works from a single upload. ' +
          'It counts only people who are still following you today — anyone who left is absent from the export, ' +
          'so treat this as a floor rather than a true historical follower count.',
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
      'close this page — nothing is saved in your browser. Upload it alongside your next export and every ' +
      'number here gains a trend line, plus you get the names of who followed and unfollowed in between.',
    )));
  }
  return frag;
}

// ── Audience ───────────────────────────────────────────────────────────────
export function audienceView(data, results) {
  const r = results.audience;
  const frag = document.createDocumentFragment();

  frag.append(section('Relationships', 'The same set comparisons the desktop app makes, computed from your export.',
    h('div', { class: 'grid cols-4' },
      tile('Mutuals', r.insights.mutuals),
      tile("Don't follow you back", r.insights.notFollowingBack, { goodWhenUp: false }),
      tile('Fans', r.insights.fans, { sub: 'follow you, you don\'t follow back' }),
      tile('Follower / following', r.insights.followerFollowingRatio),
    ),
    h('div', { class: 'grid cols-2', style: 'margin-top:16px' },
      card("Don't follow you back", `${r.notFollowingBack.length} accounts you follow that don't follow you.`,
        table(peopleColumns, r.notFollowingBack, { filter: true })),
      card('Fans', `${r.fans.length} accounts following you that you don't follow back.`,
        table(peopleColumns, r.fans, { filter: true })),
    ),
  ));

  if (r.change) {
    frag.append(section('Since your last upload', `Compared with the export generated ${shortDate(results.comparedWith)}.`,
      h('div', { class: 'grid cols-4' },
        tile('New followers', r.change.newFollowers.length),
        tile('Unfollowed you', r.change.unfollowers.length, { goodWhenUp: false }),
        tile('Churn rate', pct(r.change.churnRate), { goodWhenUp: false }),
        tile('Retention', pct(r.change.retentionRate)),
      ),
      h('div', { class: 'grid cols-2', style: 'margin-top:16px' },
        card('Who unfollowed you', null, table(peopleColumns, r.change.unfollowers, { filter: true })),
        card('Who started following', null, table(peopleColumns, r.change.newFollowers, { filter: true })),
      ),
    ));
  }

  const rec = r.reciprocity;
  if (rec.rows.length) {
    frag.append(section('Reciprocity',
      'Both the date someone followed you and the date you followed back are in the export, ' +
      'so the gap between them is measurable.',
      h('div', { class: 'grid cols-3' },
        tile('Median follow-back gap', rec.medianLagHours === null ? '—' : duration(Math.abs(rec.medianLagHours) * 3600)),
        tile('Same-minute follow-backs', rec.instant, { sub: 'straight from the notification' }),
        tile('You followed first', rec.youFirst, { sub: `of ${rec.rows.length} mutuals` }),
      ),
    ));
  }

  if (r.cohorts.length > 1) {
    frag.append(section('Cohort retention',
      'Of the followers who arrived in each month, how many are still here. From a single upload every ' +
      'survivor is present by definition, so this reads 100% until a second snapshot supplies the people who left.',
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

  frag.append(section('Departures and blocks', 'Recorded by Instagram directly — independent of any snapshot.',
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
    'Your export has no like, comment or view counts — Meta omits them. It does timestamp every follower ' +
    'and every post, so the two can be joined: each follower is credited to the most recent post published ' +
    'before they arrived, within a ' + at.windowDays + '-day window. This is correlation, not proof.',
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
  ));

  if (at.confidence === 'low') {
    frag.append(notice(
      `<strong>Too little data to rank reliably.</strong> This account has ${at.sample.followers} followers ` +
      `across ${at.sample.posts} published items. The arithmetic below is correct, but with numbers this small ` +
      'a single follower moves the ranking, so read it as a curiosity rather than a strategy.',
      'warn',
    ));
  }

  if (at.posts.length) {
    frag.append(section(null, null, card(
      'Posts ranked by followers gained',
      'Last-touch credit, so each follower is counted exactly once. "Lift" compares the 7-day gain against ' +
      'what your baseline rate alone would predict.',
      table(
        [
          { key: 'at', label: 'Published', render: (v) => shortDate(v) },
          { key: 'type', label: 'Type' },
          { key: 'caption', label: 'Caption', render: (v) => v || h('span', { class: 'muted' }, '(none)') },
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
      tile('Published items', c.totals.published, { sub: `${c.perMonthAverage}/month average` }),
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
      'These coordinates are metre-precise and sit in the export even though the image files themselves ' +
      'are stripped of EXIF. See the Privacy tab.',
      card(null, null, table(
        [
          { key: 'at', label: 'When', render: (v) => shortDate(v) },
          { key: 'place', label: 'Place' },
          { key: 'lat', label: 'Latitude', num: true },
          { key: 'lng', label: 'Longitude', num: true },
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
    'The desktop app ranks followers by how much they engage with you — the export cannot answer that, ' +
    'because it contains no engagement received. It answers the mirror image exactly: every like, comment, ' +
    'save and view you made, with the creator attached.',
    h('div', { class: 'grid cols-4' },
      tile('Creators you engaged with', af.engagedCreators, { sub: `${fmt(af.totalCreators)} seen in total` }),
      tile('Likes given', data.engagement.likes),
      tile('Comments written', data.engagement.comments),
      tile('Posts saved', data.engagement.saved),
    ),
  ));

  frag.append(section(null, null, chartCard(
    'Top creators by affinity',
    `Weighted: comment ×${af.weights.comment}, save ×${af.weights.save}, like ×${af.weights.like}, view ×${af.weights.view}.`,
    barsChart(af.creators.slice(0, 15).map((c) => ({ key: c.u, count: c.score })), { label: 'affinity' }),
    {
      tableView: () => table(
        [
          { key: 'u', label: 'Creator', render: (v) => handle(v) },
          { key: 'score', label: 'Affinity', num: true },
          { key: 'like', label: 'Likes', num: true },
          { key: 'comment', label: 'Comments', num: true },
          { key: 'view', label: 'Views', num: true },
          { key: 'youFollow', label: 'You follow', render: (v) => (v ? 'yes' : '—') },
          { key: 'followsYou', label: 'Follows you', render: (v) => (v ? 'yes' : '—') },
        ],
        af.creators,
        { filter: true },
      ),
    },
  )));

  frag.append(section('One-sided follows',
    'Accounts you follow that have never produced a single like, comment, save or view from you. ' +
    'This is the true analogue of the desktop app\'s "ghost followers" list, pointed the other way — ' +
    'these are following slots giving you nothing back.',
    h('div', { class: 'grid cols-3' },
      tile('One-sided follows', af.oneSidedCount, { sub: `${pct(af.oneSidedPct)} of everyone you follow`, goodWhenUp: false }),
      tile('You engage, they ignore', af.unreciprocated.length, { sub: 'no follow back from them', goodWhenUp: false }),
      tile('Engaged mutuals', af.mutualEngaged.length),
    ),
    h('div', { class: 'grid cols-2', style: 'margin-top:16px' },
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
  return frag;
}

// ── Consumption ────────────────────────────────────────────────────────────
export function consumptionView(data, results) {
  const c = results.consumption;
  const frag = document.createDocumentFragment();

  frag.append(section('How much you watch',
    'Every impression is timestamped, but none carry a duration — so this is volume and timing, never time spent.',
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
          'Session start and end times are the only duration data anywhere in the export.'),
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
      'Companies that uploaded a contact list matching your profile, or matched you after a visit to their site.',
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
    'Counts and timing only. Message text is read to measure length and emoji use, then discarded — ' +
    'it is never written to the history file.',
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
    'Everything below is read in memory to build this page and is never written to the history file. ' +
    'Check it before you send your export to anyone.',
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
    card('Not present — confirmed', 'Absent from your export, so a leak would not immediately hand over your account.',
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

  frag.append(section('Trends',
    `${t.snapshots} snapshots, ${shortDate(t.span.from)} to ${shortDate(t.span.to)}.`,
    card(null, null, table(
      [
        { key: 'key', label: 'Metric' },
        { key: 'group', label: 'Group' },
        { key: 'first', label: 'First', num: true, render: (v) => fmt(v) },
        { key: 'last', label: 'Latest', num: true, render: (v) => fmt(v) },
        { key: 'change', label: 'Since previous', num: true, render: (v) => (v === null ? '—' : `${v > 0 ? '+' : ''}${fmt(v)}`) },
        { key: 'changeTotal', label: 'Overall', num: true, render: (v) => (v === null ? '—' : `${v > 0 ? '+' : ''}${fmt(v)}`) },
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
      `Net ${c.net > 0 ? '+' : ''}${c.net} · churn ${pct(c.churnRate)}`,
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
