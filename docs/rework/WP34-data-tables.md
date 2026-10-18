# WP34 — Data and tables: correct, honest, complete

Read `RULES.md` and `docs/review/2026-10-18/data.md` + `gaps.md` for each ID (causes with file:line there).

## Must fix
- **GAPS-01** A wired but empty / failed table input silently falls back to the card's built-in sample table
  (Chart, DataPipe, Table view, Profile). Wired + empty or upstream failed → stop with "No table from <card>";
  new cards start with an empty table field and a placeholder (keep old saved text as is).
- **DATA-01** Chart in-card preview never renders when the card mounts before data exists (echarts init effect
  with empty deps bails out). Init when the container appears.
- **DATA-03** Built-in Postgres (PGlite) results show plain CSV instead of the sortable/filterable grid.
- **DATA-04 / GAPS-10 (H)** A one-column table (free text, a list from For each, a JSON array of scalars) is
  rejected as "not a table". Accept: one-column CSV, a JSON array of scalars → column `value`, `{data:[…]}`
  / `{items:[…]}` wrappers. Keep a clear error for real garbage.
- **GAPS-07 (H)** Nested JSON objects become `[object Object]`: flatten to dotted columns
  (`customer.country`), arrays of scalars joined with `; `, deeper arrays as JSON text.
- **DATA-05** Table view sort treats `1,234` as text — share one number parser (`toNumber`) everywhere.
- **DATA-06** Rows blank in every column are dropped silently — keep them as empty rows (or report "N blank rows
  removed" visibly; prefer keep).
- **DATA-07** DataPipe "Table" input has no port dot until wired. **DATA-08** switching Operation leaves a stale
  invalid value in a shared field — reset/validate per op. **DATA-09 / UI-14** "no port anchor" console warnings
  for table/profile/table_view (fieldVisibility).
- **GAPS-12 / DB** Built-in Postgres and SQLite load wired `rows` like external sources (targetTable, loadMode).
- **UI-05** Database Source tabs overflow the card's right edge.
- **P8 extras** Formula functions `domain(url)`, `path(url)`; group-by count column named `count` (not
  `count_*`) when there is one count; Chart with a missing Y column = error, not "ok" with an empty selector.

## Tests
Unit in tests/tableText.test.ts / tableOps.test.ts for every parser/op change; e2e: empty wired input error,
chart preview after wiring, PGlite grid, one-column list → Table view, nested JSON → DataPipe group by
`customer.country`, sort with thousands separators, Database tab layout.
