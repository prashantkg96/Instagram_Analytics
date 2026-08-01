# Graph Report - D:/Github/Instagram_Analytics  (2026-08-01)

## Corpus Check
- 58 files · ~63,915 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 649 nodes · 1790 edges · 25 communities (24 shown, 1 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 78 edges (avg confidence: 0.72)
- Token cost: 95,632 input · 0 output

## Community Hubs (Navigation)
- Export File Parsers
- Web App Shell & Tab Navigation
- Desktop Follower Analytics
- Web Analytics Modules
- Web Tool Design Rationale
- Instagram Scraper & Session
- End-to-End Verification Harness
- Desktop App Lifecycle & Accounts
- Tkinter UI Construction & Theming
- Hand-Rolled SVG Charts
- Desktop Report & Database Actions
- Single-File Build & Insights Parser
- Synthetic Fixture Generator
- ZIP Reader & Unzip Smoke Test
- History Snapshot & Worker Pipeline
- JSON Export Adapter
- Audience Relationships & Trends
- Giveaway Picker & Tooltips
- Fixture Loading Helpers
- Parser Spot-Check Tool
- Bundled Worker Test
- App Icon Visual Identity
- Import Linter
- Offline Service Worker

## God Nodes (most connected - your core abstractions)
1. `InstagramAnalyticsApp` - 74 edges
2. `h()` - 36 edges
3. `field()` - 24 edges
4. `pickAll()` - 23 edges
5. `when()` - 21 edges
6. `nodes()` - 20 edges
7. `iso()` - 20 edges
8. `tile()` - 20 edges
9. `table()` - 20 edges
10. `get_connection()` - 19 edges

## Surprising Connections (you probably didn't know these)
- `Allow-list snapshot build with assertClean() throw` --semantically_similar_to--> `Local credential storage (saved_accounts.json, base64)`  [INFERRED] [semantically similar]
  insta-web-analytics/README.md → README.md
- `Manually carried history file (insta-history-*.json)` --semantically_similar_to--> `SQLite snapshot store (db.py)`  [INFERRED] [semantically similar]
  insta-web-analytics/README.md → README.md
- `Snapshot de-duplication on export generatedAt` --semantically_similar_to--> `Follower / following scan and delta analysis`  [INFERRED] [semantically similar]
  insta-web-analytics/README.md → README.md
- `Follower-gain attribution (join dates joined to publish times)` --semantically_similar_to--> `Engagement and content analytics (likes, views, story viewers)`  [INFERRED] [semantically similar]
  insta-web-analytics/README.md → README.md
- `One-sided follows (export-side ghost-follower substitute)` --semantically_similar_to--> `Ghost followers (zero engagement on recent posts)`  [INFERRED] [semantically similar]
  insta-web-analytics/README.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Browser-enforced privacy guarantee (CSP, no third-party code, allow-list, verifier)** — insta_web_analytics_readme_connect_src_none, insta_web_analytics_src_index_csp, insta_web_analytics_readme_zero_third_party_code, insta_web_analytics_readme_allow_list_assertclean, insta_web_analytics_readme_verify_mjs, insta_web_analytics_src_index_privacy_tiles [EXTRACTED 1.00]
- **Metrics derived to substitute for missing engagement fields** — insta_web_analytics_readme_missing_engagement_metrics, insta_web_analytics_readme_follower_gain_attribution, insta_web_analytics_readme_lift_and_confidence, insta_web_analytics_readme_one_sided_follows, insta_web_analytics_readme_survivorship_bias [EXTRACTED 1.00]
- **Desktop app scrape pipeline: login, scan, store, analyse under anti-detection** — readme_instagrapi, readme_session_reuse_keepalive, readme_scan_followers_following, readme_sqlite_snapshot_store, readme_engagement_analytics, readme_anti_detection [EXTRACTED 1.00]
- **Icon Visual Language: Gradient Field, Squircle Mask, Monochrome Chart Glyph** — app_icon_instagram_gradient, app_icon_rounded_squircle_mask, app_icon_white_monochrome_foreground, app_icon_chart_motif [INFERRED 0.85]

## Communities (25 total, 1 thin omitted)

### Community 0 - "Export File Parsers"
Cohesion: 0.10
Nodes (63): parseAds(), coordsOf(), coverageOf(), DEFAULT_TIME_LABELS, handleFromUrl(), hashtagsInText(), hashtagsOf(), iso() (+55 more)

### Community 1 - "Web App Shell & Tab Navigation"
Cohesion: 0.12
Nodes (69): barsChart(), columnChart(), lineChart(), historyFilename(), historyToCsv(), serializeHistory(), acceptFiles(), announce() (+61 more)

### Community 2 - "Desktop Follower Analytics"
Cohesion: 0.06
Nodes (60): compute_account_insights(), compute_engagement_report(), generate_full_report(), get_mutual_followers(), get_new_followers(), get_newly_following(), get_not_following_back(), get_timeline() (+52 more)

### Community 3 - "Web Analytics Modules"
Cohesion: 0.09
Nodes (49): ads(), add(), affinity(), WEIGHTS, attribution(), DAY_NAMES, stamps(), consumption() (+41 more)

### Community 4 - "Web Tool Design Rationale"
Cohesion: 0.05
Nodes (43): All-time export range requirement, Allow-list snapshot build with assertClean() throw, build.mjs single-file concatenator (file:// module workaround), connect-src 'none' as browser-enforced privacy guarantee, Instagram Export Analytics (browser dashboard), Follower-gain attribution (join dates joined to publish times), parsers/json.js JSON export adapter (unverified path), History as nested JSON rather than CSV (+35 more)

### Community 5 - "Instagram Scraper & Session"
Cohesion: 0.10
Nodes (29): Client, check_session(), _get_client(), get_last_client(), get_last_client_username(), get_session_file(), IGRateLimitError, IGTimeoutError (+21 more)

### Community 6 - "End-to-End Verification Harness"
Cohesion: 0.08
Nodes (24): axisCovers(), axisFits(), churn, counts, data, dropped, feedPosts, followerMetric (+16 more)

### Community 7 - "Desktop App Lifecycle & Accounts"
Cohesion: 0.10
Nodes (8): InstagramAnalyticsApp, main(), Disable *button* for *seconds*, showing a countdown on its label., Start periodic background pings to keep the Instagram session warm., Format elapsed seconds as human-readable string., Grey out the login button if this user already has a live session., Validate the media count entry and enable/disable engagement btn., Tk

### Community 8 - "Tkinter UI Construction & Theming"
Cohesion: 0.17
Nodes (8): Frame, _hover_bind(), _load_photo_tk(), Bind heading clicks to sort the treeview by that column., Add a filter entry above *parent*. Filters rows matching text in any of…, Build a user table with unfollow, browser, and select controls. *key*…, Add hover color transition to a button., Color-code notebook tabs by category.

### Community 9 - "Hand-Rolled SVG Charts"
Cohesion: 0.24
Nodes (26): arcGauge(), barPath(), drawBars(), drawColumns(), drawGauge(), drawHeatmap(), drawLine(), drawStacked() (+18 more)

### Community 10 - "Desktop Report & Database Actions"
Cohesion: 0.16
Nodes (5): Establish a session without scraping any data., Show disclaimer for *username*. Returns True if accepted. Each account gets its…, Update UI to reflect that *username* has an active session., Load and display the most recent report for *username* if available., Get validated media count, default 30.

### Community 11 - "Single-File Build & Insights Parser"
Cohesion: 0.17
Nodes (16): bundle(), graph(), key(), loadModule(), OUT, outFile, ROOT, SRC (+8 more)

### Community 12 - "Synthetic Fixture Generator"
Cohesion: 0.19
Nodes (17): avatarFull, cell(), CREATORS, dayOffset(), files, FOLLOWERS, FOLLOWING, hashtagBlock() (+9 more)

### Community 13 - "ZIP Reader & Unzip Smoke Test"
Cohesion: 0.23
Nodes (14): applyZip64Extra(), bytesOf(), extractBinary(), extractText(), findEocd(), inflateRaw(), listEntries(), parseCentralDirectory() (+6 more)

### Community 14 - "History Snapshot & Worker Pipeline"
Cohesion: 0.20
Nodes (12): assertClean(), buildSnapshot(), dailyBuckets(), emptyHistory(), FORBIDDEN, mergeSnapshot(), parseHistory(), SCHEMA_VERSION (+4 more)

### Community 15 - "JSON Export Adapter"
Cohesion: 0.33
Nodes (15): at(), fixMojibake(), impressions(), listOf(), mapField(), mapTime(), mediaItem(), parseJsonExport() (+7 more)

### Community 16 - "Audience Relationships & Trends"
Cohesion: 0.33
Nodes (11): acquisitionByMonth(), audience(), by(), cohortRetention(), diffPeople(), pct(), reciprocity(), relationships() (+3 more)

### Community 17 - "Giveaway Picker & Tooltips"
Cohesion: 0.17
Nodes (6): Simple hover tooltip., Enable/disable Followers checkbox based on 'Not my post'., Called on main thread after giveaway data is fetched., Recompute eligible users based on checkbox selection., Rebuild the eligible users treeview., _ToolTip

### Community 18 - "Fixture Loading Helpers"
Cohesion: 0.31
Nodes (7): isDataFile(), loadExport(), walk(), data, removed, snapshot, [source, out]

### Community 19 - "Parser Spot-Check Tool"
Cohesion: 0.29
Nodes (5): d, dated, n(), row(), t

### Community 20 - "Bundled Worker Test"
Cohesion: 0.25
Nodes (7): checks, done, messages, progress, ROOT, shim, workerSource

### Community 21 - "App Icon Visual Identity"
Cohesion: 0.60
Nodes (6): Instagram Analytics App Icon, Bar-Plus-Trendline Chart Motif, Instagram-Style Purple-to-Crimson Gradient, Instagram Analytics Product Identity, Rounded Squircle Icon Silhouette, Flat White Monochrome Foreground

### Community 22 - "Import Linter"
Cohesion: 0.40
Nodes (3): files, imported, SRC

## Knowledge Gaps
- **88 isolated node(s):** `ROOT`, `SRC`, `OUT`, `outFile`, `WEIGHTS` (+83 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `key()` connect `Single-File Build & Insights Parser` to `Web App Shell & Tab Navigation`, `Web Analytics Modules`, `Hand-Rolled SVG Charts`, `History Snapshot & Worker Pipeline`, `Audience Relationships & Trends`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Why does `InstagramAnalyticsApp` connect `Desktop App Lifecycle & Accounts` to `Desktop Follower Analytics`, `Instagram Scraper & Session`, `Tkinter UI Construction & Theming`, `Desktop Report & Database Actions`, `Giveaway Picker & Tooltips`, `Bulk Unfollow Actions`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `h()` connect `Web App Shell & Tab Navigation` to `Single-File Build & Insights Parser`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `InstagramAnalyticsApp` (e.g. with `IGRateLimitError` and `IGTimeoutError`) actually correct?**
  _`InstagramAnalyticsApp` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `ROOT`, `SRC`, `OUT` to the rest of the system?**
  _88 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Export File Parsers` be split into smaller, more focused modules?**
  _Cohesion score 0.09605540499849442 - nodes in this community are weakly interconnected._
- **Should `Web App Shell & Tab Navigation` be split into smaller, more focused modules?**
  _Cohesion score 0.12214611872146118 - nodes in this community are weakly interconnected._