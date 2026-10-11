/**
 * The Database card's four sources (WP13): one embedded SQLite file (sql.js), one
 * built-in in-browser Postgres (PGlite), and two external databases reached through the
 * server (`server/db.ts`) with full SQL. Shared between the card's own source picker
 * (`client/pipeline/nodes/types/DatabaseNode.tsx`) and the search index
 * (`shared/cardSearch.ts`'s "Database · <source>" deep entries), so the two never drift.
 */

export type DbSourceId = 'sqlite' | 'pglite' | 'postgres' | 'duckdb'

export interface DbSourceInfo {
	id: DbSourceId
	label: string
	description: string
	keywords: string[]
}

export const DB_SOURCES: DbSourceInfo[] = [
	{
		id: 'sqlite',
		label: 'SQLite file',
		description: 'Upload a .sqlite/.db file and run SQL against it in the browser (sql.js).',
		keywords: ['sql.js', 'file', 'upload', 'embedded'],
	},
	{
		id: 'pglite',
		label: 'Built-in Postgres',
		description: 'A Postgres database saved in this browser — no server, no setup.',
		keywords: ['pglite', 'embedded', 'local'],
	},
	{
		id: 'postgres',
		label: 'Postgres',
		description: 'Connect to an external Postgres server: read, write, DDL, transactions.',
		keywords: ['postgresql', 'external', 'server'],
	},
	{
		id: 'duckdb',
		label: 'DuckDB',
		description: 'Open a .duckdb file (or an in-memory database) and query it, or read a local CSV/Parquet file directly in SQL.',
		keywords: ['parquet', 'csv', 'analytics', 'olap'],
	},
]
