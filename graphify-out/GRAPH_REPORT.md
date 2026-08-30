# Graph Report - D:/Github/Instagram_Analytics  (2026-08-30)

## Corpus Check
- 27 files · ~65,503 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 657 nodes · 1774 edges · 32 communities (26 shown, 6 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 71 edges (avg confidence: 0.72)
- Token cost: 112,305 input · 0 output

## Community Hubs (Navigation)
- Web Export Parsers
- Chart Renderers
- Desktop Analytics Engine
- Web Analytics Modules
- Desktop App Event Handlers
- Privacy & Build Safeguards
- Desktop App Core UI Logic
- Web Analytics Verification Tools
- Desktop UI Theming
- Chart Drawing Primitives
- Desktop Report Building
- Web Fixture Generator
- Web History Snapshot Builder
- JSON Export Parsing
- Giveaway Filter & Rationale
- Web Audience Analytics
- Web Build Pipeline
- Web ZIP Extraction Core
- Web Export Format Detection
- Web Export Loading & Text Extraction
- Insights Metrics Parsing
- Web Bundle Test Tool
- Growth Attribution Caveats
- Web Analytics Worker
- Import Linter Tool
- App Icon Design
- Web Service Worker
- Requests Dependency
- Export Analytics Concept
- Main.py Exception Handling
- Scraper.py Exception Handling

## God Nodes (most connected - your core abstractions)
1. `InstagramAnalyticsApp` - 74 edges
2. `h()` - 36 edges
3. `field()` - 24 edges
4. `pickAll()` - 23 edges
5. `when()` - 21 edges
6. `iso()` - 20 edges
7. `tile()` - 20 edges
8. `table()` - 20 edges
9. `nodes()` - 19 edges
10. `nodesOf()` - 19 edges

## Surprising Connections (you probably didn't know these)
- `Content-Security-Policy (connect-src 'none')` --semantically_similar_to--> `Privacy & Security (credential storage)`  [INFERRED] [semantically similar]
  insta-web-analytics/src/index.html → README.md
- `Snapshot de-duplication on export generatedAt` --semantically_similar_to--> `Scan Followers & Following step`  [INFERRED] [semantically similar]
  insta-web-analytics/README.md → README.md
- `Dashboard (tabs + panel navigation)` --conceptually_related_to--> `insta-web-analytics (web tool)`  [INFERRED]
  insta-web-analytics/src/index.html → README.md
- `Intake flow (zip upload + optional history compare + analyse)` --conceptually_related_to--> `insta-web-analytics (web tool)`  [INFERRED]
  insta-web-analytics/src/index.html → README.md
- `Your media stays shut (feature tile)` --references--> `insta-web-analytics (web tool)`  [INFERRED]
  insta-web-analytics/src/index.html → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Desktop App Workflow Pipeline** — readme_login, readme_scan_followers_following, readme_store_in_sqlite, readme_generate_reports, readme_scan_engagement, readme_giveaway_winner_picker, readme_fetch_post_data, readme_pick_winner [EXTRACTED 1.00]
- **Web Tool Privacy Guarantee Tiles** — insta_web_analytics_src_index_csp, insta_web_analytics_src_index_nothing_uploaded, insta_web_analytics_src_index_nothing_stored, insta_web_analytics_src_index_no_account_access, insta_web_analytics_src_index_media_stays_shut [EXTRACTED 1.00]
- **Browser-enforced privacy guarantee (CSP, no third-party code, allow-list, verifier)** — insta_web_analytics_readme_connect_src_none, insta_web_analytics_src_index_csp, insta_web_analytics_readme_zero_third_party_code, insta_web_analytics_readme_allow_list_assertclean, insta_web_analytics_readme_verify_mjs [EXTRACTED 1.00]
- **Metrics derived to substitute for missing engagement fields** — insta_web_analytics_readme_missing_engagement_metrics, insta_web_analytics_readme_follower_gain_attribution, insta_web_analytics_readme_lift_and_confidence, insta_web_analytics_readme_one_sided_follows, insta_web_analytics_readme_survivorship_bias [EXTRACTED 1.00]

## Communities (32 total, 6 thin omitted)

### Community 0 - "Web Export Parsers"
Cohesion: 0.10
Nodes (61): parseAds(), coordsOf(), coverageOf(), DEFAULT_TIME_LABELS, handleFromUrl(), hashtagsInText(), hashtagsOf(), iso() (+53 more)

### Community 1 - "Chart Renderers"
Cohesion: 0.11
Nodes (73): arcGauge(), barsChart(), columnChart(), heatmapChart(), lineChart(), responsive(), stackedChart(), acceptFiles() (+65 more)

### Community 2 - "Desktop Analytics Engine"
Cohesion: 0.06
Nodes (60): Connection, compute_account_insights(), compute_engagement_report(), generate_full_report(), get_mutual_followers(), get_new_followers(), get_newly_following(), get_not_following_back() (+52 more)

### Community 3 - "Web Analytics Modules"
Cohesion: 0.09
Nodes (52): ads(), add(), affinity(), WEIGHTS, attribution(), DAY_NAMES, stamps(), consumption() (+44 more)

### Community 4 - "Desktop App Event Handlers"
Cohesion: 0.09
Nodes (29): Client, check_session(), _get_client(), get_last_client(), get_last_client_username(), get_session_file(), IGRateLimitError, IGTimeoutError (+21 more)

### Community 5 - "Privacy & Build Safeguards"
Cohesion: 0.06
Nodes (37): instagrapi>=2.1.2 dependency, Pillow>=10.0.0 dependency, Allow-list snapshot build with assertClean() throw, build.mjs single-file concatenator (file:// module workaround), connect-src 'none' as browser-enforced privacy guarantee, parsers/json.js JSON export adapter (unverified path), History as nested JSON rather than CSV, tools/make-fixture.mjs synthetic export (+29 more)

### Community 6 - "Desktop App Core UI Logic"
Cohesion: 0.10
Nodes (9): InstagramAnalyticsApp, main(), Disable *button* for *seconds*, showing a countdown on its label., Start periodic background pings to keep the Instagram session warm., Format elapsed seconds as human-readable string., Grey out the login button if this user already has a live session., Validate the media count entry and enable/disable engagement btn., Get validated media count, default 30. (+1 more)

### Community 7 - "Web Analytics Verification Tools"
Cohesion: 0.08
Nodes (24): axisCovers(), axisFits(), churn, counts, data, dropped, feedPosts, followerMetric (+16 more)

### Community 8 - "Desktop UI Theming"
Cohesion: 0.17
Nodes (8): Frame, _hover_bind(), _load_photo_tk(), Bind heading clicks to sort the treeview by that column., Add a filter entry above *parent*. Filters rows matching text in any of…, Build a user table with unfollow, browser, and select controls. *key*…, Add hover color transition to a button., Color-code notebook tabs by category.

### Community 9 - "Chart Drawing Primitives"
Cohesion: 0.29
Nodes (23): barPath(), drawBars(), drawColumns(), drawGauge(), drawHeatmap(), drawLine(), drawStacked(), el() (+15 more)

### Community 10 - "Desktop Report Building"
Cohesion: 0.18
Nodes (4): Establish a session without scraping any data., Show disclaimer for *username*. Returns True if accepted. Each account gets its…, Update UI to reflect that *username* has an active session., Load and display the most recent report for *username* if available.

### Community 11 - "Web Fixture Generator"
Cohesion: 0.19
Nodes (17): avatarFull, cell(), CREATORS, dayOffset(), files, FOLLOWERS, FOLLOWING, hashtagBlock() (+9 more)

### Community 12 - "Web History Snapshot Builder"
Cohesion: 0.18
Nodes (15): assertClean(), buildSnapshot(), dailyBuckets(), emptyHistory(), FORBIDDEN, historyFilename(), mergeSnapshot(), SCHEMA_VERSION (+7 more)

### Community 13 - "JSON Export Parsing"
Cohesion: 0.33
Nodes (15): at(), fixMojibake(), impressions(), listOf(), mapField(), mapTime(), mediaItem(), parseJsonExport() (+7 more)

### Community 14 - "Giveaway Filter & Rationale"
Cohesion: 0.17
Nodes (6): Simple hover tooltip., Enable/disable Followers checkbox based on 'Not my post'., Called on main thread after giveaway data is fetched., Recompute eligible users based on checkbox selection., Rebuild the eligible users treeview., _ToolTip

### Community 15 - "Web Audience Analytics"
Cohesion: 0.33
Nodes (11): acquisitionByMonth(), audience(), by(), cohortRetention(), diffPeople(), pct(), reciprocity(), relationships() (+3 more)

### Community 16 - "Web Build Pipeline"
Cohesion: 0.25
Nodes (9): bundle(), graph(), key(), loadModule(), OUT, outFile, ROOT, SRC (+1 more)

### Community 17 - "Web ZIP Extraction Core"
Cohesion: 0.38
Nodes (10): applyZip64Extra(), bytesOf(), extractBinary(), findEocd(), inflateRaw(), listEntries(), parseCentralDirectory(), readDirectoryBounds() (+2 more)

### Community 18 - "Web Export Format Detection"
Cohesion: 0.22
Nodes (7): detectFormat(), parseExport(), d, dated, n(), row(), t

### Community 19 - "Web Export Loading & Text Extraction"
Cohesion: 0.29
Nodes (7): extractText(), isDataFile(), loadExport(), walk(), followers, t, wanted

### Community 20 - "Insights Metrics Parsing"
Cohesion: 0.39
Nodes (8): htmlPairs(), LOOKUP, METRICS, norm(), numeric(), pairs(), parseInsights(), share()

### Community 21 - "Web Bundle Test Tool"
Cohesion: 0.25
Nodes (7): checks, done, messages, progress, ROOT, shim, workerSource

### Community 22 - "Growth Attribution Caveats"
Cohesion: 0.33
Nodes (6): All-time export range requirement, Follower-gain attribution (join dates joined to publish times), Lift vs baseline acquisition rate and confidence flag, Export omits engagement metrics (344 field labels audited), One-sided follows (export-side ghost-follower substitute), Survivorship-biased growth curve limitation

### Community 24 - "Import Linter Tool"
Cohesion: 0.40
Nodes (3): files, imported, SRC

### Community 25 - "App Icon Design"
Cohesion: 1.00
Nodes (3): Desktop App Icon (Bar Chart Trend Glyph), Bar Chart + Trend Line Combo Motif, Purple-to-Pink Diagonal Gradient Brand Color Scheme

## Knowledge Gaps
- **96 isolated node(s):** `ROOT`, `SRC`, `OUT`, `outFile`, `WEIGHTS` (+91 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `InstagramAnalyticsApp` connect `Desktop App Core UI Logic` to `Desktop Analytics Engine`, `Desktop App Event Handlers`, `Desktop UI Theming`, `Desktop Report Building`, `Giveaway Filter & Rationale`, `Desktop Batch User Actions`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `serializeHistory()` connect `Web History Snapshot Builder` to `Chart Renderers`, `Web Analytics Verification Tools`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `historyToCsv()` connect `Web Build Pipeline` to `Chart Renderers`, `Web History Snapshot Builder`, `Web Analytics Verification Tools`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `InstagramAnalyticsApp` (e.g. with `IGRateLimitError` and `IGTimeoutError`) actually correct?**
  _`InstagramAnalyticsApp` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `ROOT`, `SRC`, `OUT` to the rest of the system?**
  _96 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Web Export Parsers` be split into smaller, more focused modules?**
  _Cohesion score 0.09683544303797469 - nodes in this community are weakly interconnected._
- **Should `Chart Renderers` be split into smaller, more focused modules?**
  _Cohesion score 0.11483253588516747 - nodes in this community are weakly interconnected._