# WP11 — Column work: formulas, New column, Group, Pivot, Profile

Read `RULES.md` first. Code base after WP1–WP10: DataPipe = node type `table`
(`client/pipeline/nodes/types/DataNodes.tsx`), ops registry `TABLE_OPS` and `runTable` in
`shared/tableOps.ts`, kit in `client/ui/` (UiField is 0.8em in cards; do not shrink controls again;
errors are thrown and shown by the banner, never rendered inline).

## Today (problems)

- `evalFormula` (`shared/tableOps.ts` ~L115) knows only `upper lower trim len concat replace`
  and `+`. No arithmetic, no conditions, no dates, no rounding.
- Group (`groupby`) takes its summaries as free text `score:sum, *:count`. Pivot takes four
  loosely named fields. Users must know the syntax.
- No way to see what is in a table (types, empties, ranges) before working on it.

## Part A — Formula language (`shared/formula.ts`, pure, tested)

Replace the ad-hoc `evalFormula` with a small expression engine (tokenizer + Pratt parser +
evaluator; no `eval`, no new dependency). Keep `evalFormula(expr, record)` as the public
entry (now calls the new engine) so old canvases keep working; the old forms (`upper(name)`,
`a + b`, quoted strings, bare column names) must give the same results.

Language:
- Values: numbers, strings (`"…"` or `'…'`), `true` / `false`, `null`.
- Column references: bare names (`score`), or `[Column with spaces]`.
- Operators: `+ - * / %`, unary `-`, `( )`, comparisons `= != < <= > >=`, `and or not`,
  string concat with `&`. `+` adds when both sides are numbers, else concatenates (old behaviour).
- Functions (case-insensitive):
  - text: `upper lower trim len left(s,n) right(s,n) mid(s,start,n) replace(s,find,with) contains(s,x) startswith endswith split(s,sep,i) concat(…) text(x)`
  - number: `number(x) round(x,d) floor ceil abs min(…) max(…) pow(x,y) sqrt`
  - logic: `if(cond,a,b) ifs(c1,v1,c2,v2,…,else) coalesce(…) isempty(x)`
  - date (ISO strings or anything `Date` parses): `date(x)` → `YYYY-MM-DD`, `year month day weekday(1–7, Mon=1) week(ISO) quarter hour`, `datediff(a,b,"day"|"month"|"year")`, `dateadd(x,n,"day"|"month"|"year")`, `today()`
- Errors: a parse error names the position and what was expected
  (`Formula: expected ")" after round(score, 1`); an unknown column lists the columns; an
  unknown function lists close names. `runTable` wraps them with the op label.
- Numbers print without trailing `.0`; `round` keeps the given decimals.

Tests `tests/formula.test.ts`: precedence, every function, date functions with fixed dates,
`today()` with a fake clock (inject `now`), errors, and the old forms.

## Part B — New column (structured)

DataPipe ops `formula` ("Formula column") and `newcol`:
- UI for `formula`: Name input + formula editor (mono `UiTextInput`, one line, grows to 3 lines)
  + a **column chip row** (click a header → inserts `[name]` or `name` at the cursor) + a
  **function menu** (`UiSelect` "Insert function…" grouped Text / Number / Logic / Date; inserts
  `name(` with a one-line hint) + a **live preview**: the first 3 input rows → computed value,
  or the error text in danger colour (evaluated on change, debounced 200 ms, no run needed).
- New derive ops in `TABLE_OPS` (group "New column"), each with structured params only:
  - `datepart` "Date part": column, part (`year month day weekday week quarter hour date`), name.
  - `bin` "Bucket numbers": column, size (number) or edges (text `0,10,50,100`), name → label `10–50`.
  - `case` "Map values": column, mapping rows (`from → to`, add/remove rows, stored as
    `pattern` = JSON array of pairs), default value, name.
  - `rank` "Rank": column, order asc/desc, name.
  - `cumsum` "Running total": column, name (optional group column → resets per group).
  - `pct` "Percent of total": column, name (optional group column).

## Part C — Group and summarise (structured)

`groupby` UI: "Group by" = `UiMultiSelect` of headers (stored in `column` as comma list; old
single value still works). "Summaries" = a list of rows `[column ▾] [function ▾] [as name] [×]`
with "+ Add summary". Functions: `count count_distinct sum avg min max median first last list`.
Stored in `columns` in the existing text form `col:fn` (add optional `:alias` → `col:fn:alias`)
so old canvases keep working; parser accepts both. Output column default name `fn_col`.
Add `count_distinct`, `median`, `first`, `last` to `aggregateTable`. Multi-column group keys.

## Part D — Pivot (structured)

`pivot` UI with four clear pickers: **Rows** (column, multi), **Columns** (column),
**Values** (column), **Summary** (sum avg min max count count_distinct), plus
"Fill empty with" (text, default empty) and "Add totals" (checkbox: total row + total column).
Keep the stored fields (`column` = rows, `columns` = header column, `name` = value column,
`as` = function, `with` = fill value) and add an optional node field `totals?: boolean`. Also add **Unpivot**
op `unpivot` "Columns to rows": id columns (multi), value columns (multi), names for the new
key / value columns.

## Part E — Profile card (new node `profile`)

Group `data`, title "Profile", input `data` (text table), output `output` (the profile as CSV),
`showsOutput = true`, width 480.
- For each column: name, detected type (number / integer / date / boolean / text), filled %,
  empty count, distinct count, min / max (numbers and dates), mean (numbers), top 3 values with
  counts, and a 12-bucket mini histogram (numbers) drawn as inline SVG bars with tldraw colours.
- Header line: `N rows × M columns`, file size of the input text.
- Click a column row → expands to the top 10 values.
- Pure stats in `shared/profile.ts` (`profileTable(table): ColumnProfile[]`) with tests.

## Part F — DataPipe quality of life

- "Add next step" opens a small op menu (same grouped list) instead of always `select`.
- Preview shows column type badges in the header (from `shared/profile.ts` type detection).
- `TABLE_OPS` descriptions updated; `shared/nodeSpecs.ts` and `shared/nodeDescriptions.ts`
  updated for new ops / the profile card (AI must know them).

## Tests

`formula.test.ts`, `profile.test.ts`, new op cases in `tableOps.test.ts` (datepart, bin, case,
rank, cumsum, pct, multi-key group with aliases, count_distinct/median, pivot fill + totals,
unpivot). Old tests keep passing.

## Planner check

Sales sample → Profile shows types and histograms → New column `round(amount * 1.2, 1)` with
live preview → Date part month → Group by region + month with sum and count → Pivot rows region,
columns month, values amount, totals → Chart.
