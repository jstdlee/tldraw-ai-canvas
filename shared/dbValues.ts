/**
 * Turning a driver's raw row values into JSON-safe ones for `/api/db/query` /
 * `/api/db/schema`: dates/timestamps -> ISO strings, bigint -> string, bytes -> a
 * `<N bytes>` label, JSON columns -> text. Pure, so it is testable without a real
 * driver. `server/db.ts` calls these per row.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
}

/** Postgres rows: `pg` already returns native JS Date/Buffer/bigint-as-string/JS-object values. */
export function convertPostgresValue(value: unknown): unknown {
	if (value === null || value === undefined) return null
	if (typeof value === 'bigint') return value.toString()
	if (value instanceof Date) return value.toISOString()
	if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return `<${value.length} bytes>`
	if (value instanceof Uint8Array) return `<${value.length} bytes>`
	if (Array.isArray(value)) return value.map(convertPostgresValue)
	if (isPlainObject(value)) {
		try {
			return JSON.stringify(value)
		} catch {
			return String(value)
		}
	}
	return value
}

/**
 * DuckDB rows: date/timestamp/blob come back as the library's own value classes
 * (`DuckDBDateValue`, `DuckDBTimestampValue`, `DuckDBBlobValue`, ...), identified here by
 * the column's DuckDB type name rather than `instanceof` (keeps this module driver-free).
 */
export function convertDuckDbValue(value: unknown, columnType: string): unknown {
	if (value === null || value === undefined) return null
	if (typeof value === 'bigint') return value.toString()
	const type = columnType.toUpperCase()
	if (type.startsWith('TIMESTAMP')) return String(value).replace(' ', 'T')
	if (type === 'DATE') return String(value)
	if (type === 'BLOB') {
		const bytes = (value as { bytes?: Uint8Array })?.bytes
		return `<${bytes ? bytes.length : 0} bytes>`
	}
	if (type === 'BOOLEAN' || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
		return value
	}
	// Struct/list/map/enum and anything else: a readable string, never the raw JS object.
	return String(value)
}
