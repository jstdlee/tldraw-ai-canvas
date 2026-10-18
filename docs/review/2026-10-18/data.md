# Data review — DataPipe, Chart, Profile, Database, Table view, HTTP, Read from, Web search

Area: `data`. Tested against a local build on web :5201 / API :8831, Chromium via Playwright,
using the Magpie router (`http://127.0.0.1:3425`) per `ai-config.magpie.json` (no model calls were
actually needed — every scenario in this area is pure table/SQL/chart logic). Specs live in
`tests/review-tmp/data/*.spec.ts` (not product code, scripted node setup + real UI interactions
per BRIEF.md). Screenshots and logs are under
`/tmp/claude-1000/-home-leilei-dev/b748c873-b27f-4f05-99d7-ad20f0decaac/scratchpad/review/data/`.

## 1. Summary

Tested, with real execution through each card's own Run button (never bypassing `execute()`):

- **Every op in `shared/tableOps.ts`'s `TABLE_OPS`** (28 non-hidden ops, all groups: Columns,
  Rows, Values, New column, Combine, Summarise) individually, with hand-computed expected
  output — `select, drop, rename, filter (numeric + text), regexp, sort (asc/desc), dedupe, head
  (+/-N), skip_first, skip_regex, replicate (each/table), convert (upper/lower/trim/number/date),
  replace, fill (value/down/up), split, formula, concat, newcol (formula + second-table), datepart,
  bin, case, rank, cumsum, pct, append (+ unwired error), lookup (inner/left), groupby, pivot
  (+totals), unpivot`.
- **Chart**: all 9 kinds (bar, hbar, line, area, scatter, pie, donut, histogram, heatmap)
  rendered and visually inspected; Chart → Output(image) downstream use.
- **Profile**: stats correctness (type/fill%/distinct/min/max/mean) against hand-built data with
  a missing cell; Profile output → Table view downstream use.
- **Database**: built-in Postgres (PGlite) CREATE/INSERT/SELECT and the WP26 quote/comma/NULL
  contract; DuckDB (`:memory:`, no server) CREATE/SELECT plus loading wired `rows` into a table;
  SQLite upload/query/write, Save file/Download gating, and a real browser-downloaded `.sqlite`
  file; results-grid sort/filter/expand; a bad-SQL error path.
- **HTTP**: a real tiny local HTTP server (not `page.route`, which can't reach the server-side
  fetch) serving a JSON array → DataPipe → Chart; a 404 error path.
- **Web search**: mocked `/api/search` → results wired straight into Table view and inspected.
- **Read from / Table view / Save / Download**: real file upload of a CSV, Table view sort by
  header click, live filter, Copy as CSV, a Save-node write verified on disk, and a SQLite
  card's real browser download verified as a valid `.sqlite` file.
- **Edge data**: unicode + emoji + multi-line quoted cells + embedded commas + empty cells
  through the full DataPipe → Chart → Profile → Table view chain; a genuinely empty table;
  5,000 rows (DataPipe sort ≈850ms, Table view render ≈375ms, live filter, full-size viewer,
  Copy as CSV on the 5,000-row result).
- **One full real-UI-driven chain**: library-sidebar insert → real CSV upload → real mouse
  drag-to-wire → real Operation/Column/Condition dropdown clicks → real Chart kind pick → real
  Table view sort-click/filter-type/Copy as CSV, nothing scripted past node placement.

**Counts by severity:** P1: 6. P2: 3. All 9 reproduced at least once; the six marked "(x2)" below
were explicitly reproduced twice as required. 77/77 of my own scripted/UI checks pass once
written correctly — the counts above are about the *product*, not my test pass rate.

**Top 5 problems:**
1. **DATA-01** — Chart's in-card live preview is permanently blank whenever the card first
   renders before its data exists — i.e. the single most common real pattern, wire a DataPipe
   into an empty Chart and press Run.
2. **DATA-02** — A failed run's red error banner renders *outside* the card's own box and
   routinely ends up hidden under tldraw's fixed bottom toolbar: a query/formula can fail with
   **no visible error anywhere** except a deceptively normal "NNN ms" Run button.
3. **DATA-03** — Built-in Postgres (PGlite) query results render as a plain text block — no
   sortable/filterable/expandable grid, unlike every other Database source.
4. **DATA-04** — A single column of ordinary free text (e.g. full names, titles) is rejected as
   "Looks like plain text, not a table", with no manual override.
5. **DATA-05** — Table view's click-to-sort treats a thousands-separated numeric column
   ("1,000") as text, while DataPipe's own Sort op and Profile both get it right.

## 2. Findings

### DATA-01 — P1 — Chart's live preview never renders if the card mounts before it has data (the normal wiring pattern)

**Steps:** Create a DataPipe card with real data, wire its output into a *new, empty* Chart
card's `data` input (Chart's own Text field stays empty — the standard way to use Chart), zoom
to fit, run the DataPipe, then run the Chart.
**Expected:** The chart draws inside the card, like it does when the card already had literal
sample text at creation.
**Actual:** The card's own fields (Kind/X column/Y columns/…) populate correctly, `execute()`
succeeds, the output PNG is generated correctly (confirmed: real, correctly-sized images, e.g.
1920×1200), and even "Open the chart" (the maximize icon) shows the correct rendered chart — but
the **inline live preview area stays permanently blank**, with no error. Clicking Run again, or
changing the Kind dropdown, does not fix it. The only thing that fixes it is an incidental
unmount/remount of the card (e.g. panning far away and back).
**Why this matters in practice:** it's not a rare edge case — it's what happens whenever a user
drags a DataPipe's output into a blank Chart card and runs the pipeline, which is the main way
anyone would use this card. The only visible symptom is "the chart area is empty"; nothing says
why, and nothing in the UI hints that clicking the small maximize icon would actually show it.
**Evidence:**
`.../chart-isolation-blank.png` (blank, `.ChartNode-view` has 0 children) vs
`.../chart-isolation-control.png` (same data, but typed into Chart's own Text field at creation
— 2 children, renders correctly) — `tests/review-tmp/data/chart-render-repro3.spec.ts`.
`.../chart-self-heal-final.png` — panning far away and back (forcing a remount) fixes it —
`tests/review-tmp/data/chart-render-repro4.spec.ts`. `.../chart-blank-but-maximize-works.png` —
the workaround (maximize icon still shows the correct PNG) —
`tests/review-tmp/data/chart-render-repro4.spec.ts`'s sibling debug run. `.../http-chart.png` —
the same bug hit "naturally" while testing the HTTP → DataPipe → Chart scenario.
**Suspected cause:** `client/pipeline/nodes/types/DataNodes.tsx` `ChartComponent`'s mount
`useEffect` (lines ~1249–1271) creates the echarts instance via `const host = ref.current; if
(!host) return` with an **empty dependency array** (`[]`, mount-only). The `<div ref={ref}
className="ChartNode-view">` that `ref` points to is only rendered when
`table.headers.length > 0 && columns.yCols.length > 0` (line ~1404); until the wired upstream
has actually produced a value, that's false, so on first mount `ref.current` is `null` and the
effect bails out **permanently** — it never runs again when the div later appears, because its
deps array is `[]`. The *second* effect (the one that calls `chart.setOption(...)` whenever
`table`/`spec` change, line ~1273) checks `if (!chart) return` — since `chartRef.current` was
never set, this is a silent no-op forever, even once real data arrives.
**Suggested fix:** don't gate the echarts init on data being present — always render the
`<div ref={ref}>` host (even while showing the "wire in a table" empty state as an overlay, or
simply keep the host mounted and move the "no data" message to a sibling), or re-run the mount
effect (swap `[]` for a dependency that flips once `ref.current` becomes non-null, or use a
callback ref that lazily initializes echarts the first time it's actually attached).

### DATA-02 — P1 — A failed run's error banner renders outside the card and is commonly hidden behind tldraw's own toolbar

**Steps:** Any card, any failure (e.g. DataPipe with an empty "Keep columns" table, or a bad SQL
statement on a Database card). Create it, `zoomToFit` (what every test helper and, presumably,
most users' "look at what I made" habit does), click Run.
**Expected:** The red "Run failed — <message>" banner is visible somewhere on the card.
**Actual:** `node.error` is set correctly (confirmed via the shape's own stored props), and a
real `.NodeErrorBanner` element with the correct message *is* in the DOM and even reports
`visible: true` to Playwright — but its bounding box starts **below the card's own declared
bottom edge** (measured: the card's box ends at y≈656/487, the banner starts at y≈665/491, i.e.
a few to ~10px past the end of the shape's own box in two different reproductions). Because
`zoomToFit` naturally seats a card's bottom edge close to the *viewport's* bottom edge, that
overflow routinely lands exactly where tldraw's fixed bottom toolbar sits, and the toolbar paints
over it. What a user actually sees: the generic Run button simply reads "**35 ms**" or "**153
ms**" — indistinguishable from a successful run — with no error text anywhere on screen.
**Evidence:** `.../error-banner-overflow-fullpage.png` (DataPipe: you can see a thin red sliver
of the banner peeking out from under the bottom toolbar, its text unreadable) and
`.../db-error-fullpage.png` (Database: same thing, full "⚠ Run failed / syntax error..." banner
entirely hidden under the toolbar, footer reads a plain "84 ms"). Reproduced twice (DataPipe, two
separate cards) in `tests/review-tmp/data/error-banner-overflow.spec.ts` with the exact pixel
gap logged each time.
**Suspected cause:** `client/pipeline/nodes/NodeShapeUtil.tsx` lines ~452–505: `.NodeShape-footer`
(the Run button + tool icons) is followed by a **sibling** `{showBanner ? <NodeErrorBanner/> :
<NodeRunStatus/>}` (lines 486–496). No node type's `getBodyHeightPx` budgets extra room for the
banner case — e.g. `TableNodeDefinition.getBodyHeightPx`
(`client/pipeline/nodes/types/DataNodes.tsx` ~159–181) and `DatabaseNodeDefinition.getBodyHeightPx`
(`client/pipeline/nodes/types/DatabaseNode.tsx` ~265–269) both compute a fixed height that only
ever accounts for the *success*-path footer, so the banner — which is taller — spills past the
shape's own bounds.
**Suggested fix:** reserve the banner's height in every node's `getBodyHeightPx` (it's a known,
roughly-fixed-height element), or render it inside the shape's own box by replacing/growing the
footer row instead of appending a sibling that can exceed the declared height.

### DATA-03 — P1 — Built-in Postgres (PGlite) results have no sortable/filterable/expandable grid, unlike every other source

**Steps:** Database card, Source = "Built-in Postgres", run any `SELECT`.
**Expected:** The same `SortFilterTable`-based grid (clickable-sort headers, a filter box, a
maximize/expand icon) that the SQLite source and external Postgres/DuckDB sources both show.
**Actual:** Results render as a plain, unstyled block of raw CSV text (`name,score` on its own
line, `Ada,91` on the next, etc.) — no column alignment, no header row styling, no sort, no
filter, no expand. Confirmed both visually and via `.SortFilterTable-grid` being entirely absent
from the DOM.
**Evidence:** `.../pglite-select.png` (plain text block) vs. `.../database-results-zoom.png` (the
real grid, SQLite source, same kind of data). Reproduced twice in
`tests/review-tmp/data/database.spec.ts`'s "PGlite results render as a plain text block" test.
**Suspected cause:** `client/pipeline/nodes/types/DatabaseNode.tsx` line 509:
`const preview = source === 'sqlite' && node.lastOutput ? parseCsvPreview(node.lastOutput) : null`
— the grid (`ExpandableTable`) is only built when `source === 'sqlite'`. PGlite is not
`isExternal()` either, so it falls all the way through to the generic `node.lastOutput ? <pre>`
branch (~lines 697–711) meant for odd/non-tabular output.
**Suggested fix:** extend that condition to include `'pglite'` (its output is the same RFC 4180
CSV `toCsv()` text as sqlite's), or more robustly, always try `parseCsvPreview` first for any
source and only fall back to the raw-text view when parsing fails.

### DATA-04 — P1 — A single column of ordinary free text is rejected as "not a table"

**Steps:** Paste/wire a one-column table of real sentences, e.g.
`name\nAda Lovelace\nAda King` into any data card (DataPipe, Profile, Table view).
**Expected:** A one-column table with header `name` and two rows.
**Actual:** `Error: Looks like plain text, not a table: "name Ada Lovelace Ada King"` — the card
errors out and nothing downstream gets a table at all. Wrapping the same values in quotes
(`"Ada Lovelace"`) makes it parse correctly, confirming the cause.
**Evidence:** `.../bug-single-column-text-rejected.png`. Reproduced twice (DataPipe) plus once on
Profile in `tests/review-tmp/data/edge-data.spec.ts`; the quoted-value control case passes in the
same file.
**Suspected cause:** `shared/tableText.ts`'s `garbageError()` (lines 186–201). Its heuristic: a
one-column table is "plain text" when most of its cell values contain internal whitespace
("mostly spaced"), on the theory that a real one-column table of *ids or single words* has none.
That assumption is wrong for very ordinary real-world single-column data — full names,
addresses, titles, free-text notes — which legitimately has spaces in most/all values. Any
one-column paste of such data is misdetected as a stray sentence.
**Suggested fix:** narrow the heuristic (e.g. only flag it when the "column" also fails to look
like a single coherent list — multiple *different* line lengths/shapes, not just "has spaces"),
or — better — add a manual override next to the parse error ("Treat as one column anyway") so a
wrong guess is never a hard dead end.

### DATA-05 — P1 — Table view's click-to-sort treats thousands-separated numbers as text

**Steps:** Table view with a numeric column written with thousands separators, e.g.
`amount` = `"1,000"`, `"250"`, `"999,000"`, `"9,500"`, `"80"` (valid, comma-quoted CSV cells).
Click the `amount` header to sort ascending.
**Expected:** Numeric ascending order, starting at `80` (same as DataPipe's own Sort op, which
gets this right on the identical data).
**Actual:** The column sorts as text (confirmed: the first row after ascending sort is never
`"80"`, the correct numeric minimum), because commas are never stripped before the numeric
comparison is attempted.
**Evidence:** Logged exact first-cell value each run in
`tests/review-tmp/data/edge-data.spec.ts`'s thousands-separator test (reproduced twice); the same
test confirms DataPipe's Sort op puts `80` first on identical input.
**Suspected cause:** `shared/tableText.ts`'s `compareCells()` (lines 255–260) does
`Number(a)`/`Number(b)` directly — `Number("1,000")` is `NaN`, so the column falls back to
`localeCompare`. Contrast with `shared/tableOps.ts`'s own `toNumber()` (~line 128:
`Number((value ?? '').replace(/,/g, ''))`, used by DataPipe's Sort/Convert ops) and
`shared/profile.ts`'s `toNum()` (~line 35, same comma-strip) — both already handle this
correctly. `compareCells` is the one place in the table-text layer that doesn't.
**Suggested fix:** strip commas the same way in `compareCells` before calling `Number()` (one
line, matching the existing `toNumber`/`toNum` helpers) — this also fixes Table view's sort for
every card that reuses `sortTableRows` (the compact preview table, the full-size zoom viewer).

### DATA-06 — P1 — A row that is empty in every column is silently dropped while parsing (no warning, no row-count change shown)

**Steps:** Any table with a row where *every* cell is empty, e.g. `a,b\n1,x\n,\n3,z` (one data
row is just `,`).
**Expected:** A 3-row table (one row with both `a` and `b` empty), or at minimum, a visible
indication that a row was dropped.
**Actual:** The table silently becomes 2 rows (`1,x` and `3,z`) — the fully-blank row simply
never exists by the time any operation, count, or display sees it. Nothing in the UI reports
this. The practical bite: a single-column table's "Fill empty cells" op can never fill a truly
blank row, because for a one-column table "every cell empty" and "this one cell is empty" are the
same thing, so that row is gone before Fill (or anything else) ever runs.
**Evidence:** Reproduced twice in `tests/review-tmp/data/edge-data.spec.ts` ("a row that is
wholly empty... silently disappears"), asserting the row count and exact surviving CSV.
**Suspected cause:** `shared/tableText.ts`'s `splitDelimited()` (line 82) and the duplicate
parser in `shared/tableOps.ts`'s `parseDelimited()` (line 78) both end with
`return rows.filter((line) => line.some((part) => part.length > 0))` — intended to drop trailing
blank lines from a pasted CSV, but it also drops any *interior* all-empty row, with no signal
that anything happened.
**Suggested fix:** only drop a wholly-blank line when it is at the very start/end of the input
(true "trailing blank line" tolerance), not anywhere in the middle; or keep the row and let the
normal "N rows" count in each card's own info line make the loss visible if it's ever intentional.

### DATA-07 — P2 — DataPipe's "Table" input has no visible port dot until something is already wired (Profile/Table view fixed this exact gap)

**Steps:** Insert a fresh DataPipe card (nothing wired in yet) next to a fresh Profile card.
Look at each card's top input row.
**Expected:** Both show a small coloured dot marking the input port, the way every other
dedicated input does.
**Actual:** Profile's "Table" row has a dot; DataPipe's does not — there is literally no `<Port>`
element in that row until `data` is wired. A connection dropped onto that row by proximity still
binds correctly (tldraw falls back to nearest-port geometry), so it's not a hard functional
block, but there is nothing to see or aim at.
**Evidence:** `.../datapipe-vs-profile-port-dot.png` (side by side, DataPipe left has no dot next
to "Table", Profile right does). Reproduced twice (two DataPipe cards) with a DOM-level
`.Port` count assertion in `tests/review-tmp/data/datapipe-port-dot.spec.ts`, contrasted against
Profile and Table view (both: 1 dot, always).
**Suspected cause:** `client/pipeline/nodes/types/DataNodes.tsx`'s `TableComponent` (~line 790):
`{dataWired ? <PortRow .../> : <NodeRow><span className="NodePortLabel">Table</span>...}` only
renders a `<Port>` in the wired branch. Profile's and Table view's own source comments
record that they hit and fixed this *exact* bug previously ("its own row/anchor must always
render, not just while wired... it used to borrow the text field's row when unwired, leaving
`data` with no visible dot at all in the default state") by always rendering `PortRow` — DataPipe
was evidently missed when that fix went in elsewhere.
**Suggested fix:** same fix Profile/Table view already have: always render `PortRow` for `data`,
and show the Inline/File segmented control as a second row underneath rather than folded into
the port's own row.

### DATA-08 — P2 — Switching DataPipe's Operation leaves a stale, now-invalid value in a shared field (confusing display, then a cryptic error)

**Steps:** A fresh DataPipe card (`getDefault()` ships `as: 'number'`, meaningful to the
`convert` op). Switch Operation to "Filter rows" via the dropdown, pick a real column, leave
Condition untouched, press Run.
**Expected:** Condition defaults to a valid choice (e.g. "="), or is visibly empty/unset.
**Actual:** The Condition dropdown displays **"number"** — not one of the filter conditions
(=, ≠, >, ≥, <, ≤, contains, …) — because the field is shared storage (`as`) across every op and
switching ops never resets it. If the user doesn't happen to open that dropdown, Run throws
`Filter rows: unknown condition number`.
**Evidence:** Reproduced twice via the real Operation dropdown in
`tests/review-tmp/data/op-switch-stale-field.spec.ts`, logging the shown value and the resulting
error each time.
**Suspected cause:** `client/pipeline/nodes/types/DataNodes.tsx` line 846:
`<UiSelect value={node.op} options={OP_OPTIONS} onChange={(op) => set({ op })} />` — only `op`
changes; `column/columns/as/expr/sep/pattern/with/name` all carry over unchanged from whatever
the previous op (or `getDefault()`) left in them.
**Suggested fix:** when `op` changes, reset the fields the new op doesn't share a meaning with
(at minimum `as`, since its valid value set is different for nearly every op that uses it), or
have each `UiSelect` for an enum-kind param fall back to its first option when the stored value
isn't one of its own `options` (cheap, local fix, same idea the code already half-applies via
`value || param.options?.[0]?.value`, which only helps when the stored value is *falsy*, not when
it's a non-matching leftover).

### DATA-09 — P2 — DataPipe/Profile/Table view spam the dev console with "no port anchor" warnings (follow-up to UI-14)

Directly follows up on the UI reviewer's **UI-14** ("Dev console flood of 'no port anchor'
warnings... needs follow-up... could not confirm this happens via normal UI insert+wire flow").
For this area's three cards it reproduces reliably via completely normal UI flows (no perf-helper
shape creation needed), and does **not** cause a misplaced/invisible port — it's noise only:
**Steps:** Wire a DataPipe/Profile/Table view card's `data` input (hiding the literal-text
field), or switch DataPipe to an op that doesn't use one of `column/columns/as/expr/sep/pattern/
with/name`.
**Actual:** The dev console logs e.g. `[WP17] "text" on a "profile" card has no field-port
anchor — its port is stuck on the header row` or `[WP17] "columns" on a "table" card has no
field-port anchor...`, every time, for as long as that state holds.
**Evidence:** Logged on essentially every test run in this report that wires a Profile/Table view
`data` port or switches a DataPipe op — see any `[WebServer] ... [WP17] ...` line in e.g.
`tests/review-tmp/data/database.spec.ts`'s or `tests/review-tmp/data/edge-data.spec.ts`'s run
output.
**Suspected cause:** `client/pipeline/nodes/fieldVisibility.ts`'s `hiddenFieldKeys()` (lines
14–82) has no `case` for `'table'`, `'profile'`, or `'table_view'` — so the invariant check in
`client/pipeline/nodes/nodeTypes.tsx` (~lines 180–189) still expects an anchor for every
field `nodeSpecs.ts` marks wirable, even for the ones each component conditionally doesn't render
(Profile/Table view's `text` field while `data` is wired; DataPipe's every op-specific field the
current op doesn't use).
**Suggested fix:** add the missing cases — `profile`/`table_view`: hide `text` while `data` is
wired; `table`: hide every op param not in that op's own `OpSpec.params` list (the data already
exists via `opSpec(node.op)`).

## 3. Pipeline gaps for `data`

- **Manual "force a table shape" override on parse failure** — ties directly to DATA-04. When
  `parseTableText` rejects input, give the user an escape hatch (e.g. "Treat as one column
  anyway" / an explicit CSV/TSV/one-column override) instead of a dead end. Inputs: the same
  text/data already on the card. Priority: P1 (pairs with DATA-04).
- **PGlite results grid** — ties to DATA-03; same `ExpandableTable`/`SortFilterTable` the other
  three sources already get. Priority: P1.
- **A visible "N rows skipped (blank)" note, or an explicit "Remove blank rows" op** — right now
  `parseTableText` silently drops any wholly-empty row with no way to see it happened (DATA-06).
  A dedicated op would also let a user deliberately clean up ragged pasted data instead of
  relying on an undocumented side effect of parsing. Priority: P2.
- **Browser-side "Download as CSV" on DataPipe/Chart/Database** (not just Table view's own "Copy
  as CSV" to the clipboard, and not the generic Save node, which writes to the *server's*
  `data/exports` folder rather than the browser's actual Downloads). Every other export path in
  this area (SQLite's own Download button) does trigger a real browser download; the table cards
  don't have an equivalent. Priority: P2.
- **A visible row/column count as a wireable output**, not just text in the info line — useful
  for branching a pipeline on table size (e.g. "If more than 1000 rows, …") without a separate
  Code/formula node to re-derive it from the CSV text. Priority: P2 (nice-to-have, not a blocker:
  `row count` can already be derived via a `groupby *:count` DataPipe step).

## 4. What works well

- **Every one of the 28 table ops is correct.** I hand-computed expected output for each
  (including groupby's alias syntax, pivot's totals row/column, lookup's inner/left join,
  cumsum/pct's per-group reset, split's padding, bin's edge handling) and all matched exactly —
  a genuinely solid, well-tested core.
- **Thousands separators are handled correctly almost everywhere it matters**: DataPipe's
  Convert-to-number, DataPipe's own Sort op, and Profile's type detection/min/max/mean all strip
  commas correctly (DATA-05 is the one place — Table view's click-sort — that doesn't).
- **The WP26 table-text contract genuinely holds end to end**: unicode (東京, São Paulo), emoji
  (👋), embedded commas, embedded quotes, and multi-line quoted cells all survived a full
  DataPipe → Chart → Profile → Table view chain with correct values at every stage.
- **All 9 chart kinds render correctly** (once the DATA-01 mount-timing issue isn't in play) —
  bar, hbar, line with series, area, scatter, pie, donut, histogram, and heatmap all produced
  visually correct, readable charts from the same dataset.
- **Database is solid once you're past DATA-03**: PGlite and DuckDB (`:memory:`, no external
  server needed) both ran DDL/DML/queries correctly, the `rows` input loading into a DuckDB table
  via `buildLoadPlan` worked exactly as documented (insert mode, correct row count), and SQLite's
  upload → query → write → Save/Download path produced a real, valid `.sqlite` file on a genuine
  browser download.
- **5,000 rows performs well**: DataPipe sort ≈850ms, Table view's own render ≈375ms, live
  filter and the 5,000-row full-size viewer stayed responsive, and "Copy as CSV" on the filtered
  result worked correctly.
- **HTTP and Web search are clean, simple building blocks**: a JSON array response flows straight
  into a table with zero conversion steps (parseTableText's JSON-array-of-objects support), error
  statuses surface clearly, and a web-search mock's results render as a nicely laid-out card and
  wire straight into Table view.
- **The real, hands-on UI flow works end to end**: library-sidebar insert, a genuine file upload,
  a genuine mouse drag-to-wire, the Operation/Column/Condition dropdowns, the Chart kind picker,
  and Table view's sort-by-click + live filter + Copy as CSV all behaved exactly as a user would
  expect, once DATA-07's missing port dot is known about.
