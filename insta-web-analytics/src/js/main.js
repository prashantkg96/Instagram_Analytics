// main.js — wiring: file intake, worker orchestration, tab rendering.

import { h, fmt, download, card, section, notice, table, tile } from './ui.js';
import { hideTip } from './charts.js';
import { serializeHistory, historyToCsv, historyFilename } from './history.js';
import { setNavigator } from './nav.js';
import {
  overview, audienceView, growthView, contentView, engagementView,
  consumptionView, adsView, messagesView, privacyView, trendsView,
} from './views.js';

const TABS = [
  { id: 'overview', name: 'Overview', render: overview },
  { id: 'audience', name: 'Audience', render: audienceView },
  { id: 'growth', name: 'Growth', render: growthView },
  { id: 'content', name: 'Content', render: contentView },
  { id: 'engagement', name: 'Your engagement', render: engagementView },
  { id: 'consumption', name: 'Consumption', render: consumptionView },
  { id: 'ads', name: 'Ads & tracking', render: adsView },
  { id: 'messages', name: 'Messages', render: messagesView },
  { id: 'privacy', name: 'Privacy audit', render: privacyView },
  { id: 'trends', name: 'Trends', render: trendsView },
  { id: 'export', name: 'Export', render: exportView },
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
      box.replaceChildren(notice(`<strong>Could not read that export.</strong> ${message.message}`, 'danger'));
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
    showDashboard();
  };

  worker.onerror = (event) => {
    worker.terminate();
    $('analyse').disabled = false;
    $('progress').hidden = true;
    const box = $('intake-error');
    box.hidden = false;
    box.replaceChildren(notice(
      `<strong>The analyser crashed.</strong> ${event.message ?? 'Unknown error'}`, 'danger',
    ));
  };

  worker.postMessage({ file: state.zipFile, historyText: state.historyText });
}

// ── dashboard ──────────────────────────────────────────────────────────────
function showDashboard() {
  $('intro').hidden = true;
  $('dashboard').hidden = false;

  const bar = $('tabs');
  bar.replaceChildren(...TABS.map((tab) =>
    h('button', {
      class: 'tab',
      type: 'button',
      role: 'tab',
      id: `tab-${tab.id}`,
      'aria-selected': String(tab.id === state.active),
      'aria-controls': 'panel',
      onclick: () => renderTab(tab.id),
    }, tab.name)));

  setNavigator(renderTab);
  renderTab(state.active);
  updateReminder();
}

function renderTab(id, anchor) {
  hideTip();
  state.active = id;
  for (const tab of TABS) {
    document.getElementById(`tab-${tab.id}`)?.setAttribute('aria-selected', String(tab.id === id));
  }
  const tab = TABS.find((t) => t.id === id) ?? TABS[0];
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
      'follower and following handles with their dates, per-day activity totals and your top creators — ' +
      'and none of your email, phone, IP addresses, device IDs, GPS coordinates or message text.',
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
