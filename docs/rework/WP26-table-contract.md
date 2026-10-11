# WP26 — One table format between data cards, and a Table view card

Read `RULES.md` first. Owner: "the chart, the profile and the DataPipe — the connection data structure
mismatches; the database query result looks like a table but no card holds and presents it; Profile
errors when I select a format."

## Findings (planner, browser test 2026-10-11)

Database (source: built-in Postgres / PGlite) → output was
`region\tmonth\tamount\n"North"\t"Jan"\t"10.5"\n"South"\t"Feb, late"\t"7"\n"East"\t"Mar"\tnull`:
TSV with **JSON-quoted cells** and NULL as the word `null` (from `client/pipeline/pg.ts`). Other
sources emit CSV. DataPipe happened to parse it, but `null` became a text value, and quotes, tabs or
newlines inside values break the format. Every data card has its own `format` field and parser path.

## The contract (one place: `shared/tableText.ts`)

- **Table text = RFC 4180 CSV** with a header row: comma separator, `"` quoting only when needed,
  `""` for a quote, newlines allowed inside quoted cells, NULL → empty cell, numbers unquoted,
  booleans `true/false`, dates ISO 8601. One writer `toCsv(columns: string[], rows: unknown[][])`.
- One reader `parseTableText(text): Table` that accepts, auto-detected:
  CSV, TSV, semicolon CSV, a JSON array of objects or of arrays (from HTTP / Web search results), a
  JSON object `{ columns, rows }`, and a Markdown table. It never throws on a well-formed one of these;
  on garbage it throws a clear error naming what it saw ("Looks like plain text, not a table").
- Every card that outputs a table writes `toCsv`: DataPipe, Database (all four sources — fix
  `pg.ts`'s TSV/JSON-quoting path and sql.js paths), Profile output, Read from (sheets), Table view.
- Every card that reads a table uses `parseTableText`: DataPipe, Chart, Profile, Database `rows`
  input, Table view, Code? (no). Remove the per-card `format` choice from the UI (keep the stored
  field for old canvases; `auto` everywhere). If Profile's format select is the source of the
  "error when select format", it disappears with this; also find and fix the actual exception.
- Port data type for table outputs/inputs stays `text` (so existing wires stay valid), but label the
  rows "Table" and add `tableHint` in nodeSpecs so the AI knows these ports carry CSV.

## Table view card (new `table_view`, group Output)

Input `data` (table text, any supported form). Body: a full-width grid (sticky header, click a header
to sort asc/desc, a filter box that matches any cell, row count "120 of 3 400 rows"), virtualised or
capped at 2 000 rendered rows, expand icon → full-size viewer, "Copy as CSV". Outputs: `output`
(the visible rows as CSV — so sort/filter can feed the next card) and `json` (array of objects).
`showsOutput = true`. Every input/output a dot; register everywhere (registry, nodeGroups, catalog,
descriptions, nodeSpecs with chips, examples, tests incl. output-dots/wireFieldCoverage/cardSearch).
Also: the Database card's own result grid gets the same sort + filter.

## Tests

Unit: `tests/tableText.test.ts` — round trips with commas, quotes, newlines, tabs, NULL, numbers,
unicode; every accepted input form; garbage error. e2e: Database (PGlite query with a comma, a quote
and a NULL in values) → DataPipe filter, Profile, Chart, Table view all run, values intact, Profile
format menu gone or working, no error.
