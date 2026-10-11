# WP13 — Database card: connect to Postgres and DuckDB

Read `RULES.md` first. Owner rule: embedded engines stay **PGlite and SQLite (WASM)** only.
External engines are reached through the **server** (Node drivers), connect-and-query only.

Today: `database` card (`client/pipeline/nodes/types/DatabaseNode.tsx`) opens a SQLite file with
sql.js; the separate `postgres` card runs SQL on the in-browser PGlite (`client/pipeline/pg.ts`).
Secret store from WP10: `POST /api/secrets` → `secret:<id>`, `resolveSecret`, `UiSecretInput`.

Approved dependencies (server only): `pg` and `@duckdb/node-api`.

## Part A — Server

`server/db.ts` + routes (JSON, localhost only like the rest):

- `POST /api/db/test { conn }` → `{ ok, version }` or error.
- `POST /api/db/schema { conn }` → `{ tables: [{ schema, name, columns: [{name, type}], rows? }] }`
  (row counts only when cheap: Postgres `reltuples` estimate; DuckDB `estimated_size`).
- `POST /api/db/query { conn, sql, limit? }` → `{ columns, rows, rowCount, truncated, ms }`,
  default limit 10 000 rows, hard limit 200 000; statement timeout 60 s.
- `conn` = `{ kind: 'postgres', url?: string, host?, port?, database?, user?, passwordRef?, ssl?: boolean }`
  or `{ kind: 'duckdb', path: string /* .duckdb file or ':memory:' */, readOnly?: boolean }`.
  A password only travels as a `secret:` ref (`passwordRef`), resolved on the server; a full
  `postgres://` URL with a password is accepted once and immediately split into fields + a stored
  secret (the URL with the password is never stored in the canvas).
- Postgres: `pg` Pool per connection key (host/port/db/user), max 3 clients, idle close 60 s.
- DuckDB: one instance per file path, opened read-only unless `readOnly === false`; DuckDB can
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
│ (DuckDB)   File [/home/me/data/sales.duckdb] [read-only ✓]   [Test connection ✓]
│ Tables  (search)  ▸ public.orders  12,340 rows                ← click → SELECT … LIMIT 100 and run
│ SQL editor (grows)  · Ctrl+Enter run
│ result grid · N rows × M columns · 120 ms · "first 10,000 rows" when truncated
```

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

DuckDB: a local `.duckdb` file and `SELECT * FROM '/path/x.parquet'`; Postgres: a local
Postgres in a container (the planner starts one), test connection, browse tables, query →
DataPipe → Chart. Canvas JSON contains no password.
