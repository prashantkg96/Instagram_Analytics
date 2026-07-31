# Instagram Export Analytics

A dashboard for the official Instagram data export. Drop in the ZIP Instagram sends you and
get your audience, growth, content, consumption and privacy exposure — computed entirely in
your browser.

No login. No password. No API. No account risk. Nothing is uploaded and nothing is stored.

```
node build.mjs        # -> dist/instagram-analytics.html (open it, that's all)
```

Or serve `src/` over http and install it as a PWA.

---

## Why this exists alongside the Python app

The Tkinter app in the parent directory scrapes Instagram's private API through `instagrapi`.
That gets live engagement data, at the cost of handing over your password, violating
Instagram's Terms of Service, and risking a ban. This tool reads a file you already have a
legal right to, so it carries none of that risk — and because the export is a historical
record, it can answer questions the scraper cannot.

| | Web tool (this) | Python app |
|---|---|---|
| Data source | Official export ZIP | Private API via `instagrapi` |
| Credentials | none | username + password |
| ToS / ban risk | none | yes |
| Works offline | yes | no |
| Like / view counts, story viewers | **no — not in the export** | yes |
| Giveaway winner picker | no | yes |
| Follower join dates, cohorts, attribution | **yes** | no |
| Ad exposure, off-platform tracking, DM stats | **yes** | no |

---

## The honest part: what the export does not contain

I enumerated all **344 distinct field labels** across every file of a real export. There is
**no like count, comment count, view count, play count, reach or impressions field anywhere.**
Meta omits engagement metrics from data exports.

So this tool cannot show you an engagement rate, your top posts by likes, ghost followers,
or who viewed your stories. Anything claiming otherwise from an export is inventing it.

What it does instead is derive the equivalents from signals the export *does* carry:

| Not available | What this tool shows instead |
|---|---|
| Engagement rate per post | **Followers gained per post** — follower join dates joined against publish times |
| Best hour by engagement | Best hour by follower gain |
| Ghost followers | **One-sided follows** — accounts you follow that you have never once engaged with |
| Active followers | Creators *you* engage with most, weighted by comment/save/like/view |
| Story viewers | Stories and reels *you* viewed, by creator |
| Top posts by likes | Posting cadence, streaks, hashtags, geotags, paid-partnership share |

The follower-gain attribution is the interesting one. Every follower row carries **the date
that person followed you**, and every post carries a publish time, so the two can be joined.
It works from a *single* upload — no history file needed — and it is arguably a better growth
signal than likes. It is still correlation: a `lift` figure compares each post against your
own baseline acquisition rate, and a `confidence` flag tells you when there is too little
data to read anything into the ranking.

---

## History: how trends work

**Nothing persists in your browser** — no localStorage, no IndexedDB, no cookies. Verify it
yourself in DevTools → Application. The cost of that guarantee is that you carry the history
manually:

```
Upload #1:  export.zip                        -> analyse -> download insta-history-you.json
Upload #2:  export.zip + insta-history-you.json -> analyse + trends -> download updated file
Upload #3:  export.zip + insta-history-you.json -> ...
```

Re-uploading the same export is a no-op — snapshots are de-duplicated on the export's
`generatedAt`, so you cannot accidentally flatten your own trend line.

The file is **JSON, not CSV**, because a snapshot is nested: follower lists with join dates,
per-day activity buckets, creator rankings. Flattening those to CSV would lose exactly the
data the deltas are computed from. A CSV of the flat metric timeline is offered as an extra
export for spreadsheets — it cannot be uploaded back.

Size: about **140 KB per snapshot** for a real account, most of it the advertiser list
(2,784 companies on the account I tested). A synthetic fixture is 16 KB.

### What the history file contains

Your username, follower and following handles with their dates, post timestamps and types,
your top creators with affinity scores, per-day activity totals, and advertiser names.

### What it never contains

Email, phone number, date of birth, signup IP, login IP addresses, device identifiers, user
agents, GPS coordinates, synced contacts, message text, captions, comment text.

This is enforced by construction, not by discipline: `history.js` builds the snapshot from an
explicit allow-list and then runs `assertClean()`, which **throws** if a forbidden key ever
appears. A new parser field cannot leak in by being forgotten — it has to be added on purpose.

---

## Privacy — and how to check it rather than trust it

- The page sets **`connect-src 'none'`** in its Content Security Policy. The browser *blocks*
  network requests; the guarantee does not depend on the code being well-behaved.
- **Zero third-party code.** No CDN, no bundler runtime, no `node_modules`. Unzipping uses the
  browser's native `DecompressionStream('deflate-raw')`, which is exactly the codec ZIP uses.
- Your media is never decompressed. Only the data manifests are read — about **90% of the
  archive is skipped entirely** (193 MB of 197 MB on the test export).

To verify:

1. Open DevTools → Network, process an export, and confirm there are no entries beyond the
   app's own files. (Measured: 34 requests, all same-origin, none during processing.)
2. DevTools → Application → Storage: localStorage, sessionStorage and IndexedDB are all empty.
3. Add a temporary `fetch('https://example.com')` anywhere and watch the browser refuse it
   with a CSP violation.
4. Run `node tools/verify.mjs <your-export.zip>`, which greps the produced history file for
   every IP, device ID, coordinate and identifier in your export and fails if any appears.

---

## Layout

```
insta-web-analytics/
├── build.mjs              concatenator -> dist/instagram-analytics.html (no npm)
├── src/
│   ├── index.html         CSP, drop zone, tab shell
│   ├── sw.js              precache for offline; stale-while-revalidate
│   ├── css/base.css       tokens, layout, light/dark
│   └── js/
│       ├── unzip.js       ZIP central directory + native inflate
│       ├── scan.js        HTML record tokenizer (no DOMParser — workers lack it)
│       ├── worker.js      unzip -> parse -> analyse, off the main thread
│       ├── parsers/       one module per export section
│       ├── analytics/     one module per metric family
│       ├── history.js     snapshot schema, merge, allow-list, CSV
│       ├── charts.js      hand-rolled SVG charts
│       ├── ui.js          DOM helpers, sortable tables, cards
│       ├── views.js       one renderer per tab
│       └── main.js        wiring
└── tools/                 Node-side test harness (not shipped to the browser)
```

Two implementation notes worth knowing before editing:

- **`DOMParser` does not exist in Web Workers**, and the heavy files must be parsed off-thread
  (`stories_viewed.html` is 17 MB). `scan.js` therefore walks Meta's markup directly. It is
  depth-tracked, because records nest — a naive split on the record marker yields empty
  leading records.
- **`file://` blocks ES modules and module workers.** That is the entire reason `build.mjs`
  exists: it rewrites the module graph into IIFEs and inlines the worker as a Blob URL, which
  is the one form that runs from disk.

---

## Tools

```bash
node tools/make-fixture.mjs              # synthetic export — no real data in the repo
node tools/verify.mjs <zip|dir>          # end-to-end + privacy assertions
node tools/parse-check.mjs <zip|dir>     # what the parsers extracted
node tools/probe.mjs <dir> [filter]      # structure of each export file
node tools/smoke-unzip.mjs <zip>         # ZIP reader only
node tools/smoke-scan.mjs <dir>          # tokenizer only
node tools/test-bundle.mjs <zip>         # runs the *built* worker, verifying build.mjs
```

`verify.mjs` is the one that matters. On the test export it checks 76 distinctive sensitive
values against the produced history file and asserts none appear.

---

## Supported formats

Both HTML and JSON exports are accepted; the format is sniffed. **The HTML path is the one
verified end-to-end against a real export.** The JSON adapter (`parsers/json.js`) is written
against Meta's published schema and exercised by the fixture, but has not been run against a
live JSON export — if a field looks wrong in JSON mode, suspect there first.

When requesting your export, choose **All time**. A narrower range silently truncates the
activity logs; the tool reads each file's declared date range and merges snapshots on it, but
it cannot recover data Meta did not include.

---

## Known limitations

- Follower counts come from the export, which lists only *current* followers. The growth curve
  is therefore survivorship-biased — people who left are absent. It is labelled as such in the
  UI and is a genuine lower bound, not a true historical follower count.
- Cohort retention reads 100% from a single upload for the same reason; it becomes meaningful
  from the second snapshot on.
- Opening the single-file build from `file://` logs one benign `'file:' URLs are treated as
  unique security origins` message in Chrome. It does not affect anything.
- Timestamps in HTML exports carry no timezone. They are already rendered in the requester's
  local time, so they are parsed as local and only ever compared against each other.

## License

MIT, same as the parent project.
