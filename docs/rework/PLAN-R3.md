# Round 3 plan — the local data core (2026-10-11)

Owner direction: keep the app neat, for expert local use only. The core is
**import data → work on columns → show it as a chart**. No headless runner, no
GitHub/CI cards, no extra embedded database engines.

| Owner decision | Effect on the plan |
|---|---|
| No headless run outside tldraw | dropped |
| Embedded engines: only PGlite and SQLite (WASM) | keep what exists; nothing new embedded |
| Connect to external Postgres and DuckDB with full SQL (CRUD, DDL, transactions) | WP13 |
| No GitHub/CI cards | dropped |
| Core = import, column work (pivot, group, new column), charts | WP11, WP12 |

```
Read from / Database ──► DataPipe steps ──► Chart
 (CSV, TSV, XLS(X),       (columns, rows,     (bar, line, area,
  SQLite, PGlite,          group, pivot,       scatter, pie, stacked,
  Postgres, DuckDB)        new column)         histogram)
          └── Profile card: what is in this table? ──┘
```

## Work packages

| WP | Scope | Size |
|---|---|---|
| WP11 | Column work: a real formula language, structured editors for New column / Group / Pivot, date and number derive ops, Profile card | L |
| WP12 | Chart card: more chart kinds, series from a column, built-in aggregate, sort / top N, titles and labels, place as image | M |
| WP13 | Database card: external Postgres and DuckDB with full SQL (CRUD, DDL, transactions, load rows), next to SQLite file and built-in PGlite | M |
| WP14 | Run behaviour: Run pulls stale upstream cards, input-hash cache, default-model health check | S |
| WP15 | Fine-tuning seen in testing: results inside cards, one error place, shorter LLM cards, group box wording/placement, lighter DataPipe files, chrome, hot-reload cycle | M |

Order: WP14 → WP15 (both fix daily friction) → WP11 → WP12 → WP13.
RULES.md applies unchanged. Every WP is checked in the browser by the planner.

## Out of scope (decided)

Headless runner / CLI / schedule, GitHub and CI cards, MCP export, RAG cards,
new embedded engines (DuckDB-wasm etc.), cloud sinks.
