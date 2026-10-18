/**
 * WP35 Part B: pure logic for the "Extract from text" card. Finds the first Markdown table,
 * csv/json fenced code block, bare JSON object/array, or bullet list inside LLM/Agent prose —
 * the shape downstream cards (Chart, Table view, For each…) actually need, instead of the raw
 * mixed-prose answer. No tldraw import; tested in Node.
 */
import { parseTableText, toCsv } from './tableText'

export type ExtractFind = 'auto' | 'table' | 'json' | 'fence' | 'list'
export type ExtractKind = 'table' | 'json' | 'fence' | 'list'

export interface ExtractOptions {
	find: ExtractFind
	/** Only used by `find: 'fence'`: restrict to one language (blank = any). */
	lang?: string
	/** Strip `**bold**` markers, a trailing `%` off number-like tokens, and thousands
	 * separators inside number-like tokens. */
	clean?: boolean
}

export interface ExtractOutput {
	/** CSV text, '' unless a table was found. */
	table: string
	/** '' unless JSON (fenced or bare) was found. */
	json: string
	/** The fenced block's own contents, '' unless `find: 'fence'` matched. */
	code: string
	/** One item per line, '' unless a bullet/numbered list was found. */
	list: string
	/** Which of the four this run actually found. */
	kind: ExtractKind
}

/** Strips `**bold**` markers, a trailing `%` off a number-like token, and thousands separators
 * inside a number-like token — e.g. `"**45%**"` -> `"45"`, `"1,234.5"` -> `"1234.5"`. Safe to
 * run over whole JSON text too: a bare JSON *number* can never contain a comma (the JSON
 * grammar forbids it), so this only ever touches digit-groups that are already inside a quoted
 * string value. */
export function cleanNumberText(value: string): string {
	let s = value.replace(/\*\*/g, '')
	s = s.replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, (m) => m.replace(/,/g, ''))
	// No trailing `\b` here: `%` is not a word character, so a boundary assertion right after
	// it never matches (there is no \w/\W transition between `%` and whatever follows, or the
	// end of the string) — the leading `\b` before the digits is enough on its own.
	s = s.replace(/\b(\d+(?:\.\d+)?)%/g, '$1')
	return s.trim()
}

interface Candidate {
	start: number
	kind: ExtractKind
	/** Already-fully-built output text for this candidate (CSV / JSON text / code / list). */
	value: string
}

const TABLE_ROW_RE = /^[ \t]*\|.*\|[ \t]*$/
const TABLE_SEP_RE = /^[ \t]*\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/

function cleanCell(value: string, clean: boolean): string {
	return clean ? cleanNumberText(value) : value
}

/** The first contiguous Markdown table (a `|...|` row followed by a `|---|---|` separator
 * row), as its own start index and CSV text. */
function findMarkdownTable(text: string, clean: boolean): Candidate | null {
	const lines = text.split('\n')
	let offset = 0
	for (let i = 0; i < lines.length - 1; i++) {
		if (TABLE_ROW_RE.test(lines[i]) && TABLE_SEP_RE.test(lines[i + 1])) {
			let j = i + 2
			while (j < lines.length && TABLE_ROW_RE.test(lines[j])) j++
			const block = lines.slice(i, j).join('\n')
			const table = parseTableText(block)
			const value = toCsv(
				table.headers.map((h) => cleanCell(h, clean)),
				table.rows.map((row) => row.map((cell) => cleanCell(cell, clean)))
			)
			return { start: offset, kind: 'table', value }
		}
		offset += lines[i].length + 1
	}
	return null
}

interface FenceMatch {
	start: number
	lang: string
	code: string
}

/** Every ```lang fenced block in the text, in order, with its own start index. */
function allFences(text: string): FenceMatch[] {
	const re = /```[ \t]*(\w+)?[ \t]*\n([\s\S]*?)```/g
	const out: FenceMatch[] = []
	let m: RegExpExecArray | null
	while ((m = re.exec(text))) out.push({ start: m.index, lang: (m[1] ?? '').toLowerCase(), code: m[2].trim() })
	return out
}

/** The first fenced block whose language matches `lang` (case-insensitive; blank = any). */
function findFence(text: string, lang: string | undefined, clean: boolean): Candidate | null {
	const wanted = (lang ?? '').trim().toLowerCase()
	const match = allFences(text).find((f) => !wanted || f.lang === wanted)
	if (!match) return null
	return { start: match.start, kind: 'fence', value: cleanCell(match.code, clean) }
}

/** A `{`/`[` at `start` extended to its matching close bracket, honoring quoted strings
 * (so a `}`/`]` inside a string doesn't end the scan early). Null if unbalanced. */
function extractBalanced(text: string, start: number): string | null {
	const open = text[start]
	const close = open === '{' ? '}' : ']'
	let depth = 0
	let inString = false
	let quote = ''
	for (let i = start; i < text.length; i++) {
		const c = text[i]
		if (inString) {
			if (c === '\\') {
				i++
				continue
			}
			if (c === quote) inString = false
			continue
		}
		if (c === '"' || c === "'") {
			inString = true
			quote = c
			continue
		}
		if (c === open) depth++
		else if (c === close) {
			depth--
			if (depth === 0) return text.slice(start, i + 1)
		}
	}
	return null
}

/** The first bare (unfenced) `{...}`/`[...]` substring that actually parses as JSON — a
 * fenced ```json block is tried first (cheaper, and avoids matching inside other fences'
 * code), then every `{`/`[` in the text left to right. */
function findJsonBlock(text: string, clean: boolean): Candidate | null {
	const fence = findFence(text, 'json', false)
	if (fence) return { start: fence.start, kind: 'json', value: cleanCell(fence.value, clean) }
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== '{' && text[i] !== '[') continue
		const candidate = extractBalanced(text, i)
		if (!candidate) continue
		try {
			JSON.parse(candidate)
			return { start: i, kind: 'json', value: cleanCell(candidate, clean) }
		} catch {
			// Not actually JSON (e.g. a stray `{` in prose) — keep scanning.
		}
	}
	return null
}

const LIST_ITEM_RE = /^[ \t]*(?:[-*•]|\d+[.)])[ \t]+(.+)$/

/** The first contiguous run of bullet/numbered list lines. */
function findBulletList(text: string, clean: boolean): Candidate | null {
	const lines = text.split('\n')
	let offset = 0
	for (let i = 0; i < lines.length; i++) {
		const m = LIST_ITEM_RE.exec(lines[i])
		if (m) {
			const items = [cleanCell(m[1].trim(), clean)]
			let j = i + 1
			while (j < lines.length) {
				const next = LIST_ITEM_RE.exec(lines[j])
				if (!next) break
				items.push(cleanCell(next[1].trim(), clean))
				j++
			}
			return { start: offset, kind: 'list', value: items.join('\n') }
		}
		offset += lines[i].length + 1
	}
	return null
}

const EMPTY: ExtractOutput = { table: '', json: '', code: '', list: '', kind: 'table' }

/** `ExtractKind` and `ExtractOutput`'s field names agree everywhere except `fence`, whose
 * value lives in the `code` field. */
function fieldForKind(kind: ExtractKind): 'table' | 'json' | 'code' | 'list' {
	return kind === 'fence' ? 'code' : kind
}

function toOutput(candidate: Candidate): ExtractOutput {
	return { ...EMPTY, [fieldForKind(candidate.kind)]: candidate.value, kind: candidate.kind }
}

/** Finds the one shape `options.find` asks for (or, in `auto`, whichever of a table / csv-or-
 * json fence / bare JSON / bullet list appears first in the text) and returns it as the
 * matching output, the other three left empty. Throws a clear error when nothing matches. */
export function extractFromText(text: string, options: ExtractOptions): ExtractOutput {
	const clean = !!options.clean
	if (options.find === 'table') {
		const found = findMarkdownTable(text, clean)
		if (!found) throw new Error('No Markdown table found in the text')
		return toOutput(found)
	}
	if (options.find === 'json') {
		const found = findJsonBlock(text, clean)
		if (!found) throw new Error('No JSON object or array found in the text')
		return toOutput(found)
	}
	if (options.find === 'fence') {
		const found = findFence(text, options.lang, clean)
		if (!found) throw new Error(options.lang ? `No \`\`\`${options.lang} fenced block found in the text` : 'No fenced code block found in the text')
		return toOutput(found)
	}
	if (options.find === 'list') {
		const found = findBulletList(text, clean)
		if (!found) throw new Error('No bullet or numbered list found in the text')
		return toOutput(found)
	}

	// auto: whichever of these appears earliest in the text wins. A csv/json fence is the
	// fenced candidate here (any other language isn't "data" to extract); a plain fence
	// otherwise has no auto-detected meaning of its own.
	const candidates = [
		findMarkdownTable(text, clean),
		(() => {
			const csv = allFences(text).find((f) => f.lang === 'csv')
			return csv ? { start: csv.start, kind: 'table' as const, value: toTableFromCsvFence(csv.code, clean) } : null
		})(),
		findJsonBlock(text, clean),
		findBulletList(text, clean),
	].filter((c): c is Candidate => c != null)
	if (!candidates.length) throw new Error('No table, JSON, fenced block, or bullet list found in the text')
	candidates.sort((a, b) => a.start - b.start)
	return toOutput(candidates[0])
}

function toTableFromCsvFence(code: string, clean: boolean): string {
	const table = parseTableText(code)
	return toCsv(
		table.headers.map((h) => cleanCell(h, clean)),
		table.rows.map((row) => row.map((cell) => cleanCell(cell, clean)))
	)
}
