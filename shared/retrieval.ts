/**
 * WP50: retrieval for the Document Q&A card. Pure TS (no tldraw, no network), tested in
 * tests/retrieval.test.ts.
 *
 * - `parseDocumentsInput` turns the card's `documents` input (plain text, a table of texts, or
 *   one file path / URL per line from Read from / HTTP) into a list of documents.
 * - `chunkText` cuts a document into overlapping character windows, preferring to cut at a
 *   paragraph, sentence or word end.
 * - `bm25Rank` ranks chunks by keyword match (used when no embed model is set up).
 * - `cosineTopK` ranks chunk vectors against a question vector (with an embed model).
 * - `buildDocQaPrompt` numbers the chosen chunks [1], [2]… and asks for cited answers.
 */
import { parseTableText } from './tableText'

export interface DocInput {
	name: string
	/** The document text, when the input already holds it. */
	text?: string
	/** A file path (`/api/files/…`) or web URL to read first. */
	ref?: string
}

export interface Chunk {
	/** Index of the document in the documents list. */
	doc: number
	/** Chunk number inside its document, from 0. */
	index: number
	text: string
}

export interface RankedChunk extends Chunk {
	score: number
}

export const DEFAULT_CHUNK_SIZE = 800
export const DEFAULT_CHUNK_OVERLAP = 100
export const DEFAULT_TOP_K = 5

/** What the answer says when the documents do not hold the answer (also in the prompt). */
export const NOT_IN_DOCUMENTS = 'The documents do not contain the answer to this question.'

const REF_LINE = /^(\/api\/files\/[A-Za-z0-9_-]+|https?:\/\/\S+)$/

/** The first line of a Read from binary-file output ("/api/files/x\n(binary file …)"). */
function refOf(line: string): string | null {
	const trimmed = line.trim()
	return REF_LINE.test(trimmed) ? trimmed : null
}

const TEXT_COLUMNS = ['text', 'content', 'body', 'document', 'chunk', 'page', 'passage', 'description']
const NAME_COLUMNS = ['name', 'title', 'file', 'filename', 'source', 'document name', 'url', 'path', 'id']

function nameFromRef(ref: string, i: number): string {
	if (ref.startsWith('/api/files/')) return `File ${i + 1}`
	try {
		const url = new URL(ref)
		const last = url.pathname.split('/').filter(Boolean).pop()
		return last ? `${url.hostname}/${last}` : url.hostname
	} catch {
		return ref
	}
}

/**
 * Read the documents input. Order of checks:
 * 1. Every non-empty line is a file path or URL (a Read from binary output's note line is
 *    skipped): one document per reference, read later.
 * 2. A table with two or more columns: the text column is the first named like text/content/
 *    body, else the longest column; the name column is named like name/title/file/source.
 * 3. Anything else: one document, "Document 1".
 */
export function parseDocumentsInput(input: string): DocInput[] {
	const text = (input ?? '').trim()
	if (!text) return []
	const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
	const refs: string[] = []
	let allRefs = lines.length > 0
	for (const line of lines) {
		const ref = refOf(line)
		if (ref) refs.push(ref)
		else if (/^\(binary file/.test(line)) continue
		else {
			allRefs = false
			break
		}
	}
	if (allRefs && refs.length) return refs.map((ref, i) => ({ name: nameFromRef(ref, i), ref }))

	const table = tryTable(text)
	if (table) {
		const lower = table.headers.map((h) => h.trim().toLowerCase())
		let textCol = lower.findIndex((h) => TEXT_COLUMNS.includes(h))
		if (textCol < 0) {
			// The column with the most characters holds the text.
			let best = -1
			table.headers.forEach((_h, c) => {
				const size = table.rows.reduce((sum, row) => sum + (row[c] ?? '').length, 0)
				if (size > best) {
					best = size
					textCol = c
				}
			})
		}
		const nameCol = lower.findIndex((h, c) => c !== textCol && NAME_COLUMNS.includes(h))
		return table.rows
			.map((row, i) => {
				const body = (row[textCol] ?? '').trim()
				const name = nameCol >= 0 && row[nameCol]?.trim() ? row[nameCol].trim() : `Row ${i + 1}`
				const ref = refOf(body)
				return ref ? { name, ref } : { name, text: body }
			})
			.filter((d) => d.ref || d.text)
	}
	return [{ name: 'Document 1', text }]
}

/** A table only when it clearly is one: 2+ columns, 1+ data rows, every row the same width. */
export function tryTable(text: string): { headers: string[]; rows: string[][] } | null {
	try {
		const table = parseTableText(text)
		if (table.headers.length < 2 || table.rows.length < 1) return null
		if (!table.rows.every((r) => r.length === table.headers.length)) return null
		return table
	} catch {
		return null
	}
}

/**
 * Cut text into windows of at most `size` characters; each window starts `size - overlap`
 * characters after the last one, moved back to a paragraph / sentence / word end when one is
 * close, so chunks rarely cut a word in half.
 */
export function chunkText(text: string, size = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP): string[] {
	const clean = (text ?? '').replace(/\r\n/g, '\n').trim()
	if (!clean) return []
	const max = Math.max(50, Math.floor(size) || DEFAULT_CHUNK_SIZE)
	const over = Math.max(0, Math.min(Math.floor(overlap) || 0, Math.floor(max / 2)))
	if (clean.length <= max) return [clean]
	const chunks: string[] = []
	let start = 0
	while (start < clean.length) {
		let end = Math.min(start + max, clean.length)
		if (end < clean.length) {
			// Prefer to end at a paragraph break, else a sentence end, else a word end.
			const cut = lastBreak(clean.slice(start, end), max)
			if (cut > 0) end = start + cut
		}
		const piece = clean.slice(start, end).trim()
		if (piece) chunks.push(piece)
		if (end >= clean.length) break
		let next = end - over
		if (next <= start) next = end
		// Start the next window at a word start.
		while (next > start && next < end && /\S/.test(clean[next - 1]) && /\S/.test(clean[next])) next++
		start = next
	}
	return chunks
}

/** The best cut point in a window: the last paragraph break past 40 % of it, else the last
 * sentence end past 50 %, else the last line or word break past 66 %. */
function lastBreak(window: string, max: number): number {
	const rules: [RegExp, number][] = [
		[/\n\s*\n/g, 0.4],
		[/[.!?。！？]\s/g, 0.5],
		[/\n/g, 0.66],
		[/\s/g, 0.66],
	]
	for (const [re, share] of rules) {
		const floor = Math.floor(max * share)
		let found = -1
		for (const m of window.matchAll(re)) {
			const at = (m.index ?? 0) + m[0].length
			if (at >= floor) found = at
		}
		if (found > 0) return found
	}
	return -1
}

/** Chunk every document; `doc` is the document's index. */
export function chunkDocuments(docs: { text: string }[], size?: number, overlap?: number): Chunk[] {
	const out: Chunk[] = []
	docs.forEach((d, doc) => chunkText(d.text, size, overlap).forEach((text, index) => out.push({ doc, index, text })))
	return out
}

const STOP_WORDS = new Set(
	'a an and are as at be but by can do does for from has have how i if in into is it its of on or that the their them then there these they this to was what when where which who why will with you your'.split(
		' '
	)
)

/** Lower-case word tokens (letters/digits of any script), without common English stop words. */
export function tokenize(text: string): string[] {
	const words = (text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
	return words.filter((w) => !STOP_WORDS.has(w)).map(stem)
}

/** A very light English stemmer: enough for "cats"/"cat" and "running"/"run" to meet. */
function stem(word: string): string {
	if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y'
	if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
	if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2)
	if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
	return word
}

/** Okapi BM25 (k1 = 1.2, b = 0.75). Returns the top `k` chunks with a score above 0, best first. */
export function bm25Rank<C extends { text: string }>(chunks: C[], query: string, k = DEFAULT_TOP_K): (C & { score: number })[] {
	const terms = [...new Set(tokenize(query))]
	if (!terms.length || !chunks.length) return []
	const docs = chunks.map((c) => tokenize(c.text))
	const avg = docs.reduce((s, d) => s + d.length, 0) / docs.length || 1
	const df = new Map<string, number>()
	for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1)
	const n = docs.length
	const k1 = 1.2
	const b = 0.75
	const scored = chunks.map((chunk, i) => {
		const tf = new Map<string, number>()
		for (const t of docs[i]) tf.set(t, (tf.get(t) ?? 0) + 1)
		let score = 0
		for (const term of terms) {
			const f = tf.get(term) ?? 0
			if (!f) continue
			const dfi = df.get(term) ?? 0
			const idf = Math.log(1 + (n - dfi + 0.5) / (dfi + 0.5))
			score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * docs[i].length) / avg)))
		}
		return { ...chunk, score }
	})
	return topK(scored.filter((c) => c.score > 0), k)
}

export function cosine(a: number[], b: number[]): number {
	let dot = 0
	let na = 0
	let nb = 0
	const len = Math.min(a.length, b.length)
	for (let i = 0; i < len; i++) {
		dot += a[i] * b[i]
		na += a[i] * a[i]
		nb += b[i] * b[i]
	}
	return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/** The `k` chunks whose vectors are closest (cosine) to the query vector, best first. */
export function cosineTopK<C>(chunks: C[], vectors: number[][], query: number[], k = DEFAULT_TOP_K): (C & { score: number })[] {
	const scored = chunks.map((chunk, i) => ({ ...chunk, score: vectors[i] ? cosine(vectors[i], query) : -1 }))
	return topK(scored.filter((c) => c.score > -1), k)
}

function topK<T extends { score: number }>(items: T[], k: number): T[] {
	return [...items].sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.floor(k) || DEFAULT_TOP_K))
}

/** The question + numbered sources prompt. The model must cite [n] and admit a missing answer. */
export function buildDocQaPrompt(question: string, sources: { text: string; document: string }[]): string {
	const blocks = sources.map((s, i) => `[${i + 1}] (from ${s.document})\n${s.text}`).join('\n\n')
	return [
		'Answer the question using only the numbered sources below.',
		'Cite the sources you use as [1], [2] … right after the sentence they support.',
		`If the sources do not contain the answer, reply exactly: "${NOT_IN_DOCUMENTS}"`,
		'',
		'Sources:',
		blocks,
		'',
		`Question: ${question.trim()}`,
	].join('\n')
}

/** A short, stable hash of a text (two 32-bit FNV-1a passes + length), for the embedding cache key. */
export function hashText(text: string): string {
	let h1 = 0x811c9dc5
	let h2 = 0x01000193 ^ 0x5bd1e995
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i)
		h1 = Math.imul(h1 ^ c, 0x01000193)
		h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 15)
	}
	return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0') + text.length.toString(16)
}
