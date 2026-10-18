/**
 * WP35 Part A: pure logic for the "JSON fields" card. Input `json` (plain JSON, or JSON inside
 * a ```json fence) → one output per line of the `paths` field (`value`, `topic`,
 * `data[0].name`, `customer.country`, …) + `rest`. No tldraw import; tested in Node.
 */
import { jsonPath } from './textTools'

export interface JsonFieldPath {
	/** The path exactly as typed — also the port's label. */
	path: string
	/** `path:<slug>`, deduped with `_2`/`_3`… when two paths slug the same. */
	portId: string
}

/** A path turned into a stable port-id slug — the same rule `shared/decisionRoute.ts` uses for
 * option ports, kept local so this file has no dependency on that one. */
export function slugPath(path: string): string {
	const s = path
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
	return s || 'path'
}

/** The `paths` field: one path per line, blank lines dropped. */
export function parsePaths(text: string | null | undefined): JsonFieldPath[] {
	const lines = (text ?? '')
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
	const seen = new Set<string>()
	return lines.map((path) => {
		const base = slugPath(path)
		let id = `path:${base}`
		let n = 2
		while (seen.has(id)) id = `path:${base}_${n++}`
		seen.add(id)
		return { path, portId: id }
	})
}

/** Pulls the JSON out of `input`: the text itself when it already looks like JSON, otherwise
 * the first ```json fenced block (LLM/Agent prose often wraps its JSON this way). */
export function extractJsonText(input: string): string {
	const trimmed = input.trim()
	if (!trimmed) return trimmed
	if (trimmed[0] === '{' || trimmed[0] === '[') return trimmed
	const m = /```json\s*\n([\s\S]*?)```/i.exec(input)
	return m ? m[1].trim() : trimmed
}

function toOutputText(value: unknown): string {
	if (value === undefined || value === null) return ''
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

/** The first path segment ("customer" of "customer.country", "data" of "data[0].name") — used
 * to compute `rest`: the object minus whichever top-level keys were explicitly pulled out. */
function topSegment(path: string): string | null {
	return /^[^.[]+/.exec(path)?.[0] ?? null
}

export interface JsonFieldsResult {
	/** portId -> extracted text (objects/arrays as JSON text, scalars as their own string). */
	values: Record<string, string>
	/** The input object/array with every path's top-level key removed (JSON text); the input
	 * unchanged when it isn't a plain object (an array or a scalar can't drop "a key"). */
	rest: string
	/** One line per path that resolved to nothing, e.g. `"customer.country" not found`. */
	warnings: string[]
}

/** Parses `input` as JSON (optionally inside a ```json fence) and reads every `paths` line out
 * of it. Throws a clear error when there's no JSON to read at all; a path that doesn't resolve
 * is not an error — it's an empty value plus a warning, like Decision switch's "other". */
export function runJsonFields(input: string, pathsText: string | null | undefined): JsonFieldsResult {
	const jsonText = extractJsonText(input)
	if (!jsonText) throw new Error('No JSON to read')
	let data: unknown
	try {
		data = JSON.parse(jsonText)
	} catch {
		throw new Error('Input is not valid JSON')
	}

	const paths = parsePaths(pathsText)
	const values: Record<string, string> = {}
	const warnings: string[] = []
	const topKeysUsed = new Set<string>()
	for (const { path, portId } of paths) {
		const value = jsonPath(data, path)
		if (value === undefined) {
			values[portId] = ''
			warnings.push(`"${path}" not found`)
		} else {
			values[portId] = toOutputText(value)
		}
		const top = topSegment(path)
		if (top) topKeysUsed.add(top)
	}

	let rest: unknown = data
	if (data && typeof data === 'object' && !Array.isArray(data)) {
		rest = Object.fromEntries(Object.entries(data as Record<string, unknown>).filter(([k]) => !topKeysUsed.has(k)))
	}
	return { values, rest: JSON.stringify(rest), warnings }
}
