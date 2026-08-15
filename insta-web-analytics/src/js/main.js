// main.js — wiring: file intake, worker orchestration, tab rendering.

import { h, fmt, download, card, section, notice, table, tile, escapeHtml } from './ui.js';
import { hideTip } from './charts.js';
import { serializeHistory, historyToCsv, historyFilename } from './history.js';
import { setNavigator } from './nav.js';
import {
  overview, audienceView, growthView, contentView, engagementView, fansView,
  insightsView, consumptionView, adsView, messagesView, privacyView, trendsView,
  passportSection,
} from './views.js';

// Tab order is display order. `when` is optional: a tab that returns false is
// dropped from the bar entirely rather than rendered empty, because a section
// whose source files are absent from the export has nothing honest to show.
//
// `group` is what keeps the bar to one line. Thirteen flat tabs overflowed into
// a horizontal scroller, which hides sections behind a gesture nobody makes —
// so each tab names the menu it belongs to, and GROUPS below sets their order.
// A tab with no group stays a plain top-level button.
const TABS = [
  { id: 'overview', name: 'Overview', render: overview },

  { id: 'audience', name: 'Audience', group: 'people', render: audienceView },
  { id: 'growth', name: 'Growth', group: 'people', render: growthView },
  { id: 'fans', name: 'Fan followers', group: 'people', render: fansView },

  { id: 'content', name: 'Posts', group: 'content', render: contentView },
  {
    id: 'reach',
    name: 'Reach & insights',
    group: 'content',
    render: insightsView,
    // Professional accounts only. A personal export ships none of these files,
    // and an empty tab reads as a broken feature rather than an absent one.
    when: (summary, results) => Boolean(results.insights),
  },

  { id: 'engagement', name: 'Engagement', group: 'activity', render: engagementView },
  { id: 'consumption', name: 'Consumption', group: 'activity', render: consumptionView },
  { id: 'messages', name: 'Messages', group: 'activity', render: messagesView },

  { id: 'ads', name: 'Ads & tracking', group: 'exposure', render: adsView },
  { id: 'privacy', name: 'Privacy audit', group: 'exposure', render: privacyView },

  { id: 'trends', name: 'Trends', group: 'data', render: trendsView },
  { id: 'export', name: 'Export', group: 'data', render: exportView },
];

/**
 * Menu labels, in bar order. Split by whose behaviour each section describes —
 * your audience, your posts, what you did, what was done to you — rather than
 * by which file the numbers came from, which is an implementation detail the
 * reader has no reason to know.
 */
const GROUPS = [
  { id: 'people', name: 'Audience' },
  { id: 'content', name: 'Your content' },
  { id: 'activity', name: 'Your activity' },
  { id: 'exposure', name: 'Exposure' },
  { id: 'data', name: 'Your data' },
];

const state = {
  zipFile: null,
  historyFile: null,
  historyText: null,
  summary: null,
  results: null,
  history: null,
  stats: null,
  downloaded: false,
  active: 'overview',
  avatarUrl: null,
};

const $ = (id) => document.getElementById(id);

/**
 * Host integration.
 *
 * Standalone, this page owns its theme toggle and registers a service worker.
 * Embedded in a site that already provides both — prashantkumarchandra.in
 * supplies the theme via its shared top-pills nav — those must be handed back,
 * or there would be two competing toggles and a second service worker on a
 * frequently-deployed site. The host opts out by setting `window.PKC_IA`
 * before this script loads; the defaults preserve standalone behaviour.
 */
const HOST = Object.assign({ ownTheme: true, serviceWorker: true }, window.PKC_IA || {});

// ── theme ──────────────────────────────────────────────────────────────────
// Charts read their colours from CSS variables, so re-rendering the active tab
// is all a theme change needs. Cheaper than threading colours through every
// chart, and it works whoever owns the toggle.
function repaintForTheme() {
  if (state.results) renderTab(state.active);
}

function initTheme() {
  if (!HOST.ownTheme) {
    // The host owns `data-theme`. Watch it rather than driving it, so the
    // site's own toggle repaints the dashboard.
    new MutationObserver(repaintForTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    $('theme')?.remove();
    return;
  }

  const button = $('theme');
  const apply = (mode) => {
    document.documentElement.setAttribute('data-theme', mode);
    button.textContent = mode === 'dark' ? 'Light' : 'Dark';
    repaintForTheme();
  };
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  apply(prefersDark ? 'dark' : 'light');
  button.addEventListener('click', () =>
    apply(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
}

// ── file intake ────────────────────────────────────────────────────────────
// Two zones, not one. The export is the only thing required to get a result;
// the history file is a second, optional step that means nothing until there
// is an export to compare it against — so it stays out of the way until one
// has been chosen. Files are still routed by extension, so dropping both at
// once, or dropping either on the wrong zone, does the sensible thing.
const ZONES = [
  { key: 'zip', zone: 'drop-zip', picker: 'pick-zip', button: 'choose-zip', chip: 'chosen-zip' },
  { key: 'history', zone: 'drop-history', picker: 'pick-history', button: 'choose-history', chip: 'chosen-history' },
];

function describeFiles() {
  const zipChip = $('chosen-zip');
  if (zipChip) {
    zipChip.replaceChildren(state.zipFile
      ? h('span', { class: 'filechip' },
        `${state.zipFile.name} · ${(state.zipFile.size / 1048576).toFixed(0)} MB`)
      : '');
  }

  const historyChip = $('chosen-history');
  if (historyChip) {
    historyChip.replaceChildren(state.historyFile
      ? h('span', { class: 'filechip' }, `${state.historyFile.name} · previous analysis`)
      : '');
  }

  // Revealed by toggling `hidden`, never an inline style: a strict style-src
  // blocks markup-origin styles, and `hidden` is the semantically right control.
  const historyZone = $('drop-history');
  if (historyZone) historyZone.hidden = !state.zipFile;

  $('analyse').disabled = !state.zipFile;
}

async function acceptFiles(fileList) {
  for (const file of fileList) {
    if (/\.zip$/i.test(file.name)) {
      state.zipFile = file;
    } else if (/\.json$/i.test(file.name)) {
      state.historyFile = file;
      state.historyText = await file.text();
    }
  }
  describeFiles();
}

function initIntake() {
  for (const spec of ZONES) {
    const zone = $(spec.zone);
    const picker = $(spec.picker);
    const button = $(spec.button);
    if (!zone || !picker || !button) continue;

    ['dragenter', 'dragover'].forEach((type) =>
      zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((type) =>
      zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.remove('is-over'); }));
    zone.addEventListener('drop', (e) => acceptFiles(e.dataTransfer.files));

    button.addEventListener('click', () => picker.click());
    picker.addEventListener('change', () => acceptFiles(picker.files));
  }

  $('analyse').addEventListener('click', run);
  describeFiles();
}

// ── run ────────────────────────────────────────────────────────────────────
function setProgress(pct, label) {
  $('progress').hidden = false;
  $('progress-fill').style.width = `${pct}%`;
  $('progress-label').textContent = label;
}

function run() {
  if (!state.zipFile) return;
  $('analyse').disabled = true;
  $('intake-error').hidden = true;
  setProgress(1, 'Starting…');

  // A module worker keeps the source readable in the hosted build. The
  // single-file build swaps this for a Blob worker so it also runs from
  // file://, where module workers are blocked.
  const worker = typeof BUNDLED_WORKER === 'string'
    ? new Worker(URL.createObjectURL(new Blob([BUNDLED_WORKER], { type: 'text/javascript' })))
    : new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

  worker.onmessage = ({ data: message }) => {
    if (message.type === 'progress') {
      setProgress(message.pct, message.label);
      return;
    }
    if (message.type === 'error') {
      worker.terminate();
      $('analyse').disabled = false;
      $('progress').hidden = true;
      const box = $('intake-error');
      box.hidden = false;
      box.replaceChildren(notice(`<strong>Could not read that export.</strong> ${escapeHtml(message.message)}`, 'danger'));
      return;
    }
    worker.terminate();
    // The picture arrives as bytes and becomes a blob: URL, which is what the
    // enforcing CSP's img-src allows and what keeps it off the network.
    if (state.avatarUrl) URL.revokeObjectURL(state.avatarUrl);
    state.avatarUrl = message.avatar
      ? URL.createObjectURL(new Blob([message.avatar.bytes], { type: message.avatar.type }))
      : null;
    if (message.summary?.profile) message.summary.profile.avatarUrl = state.avatarUrl;

    Object.assign(state, {
      summary: message.summary,
      results: message.results,
      history: message.history,
      stats: message.stats,
      downloaded: false,
    });
    announce();
    showDashboard();
  };

  worker.onerror = (event) => {
    worker.terminate();
    $('analyse').disabled = false;
    $('progress').hidden = true;
    const box = $('intake-error');
    box.hidden = false;
    box.replaceChildren(notice(
      `<strong>The analyser crashed.</strong> ${escapeHtml(event.message ?? 'Unknown error')}`, 'danger',
    ));
  };

  worker.postMessage({ file: state.zipFile, historyText: state.historyText });
}

/**
 * Tell the host page an analysis finished.
 *
 * This dispatches a DOM event and nothing else — no fetch, no storage. The
 * engine stays network-free, which is what lets the standalone build keep
 * `connect-src 'none'`; there, the event simply fires with nobody listening.
 * A host that wants to count usage attaches its own listener and owns that
 * request, so the decision lives with the site rather than in here.
 */
function announce() {
  const profile = state.summary?.profile;
  if (!profile) return;
  document.dispatchEvent(new CustomEvent('ia:analysis', {
    detail: { username: profile.username ?? null, name: profile.name ?? null },
  }));
}

// ── dashboard ──────────────────────────────────────────────────────────────
/** Tabs with something to show for this particular export. */
function visibleTabs() {
  return TABS.filter((tab) => !tab.when || tab.when(state.summary, state.results));
}

/**
 * One tab button. Used both at the top level and inside a menu.
 *
 * These are navigation buttons, not ARIA `tab`s. Once sections are grouped
 * behind menus the bar stops being a tablist — a tablist may only contain
 * tabs, and a menu trigger is not one — so the whole bar is a navigation
 * landmark and the current section is marked with `aria-current`.
 */
function tabButton(tab, inMenu) {
  return h('button', {
    class: inMenu ? 'tabitem' : 'tab',
    type: 'button',
    id: `tab-${tab.id}`,
    'aria-current': tab.id === state.active ? 'true' : null,
    'aria-controls': 'panel',
    onclick: () => {
      closeMenus();
      renderTab(tab.id);
    },
  }, tab.name);
}

/** Collapse any open menu. Called on selection, Escape, and outside clicks. */
function closeMenus(except) {
  for (const trigger of document.querySelectorAll('#tabs .tab-parent[aria-expanded="true"]')) {
    if (trigger === except) continue;
    trigger.setAttribute('aria-expanded', 'false');
  }
}

/**
 * The tab bar: standalone tabs, plus one menu per group.
 *
 * A group whose tabs are all hidden for this export disappears with them, and a
 * group left holding a single tab is flattened to a plain button — a menu with
 * one item in it is a click for nothing.
 */
function buildTabBar() {
  const bar = $('tabs');
  const shown = visibleTabs();
  const nodes = [];

  for (const tab of shown.filter((t) => !t.group)) nodes.push(tabButton(tab, false));

  for (const group of GROUPS) {
    const members = shown.filter((t) => t.group === group.id);
    if (!members.length) continue;
    if (members.length === 1) {
      nodes.push(tabButton(members[0], false));
      continue;
    }

    const menu = h('div', { class: 'tabmenu' },
      ...members.map((tab) => tabButton(tab, true)));

    const trigger = h('button', {
      class: 'tab tab-parent',
      type: 'button',
      id: `tabgroup-${group.id}`,
      'aria-expanded': 'false',
      'aria-haspopup': 'true',
      onclick: (event) => {
        const open = trigger.getAttribute('aria-expanded') === 'true';
        closeMenus(trigger);
        trigger.setAttribute('aria-expanded', String(!open));
        event.stopPropagation();
      },
    }, group.name);

    nodes.push(h('div', { class: 'tabgroup', 'data-group': group.id }, trigger, menu));
  }

  bar.replaceChildren(...nodes);
}

function showDashboard() {
  $('intro').hidden = true;
  $('dashboard').hidden = false;

  buildTabBar();
  setNavigator(renderTab);
  renderTab(state.active);
  updateReminder();

  // A menu left hanging open over the panel is worse than no menu. Bound once,
  // on the document, so it still fires for clicks the bar never sees.
  if (!showDashboard.bound) {
    showDashboard.bound = true;
    document.addEventListener('click', (event) => {
      if (!event.target.closest?.('.tabgroup')) closeMenus();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const open = document.querySelector('#tabs .tab-parent[aria-expanded="true"]');
      if (!open) return;
      closeMenus();
      open.focus();
    });
  }
}

function renderTab(id, anchor) {
  hideTip();
  const tabs = visibleTabs();
  const tab = tabs.find((t) => t.id === id) ?? tabs[0];
  // Fall back to the tab actually shown, so a stale id — a hidden tab, or a
  // `goTo` aimed at a section this export cannot fill — lands somewhere real
  // instead of leaving the panel blank.
  id = tab.id;
  state.active = id;
  for (const other of tabs) {
    const button = document.getElementById(`tab-${other.id}`);
    if (!button) continue;
    if (other.id === id) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }

  // The selected tab may be inside a collapsed menu, where its own highlight is
  // invisible. Mark the menu that contains it instead, so the bar always shows
  // where you are — including after a `goTo` from a tile in another section.
  for (const group of GROUPS) {
    document.getElementById(`tabgroup-${group.id}`)
      ?.classList.toggle('is-active', group.id === tab.group);
  }

  const panel = $('panel');
  panel.replaceChildren(tab.render(state.summary, state.results));
  panel.setAttribute('aria-labelledby', `tab-${id}`);

  // An overview tile that names a number should land on the table behind it,
  // not at the top of a tab the reader then has to search.
  const target = anchor ? document.getElementById(anchor) : null;
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function updateReminder() {
  const bar = $('reminder');
  bar.hidden = state.downloaded;
  if (state.downloaded) return;
  bar.replaceChildren(
    h('p', {}, h('strong', {}, 'Nothing is saved in your browser. '),
      'Download your history file to compare against your next Instagram data.'),
    h('button', { class: 'btn btn-primary', type: 'button', onclick: saveHistory }, 'Download history'),
  );
}

function saveHistory() {
  download(historyFilename(state.summary.profile.username), serializeHistory(state.history));
  state.downloaded = true;
  updateReminder();
  if (state.active === 'export') renderTab('export');
}

// ── export tab ─────────────────────────────────────────────────────────────
function exportView(summary, results) {
  const frag = document.createDocumentFragment();
  const snapshots = state.history?.snapshots?.length ?? 0;
  const bytes = serializeHistory(state.history).length;

  frag.append(section('Take your analysis with you',
    'This page keeps nothing. Everything you just looked at exists only in this tab, and closing it ' +
    'discards the lot. The history file is how you carry the numbers forward.',
    h('div', { class: 'grid cols-3' },
      tile('Snapshots stored', snapshots),
      tile('History file size', `${(bytes / 1024).toFixed(0)} KB`),
      tile('Processed in', `${((state.stats?.ms ?? 0) / 1000).toFixed(1)}s`, {
        sub: `${state.stats?.files ?? 0} files read, ${state.stats?.skippedMedia ?? 0} media skipped`,
      }),
    ),
  ));

  frag.append(section(null, null, h('div', { class: 'grid cols-2' },
    card('History file (JSON)',
      'The one to keep. Upload it next time to unlock trends. It holds your username, ' +
      'follower and following handles with their dates, per-day activity totals, your top creators and ' +
      'the people who message you — and none of your email, phone, IP addresses, device IDs, GPS ' +
      'coordinates or message text.',
      h('div', { class: 'dropzone-actions dropzone-actions--start' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: saveHistory },
          state.downloaded ? 'Download again' : 'Download history'))),
    card('Metric timeline (CSV)',
      'A flat row per snapshot for spreadsheets. Derived from the history file — it cannot be uploaded back, ' +
      'because flattening loses the follower lists the deltas are computed from.',
      h('div', { class: 'dropzone-actions dropzone-actions--start' },
        h('button', {
          class: 'btn',
          type: 'button',
          onclick: () => download(
            `insta-metrics-${summary.profile.username ?? 'account'}.csv`,
            historyToCsv(state.history),
            'text/csv',
          ),
        }, 'Download CSV'))),
  )));

  frag.append(section('What is in the history file', null, card(null, null, table(
    [
      { key: 'k', label: 'Stored' },
      { key: 'v', label: 'Detail' },
    ],
    [
      { k: 'Your username', v: summary.profile.username ?? '—' },
      { k: 'Follower handles + join dates', v: `${fmt(results.audience.insights.followers)} entries` },
      { k: 'Following handles + dates', v: `${fmt(results.audience.insights.following)} entries` },
      { k: 'Published posts', v: `${fmt(results.content.totals.published)} timestamps and types` },
      { k: 'Top creators', v: 'handle and affinity score only' },
      {
        k: 'People who message you',
        v: `${fmt(results.fans.totals.people)} names and message counts — no message text`,
      },
      { k: 'Daily totals', v: 'views, likes, comments and ads per day' },
      { k: 'Advertisers', v: `${fmt(results.ads.totals.advertisersWithYourData)} company names` },
    ],
  ))));

  frag.append(section('Never written to it', null, card(null, null, table(
    [{ key: 'k', label: 'Excluded' }],
    [
      { k: 'Email, phone number, date of birth' },
      { k: 'Signup IP and all login IP addresses' },
      { k: 'Device identifiers and user agents' },
      { k: 'GPS coordinates from your posts' },
      { k: 'Synced contacts — other people\'s phone numbers' },
      { k: 'Message text, captions and comment text' },
    ],
  ))));

  frag.append(passportSection(results));
  return frag;
}

// ── boot ───────────────────────────────────────────────────────────────────
initTheme();
initIntake();

if (HOST.serviceWorker && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {
    // Offline caching is a bonus; the page works without it.
  });
}
