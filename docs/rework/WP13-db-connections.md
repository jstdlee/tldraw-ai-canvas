# WP13 — Database card: Postgres and DuckDB with full SQL

Read `RULES.md` first. Owner rule: embedded engines stay **PGlite and SQLite (WASM)** only.
External engines are reached through the **server** (Node drivers) with full standard SQL:
read, insert, update, delete, and DDL (create / alter / drop), with transactions.

Today: `database` card (`client/pipeline/nodes/types/DatabaseNode.tsx`) opens a SQLite file with
sql.js; the separate `postgres` card runs SQL on the in-browser PGlite (`client/pipeline/pg.ts`).
Secret store from WP10: `POST /api/secrets` → `secret:<id>`, `resolveSecret`, `UiSecretInput`.

Approved dependencies (server only): `pg` and `@duckdb/node-api`.

## Part A — Server

`server/db.ts` + routes (JSON, localhost only like the rest):

- `POST /api/db/test { conn }` → `{ ok, version }` or error.
- `POST /api/db/schema { conn }` → `{ tables: [{ schema, name, columns: [{name, type}], rows? }] }`
  (row counts only when cheap: Postgres `reltuples` estimate; DuckDB `estimated_size`).
- `POST /api/db/query { conn, sql, limit?, params?, transaction?: boolean }` →
  `{ results: [{ columns, rows, rowCount, truncated, command, affected }], ms }` — one entry per
  statement (multi-statement scripts are split safely, respecting quotes, `$$` and comments).
  Reads: default limit 10 000 rows, hard limit 200 000. Writes return `command`
  (`INSERT` / `UPDATE` / `DELETE` / `CREATE` …) and `affected` rows. `transaction: true`
  (default for scripts with any write) wraps all statements in BEGIN / COMMIT and rolls back on
  the first error, reporting which statement failed. Statement timeout 60 s. Parameters
  (`$1` Postgres, `?` DuckDB) come from `params` (array) for safe values.
- `conn` = `{ kind: 'postgres', url?: string, host?, port?, database?, user?, passwordRef?, ssl?: boolean }`
  or `{ kind: 'duckdb', path: string /* .duckdb file or ':memory:' */, readOnly?: boolean }`.
  A password only travels as a `secret:` ref (`passwordRef`), resolved on the server; a full
  `postgres://` URL with a password is accepted once and immediately split into fields + a stored
  secret (the URL with the password is never stored in the canvas).
- Postgres: `pg` Pool per connection key (host/port/db/user), max 3 clients, idle close 60 s.
- DuckDB: one instance per file path, opened read-write by default (`readOnly: true` to protect a
  file); DuckDB can
  read local CSV / Parquet / JSON by path in SQL (`SELECT * FROM 'file.parquet'`), which covers
  big local files without new embedded engines. Paths must be absolute and inside the user's
  home or `/tmp`; reject others.
- Values: dates/timestamps → ISO strings, bigint → string, bytes → `<N bytes>`, JSON → text.
- Errors: driver message + hint (`password authentication failed for user "x" — check the
  password`), never the password.

## Part B — Database card

Add field `source?: 'sqlite' | 'pglite' | 'postgres' | 'duckdb'` (default `sqlite`, old cards
unchanged) and `conn?: string` (JSON of the conn without secrets).

```
┌ Database ─────────────────────────────── ● output ● schema
│ Source [SQLite file][Built-in Postgres][Postgres][DuckDB]
│ (Postgres) Host [localhost] Port [5432] DB [sales] User [me] Password [•••• saved] SSL [ ]
│            or paste a postgres:// URL                        [Test connection ✓ 15.4]
│ (DuckDB)   File [/home/me/data/sales.duckdb] [read-only  ]   [Test connection ✓]
│ Tables  (search)  ▸ public.orders  12,340 rows                ← click → SELECT … LIMIT 100 and run
│ SQL editor (grows)  · Ctrl+Enter run
│ result grid · N rows × M columns · 120 ms · "first 10,000 rows" when truncated
```

- **Writes.** A script with writes shows "N statements · 2 writes" above the editor. Risky
  statements (`DROP`, `TRUNCATE`, `DELETE` / `UPDATE` without `WHERE`) need a confirm step inside
  the card (an inline "Run anyway" button that appears after the first Run; no browser dialogs).
  The result area lists each statement: command, affected rows, ms; the last SELECT shows the grid.
- **Input rows → table.** A wired `rows` input (CSV text from DataPipe) plus a target table name
  and mode (`insert` / `upsert on key` / `replace table`) loads data into the database in one
  transaction (batched multi-row INSERT, 1 000 rows per batch). Column types: create the table
  when missing, using the Profile type detection (WP11) → `text / bigint / double / date /
  boolean`.
- **SQLite file writes.** SQLite source runs writes in memory; a "Save file" button stores the
  changed database back to the file store (new version) and "Download" saves a copy.
- `pglite` source = the built-in in-browser Postgres (reuse `runSql` from `client/pipeline/pg.ts`);
  the old `postgres` card stays as is (not removed) but gets `hidden = true` in the library with
  a "Use Database → Built-in Postgres" note — do NOT remove the type.
- Schema output: `CREATE TABLE`-like text for the AI helpers.
- The card's AI specialist (WP7 spec for `database`) gets the schema in its context already —
  update `shared/nodeSpecs.ts` so it knows the four sources and writes the right SQL dialect.

## Tests

`tests/dbConn.test.ts`: conn parsing (URL split into fields + secret ref), path checks, value
conversion. DuckDB integration test with an in-memory DB (create table, query, schema) — skip
the test if the native module is not available on the platform. Postgres tests: unit only (no
server needed).

## Planner check

DuckDB: a local `.duckdb` file, `SELECT * FROM '/path/x.parquet'`, CREATE / INSERT / UPDATE /
DELETE; Postgres in a local container (the planner starts one): test connection, browse tables,
a write script in one transaction (and a failing one that rolls back), load DataPipe rows into a
new table, query → DataPipe → Chart. Risky statements ask inside the card. Canvas JSON contains no
password.
