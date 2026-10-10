# WP5 — Data: DataPipe, Database widget, remove SQLite import

Feedback items: #5 (remove SQLite import), #6 (database widget that opens a SQLite file),
#7 (table UI is confusing), #12 (rename Table to DataPipe; CSV/TSV/XLS/XLSX; one operation per
pipe with only its own parameters; pipes chain). Read `RULES.md` first. WP1–WP4 are done: use the
kit in `client/ui/` (`UiSelect` with groups, `UiField`, `UiTextInput`, `UiTable`, `UiEmpty`,
`UiButton`, icons) and `client/pipeline/placeNode.ts`.

Approved new dependency: **SheetJS** (`xlsx`). Install from the official tarball (the npm
registry copy is old):

```bash
npm i -D https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

Import it only in client code, lazily: `const XLSX = await import('xlsx')`.

## Part 0 — Generic file store (server)

Today only images can be stored (`POST /api/images/:id`, `server/index.ts` ~L342, mime must be
`image/*`). Add, next to it, using the same storage helpers pattern (see `readImage`/`saveImage`):

- `POST /api/files/:fileId` — raw bytes, any content type, max **50 MB** (return 413 above),
  `fileId` must match `/^[A-Za-z0-9_-]{1,80}$/`. Save bytes + mime + original name (header
  `X-File-Name`, URI-encoded) in the data folder (new subfolder `files/`).
- `GET /api/files/:fileId` — bytes with stored mime, `Content-Disposition: inline; filename=…`.
- In the origin/content-type middleware (~L59–64) treat `/api/files/` like `/api/images/` (raw body).
- Client helper `client/pipeline/fileStore.ts`: `storeFile(file: File): Promise<{ url: string; name: string; size: number }>`
  and `loadFileBytes(url): Promise<Uint8Array>` (with an in-memory cache by URL).

## Part A — DataPipe (rename + rebuild of the `table` node)

Keep the type id `table` and every existing field (saved canvases). Change user-facing names:
`title = 'DataPipe'`, `heading = 'DataPipe'`, icon `IconTable` (kit). Update the label in
`shared/nodeGroups.ts`/catalog descriptions/examples text where it says "Table".

### A1. Operation registry (`shared/tableOps.ts`)

Add a declarative registry. The UI and the AI (WP7) both read it.

```ts
export type ParamKind = 'column' | 'columns' | 'text' | 'number' | 'enum' | 'formula' | 'regex'
export interface OpParam {
  field: 'columns' | 'column' | 'as' | 'expr' | 'sep' | 'pattern' | 'with' | 'name'
  label: string
  kind: ParamKind
  options?: { value: string; label: string }[]   // for enum
  placeholder?: string
  hint?: string
  required?: boolean
}
export interface OpSpec {
  id: string
  label: string                 // menu text
  group: 'Columns' | 'Rows' | 'Values' | 'New column' | 'Combine' | 'Summarise'
  description: string           // one sentence shown under the picker
  params: OpParam[]
  second?: { label: string; hint: string }   // uses the second input port (id `extra`)
  hidden?: boolean              // kept for old canvases, not offered in the menu
}
export const TABLE_OPS: OpSpec[]
export function opSpec(id: string): OpSpec | undefined
```

Operations (id → behaviour; existing ids keep their current behaviour):

| id | label | group | params (field: kind) | notes |
|---|---|---|---|---|
| select | Keep columns | Columns | columns: columns (req) | existing |
| drop | Remove columns | Columns | columns: columns (req) | new |
| rename | Rename column | Columns | column: column (req), name: text (req) | new |
| filter | Filter rows | Rows | column: column (req), as: enum `= != > >= < <= contains starts ends empty notempty regex`, with: text | new; numeric compare when both sides are numbers |
| regexp | Keep rows matching pattern | Rows | column: column, pattern: regex | existing |
| sort | Sort | Rows | columns: columns (req), as: enum `asc desc` | existing (`as` desc) |
| dedupe | Remove duplicate rows | Rows | columns: columns (empty = all) | existing |
| head | First N rows | Rows | with: number (req) | new; negative = last N |
| replicate | Repeat rows | Rows | with: number (req, times), as: enum `each table` | new: `each` = every row N times in place; `table` = whole table N times |
| convert | Convert values | Values | column: column, as: enum `number date upper lower trim` | existing |
| replace | Find and replace | Values | column: column, pattern: regex, with: text | existing |
| fill | Fill empty cells | Values | columns: columns, as: enum `value down up`, with: text | new: fixed value, or copy from the cell above/below |
| split | Split column | Values | column: column, sep: text (req), name: text (new column prefix) | new: `name_1, name_2…` |
| formula | Formula column | New column | name: text (req), expr: formula | existing |
| concat | Combine columns | New column | columns: columns, sep: text, name: text | existing (`join` is an old alias → `hidden: true`, same behaviour) |
| newcol | Column from lines | New column | name: text, expr: formula | existing; `second` = "Values, one per line" |
| append | Append rows of second table | Combine | — | new; `second` = "Second table"; columns matched by name, missing → empty |
| lookup | Join tables by key | Combine | column: column (left key), with: text (right key, empty = same), as: enum `inner left` | new; `second` = "Second table"; right columns added, name clashes get `_2` |
| groupby | Group and summarise | Summarise | column: column (group key), columns: text ("score:sum, *:count") | existing |
| pivot | Pivot | Summarise | column: column (row key), columns: column (header column), name: column (value column), as: enum `sum avg min max count` | existing; value column now from `name` first, then `extra` (old) |

Behaviour changes in `runTable(text, job, second?)`:
- New third argument `second?: string` (the `extra` input). `newcol` keeps using `job.extra`
  when `second` is not given (tests call it that way).
- **Format auto-detect:** `format` may be `'auto'` (new default): TSV if the first line contains a
  tab, else CSV. Output uses the detected input format. Old values `csv`/`tsv` still force it.
- Every error message names the operation and what to fix (e.g. `Filter rows: choose a column`;
  `Rename column: column "nme" not found. Columns: name, city, score`).

Tests in `tests/tableOps.test.ts` (new file; keep existing tests passing): each new op, auto
format, join inner/left, append with different columns, replicate each/table, fill down,
error text for an unknown column.

### A2. Excel and file input (`client/pipeline/excel.ts`)

- `readSpreadsheet(bytes: Uint8Array, name: string): Promise<{ sheets: string[]; toCsv(sheet: string): string }>`
  using SheetJS (`XLSX.read(bytes, { type: 'array' })`, `XLSX.utils.sheet_to_csv(ws, { blankrows: false })`).
  Handles `.xlsx`, `.xls`, `.ods`, `.csv`, `.tsv`.
- For `.csv`/`.tsv`/`.txt` do not use SheetJS; decode as UTF-8 text.

### A3. DataPipe node fields (all optional, new)

```ts
source: T.string.optional(),     // 'inline' | 'file' | 'input' (default: 'input' if wired else 'inline')
fileUrl: T.string.optional(),    // /api/files/... of the uploaded file
fileName: T.string.optional(),
sheet: T.string.optional(),      // chosen sheet for xls/xlsx
sheets: T.arrayOf(T.string).optional(),
lastOutput: T.string.nullable().optional(),  // result text (first 200 KB) for the preview grid
lastInfo: T.string.optional(),   // "120 rows × 5 columns"
```

Add `lastOutput`, `lastInfo` to `resultKeys`.

### A4. DataPipe execute

Input text: wired `data` input if connected; else file (load bytes, convert the chosen sheet,
or decode text); else inline `text`. Second table: `extra` input. Run `runTable`. Store
`lastOutput`/`lastInfo`. Throw on error (WP1 banner shows it). Output port `output` = result text.

### A5. DataPipe UI

```
┌ DataPipe ─────────────────────────────── ● output
│ ● in   from "Load CSV"  (or)  [Inline ▾] [Upload file]   sales.xlsx · [Sheet1 ▾]
│ Operation  [ Filter rows                         ▾ ]     ← UiSelect grouped by `group`
│            Keep rows where a column matches a condition. ← description, text-3
│ Column     [ city ▾ ]                                    ← only this op's params
│ Condition  [ = ▾ ]     Value [ Paris        ]
│ ● Second table   from "Prices"                           ← only when op has `second`
│ ┌──────── preview (UiTable, first 50 rows) ───────────┐
│ │ name │ city │ score                                 │
│ └──────────────────────────────────────────────────────┘
│ 12 rows × 3 columns
```

- Port `data` row: show `PortRow` when wired. When not wired, show a `UiSegmented` with
  **Inline** / **File**. Inline: a mono `UiTextArea` (4 rows, scrolls). File: `UiButton`
  "Upload CSV, TSV, XLS, XLSX" (hidden `<input type=file accept=".csv,.tsv,.txt,.xls,.xlsx,.ods">`),
  then file name + size + sheet `UiSelect` (only when more than one sheet) + replace button.
- Params render from `opSpec(op).params`. `column` kind = `UiSelect` with the **input
  headers** (parse the current input/inline/file text; if unknown, fall back to `UiTextInput`).
  `columns` kind = `UiMultiSelect` of headers (order kept as clicked). `enum` = `UiSelect`.
  `formula` = mono input with hint "e.g. upper(name), score * 2". `regex` = mono input.
- Second input row (`extra` port) only when `opSpec(op).second` exists; its label from the spec.
  Port position must follow the row (ports are computed in `getPorts(shape, node)`; put `extra`
  at the row index where it is rendered, and when hidden put it at the `data` row y so wires do
  not dangle — or keep it at a fixed last row. Choose one and keep `getBodyHeightPx` in sync).
- Preview: `UiTable` of `lastOutput` (first 50 rows), "rows × columns" line. Before the first
  run: `UiEmpty` "Press Run to see the result".
- Body height follows the number of visible rows (inputs + params + second) + preview 200 px.
- Width 440 (WP3 contract).

### A6. Chaining

Nothing special is needed (one output can feed many inputs). Add a small `UiIconButton`
(`IconPlus`, title "Add next step") in the DataPipe footer area or body bottom that creates a new
DataPipe to the right (`createNodeAt` with `rightOf`) wired `output → data`, with op `select`.

## Part B — Database widget (new node type `database`)

File `client/pipeline/nodes/types/DatabaseNode.tsx`, registered in `nodeTypes.tsx`, group `data`
in `shared/nodeGroups.ts`, catalogue entry in `shared/nodeCatalog.ts`
(`database: { in: ['sql'], out: ['output', 'schema'], fields: ['sql'] }`).

Fields: `fileUrl: string`, `fileName: string`, `fileSize: number`, `sql: string`,
`tables: string` (JSON list `{name, columns: string[], rows: number}[]` from the last open),
`lastOutput: string | null`, `lastInfo: string`, `error: string | null`.

- **Open:** "Upload .sqlite / .db" button → `storeFile` → open with sql.js (reuse
  `loadSqlJs` from `client/pipeline/sqliteWasm.ts`; move it to `client/pipeline/sqlJs.ts`) →
  fill `tables`. Keep one open `Database` per `fileUrl` in a module cache.
- **Tables panel:** list of tables (`IconTable`, name, row count). Click a table → set `sql` to
  `SELECT * FROM "<name>" LIMIT 100` and run. Columns shown on hover (`title`).
- **SQL editor:** mono `UiTextArea` (5 rows). Wired `sql` input overrides it (show `PortRow`).
  Placeholder text "SELECT * FROM …". Ctrl/Cmd+Enter runs the node.
- **Run:** `db.exec(sql)`; last result set → CSV (header + rows, CSV-escaped). Statements that
  change data run in memory only; show hint "Changes stay in memory; the file is not modified."
- **Outputs:** `output` = CSV of the result (feeds DataPipe and Chart), `schema` = text of all
  `CREATE TABLE` statements (for AI/SQL helpers).
- **Result:** `UiTable` preview + "N rows × M columns". Errors thrown (banner).
- Width 480, sensible body height (tables list max 6 rows visible, scrolls).

## Part C — Remove SQLite import (`sqlite_in`)

- Move `sqlite_in` to `RemovedNodeDefinitions` with `removedNodeDefinition('sqlite_in', 'SQLite import')`.
- Delete the `SqliteNode*` code from `DataNodes.tsx`, `readSqliteFile`/`sqliteFileToPgStatements`
  if unused afterwards, `shared/sqliteToPg.ts` and `tests/sqliteToPg.test.ts`.
- Remove `sqlite_in` from `shared/nodeCatalog.ts`, `shared/nodeGroups.ts`, the port map in
  `tests/improvements.test.ts` (add `database` there instead), and examples in
  `shared/examples.ts` (~L233 and ~L321): replace the example step with a **Database** example
  (no file: explain "Upload a .sqlite file, click a table") and a **DataPipe** chain example
  (inline CSV → Filter rows → Group and summarise → Chart).
- `grep -rn "sqlite_in\|SqliteNode\|sqliteToPg" client shared server tests` must return nothing
  except the removed-node stub.

## Done when

- typecheck + tests pass; new tests for ops and auto format.
- Planner check: DataPipe shows only the chosen op's fields; column pickers list real headers;
  XLSX upload with 2 sheets works; chain Filter → Group → Chart works; Database opens a sample
  `.sqlite` (the planner will create one with `sqlite3`), lists tables, runs a query, feeds a
  DataPipe; old canvases with `sqlite_in` load as a removed-node stub.
