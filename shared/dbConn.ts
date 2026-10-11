/**
 * Connection descriptors for the Database card's external sources (Postgres, DuckDB).
 * Pure parsing/validation only — no `pg`/`@duckdb/node-api` import here, so this is
 * testable in Node without either driver. See `server/db.ts` for the drivers themselves.
 */

export interface PostgresConn {
	kind: 'postgres'
	/** A pasted `postgres://` URL. Accepted once: the server splits it into the fields
	 * below (and a stored secret for the password) and never keeps the URL itself. */
	url?: string
	host?: string
	port?: number
	database?: string
	user?: string
	/** `secret:<id>` — never a literal password. */
	passwordRef?: string
	ssl?: boolean
}

export interface DuckDbConn {
	kind: 'duckdb'
	/** Absolute path to a `.duckdb` file, or the literal `:memory:`. */
	path: string
	readOnly?: boolean
}

export type DbConn = PostgresConn | DuckDbConn

export interface SplitPostgresUrl {
	host?: string
	port?: number
	database?: string
	user?: string
	password?: string
	ssl?: boolean
}

/** Parse a `postgres://user:pass@host:port/db?sslmode=require` URL into its fields. */
export function splitPostgresUrl(url: string): SplitPostgresUrl {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		throw new Error('Not a valid postgres:// URL')
	}
	if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
		throw new Error('URL must start with postgres:// or postgresql://')
	}
	const sslMode = parsed.searchParams.get('sslmode')
	return {
		host: parsed.hostname || undefined,
		port: parsed.port ? Number(parsed.port) : undefined,
		database: parsed.pathname.replace(/^\//, '') || undefined,
		user: parsed.username ? decodeURIComponent(parsed.username) : undefined,
		password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
		ssl: sslMode ? sslMode !== 'disable' : undefined,
	}
}

/**
 * Replace a Postgres conn's `url` (if any) with split fields, calling `storeSecret` for a
 * password found in the URL. Returns the same conn unchanged when there is no `url` to
 * split. The URL (and any password in it) is never kept.
 */
export function normalizePostgresConn(conn: PostgresConn, storeSecret: (value: string) => string): PostgresConn {
	if (!conn.url) return conn
	const split = splitPostgresUrl(conn.url)
	return {
		kind: 'postgres',
		host: split.host ?? conn.host,
		port: split.port ?? conn.port,
		database: split.database ?? conn.database,
		user: split.user ?? conn.user,
		passwordRef: split.password ? `secret:${storeSecret(split.password)}` : conn.passwordRef,
		ssl: split.ssl ?? conn.ssl,
	}
}

/** A Postgres pool key: one pool per distinct host/port/database/user (password changes
 * do not create a new pool — see WP13's "max 3 clients" pooling note). */
export function postgresPoolKey(conn: PostgresConn): string {
	return JSON.stringify({
		host: conn.host ?? 'localhost',
		port: conn.port ?? 5432,
		database: conn.database ?? '',
		user: conn.user ?? '',
	})
}

/**
 * A DuckDB file path must be absolute and inside the user's home directory or `/tmp`
 * (or be the literal `:memory:`, which never touches the filesystem).
 */
export function validateDuckDbPath(path: string, homeDir: string, tmpDir = '/tmp'): void {
	if (path === ':memory:') return
	if (!path.startsWith('/')) throw new Error('The DuckDB file path must be absolute')
	const normalizedHome = homeDir.endsWith('/') ? homeDir : `${homeDir}/`
	const normalizedTmp = tmpDir.endsWith('/') ? tmpDir : `${tmpDir}/`
	const inHome = path === homeDir || path.startsWith(normalizedHome)
	const inTmp = path === tmpDir || path.startsWith(normalizedTmp)
	if (!inHome && !inTmp) throw new Error('The DuckDB file path must be inside your home directory or /tmp')
}
