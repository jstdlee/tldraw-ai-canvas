/**
 * Git-style text diff for the Compare dialog: line rows for a split or unified
 * view, word marks inside changed lines, and syntax tokens per line.
 */
import { tokenize } from './codeFormat'

type OpKind = 'same' | 'add' | 'del'

/** LCS diff of two sequences. Very large inputs fall back to "all removed, all added". */
function diffSeq(a: string[], b: string[], key: (s: string) => string = (s) => s): { kind: OpKind; i: number; j: number }[] {
	const n = a.length
	const m = b.length
	const ops: { kind: OpKind; i: number; j: number }[] = []
	if (n * m > 4_000_000) {
		a.forEach((_, i) => ops.push({ kind: 'del', i, j: -1 }))
		b.forEach((_, j) => ops.push({ kind: 'add', i: -1, j }))
		return ops
	}
	const ka = a.map(key)
	const kb = b.map(key)
	const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i][j] = ka[i] === kb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
		}
	}
	let i = 0
	let j = 0
	while (i < n && j < m) {
		if (ka[i] === kb[j]) ops.push({ kind: 'same', i: i++, j: j++ })
		else if (lcs[i + 1][j] >= lcs[i][j + 1]) ops.push({ kind: 'del', i: i++, j: -1 })
		else ops.push({ kind: 'add', i: -1, j: j++ })
	}
	while (i < n) ops.push({ kind: 'del', i: i++, j: -1 })
	while (j < m) ops.push({ kind: 'add', i: -1, j: j++ })
	return ops
}

export interface DiffPart {
	kind: OpKind
	text: string
}

/** Words and single punctuation marks, each with the whitespace after it (so code diffs stay fine-grained). */
const WORDS = /[\p{L}\p{N}_]+\s*|[^\p{L}\p{N}_\s]\s*|\s+/gu

/** Word-level diff. Whitespace stays attached to the word before it. */
export function wordDiff(before: string, after: string): DiffPart[] {
	const a = before.match(WORDS) ?? []
	const b = after.match(WORDS) ?? []
	const parts: DiffPart[] = []
	for (const op of diffSeq(a, b, (s) => s.trim())) {
		const text = op.kind === 'del' ? a[op.i] : b[op.j]
		const last = parts[parts.length - 1]
		if (last?.kind === op.kind) last.text += text
		else parts.push({ kind: op.kind, text })
	}
	return parts
}

export interface Cell {
	/** 1-based line number. */
	n: number
	text: string
}

export type Row =
	| { kind: 'same' | 'change' | 'del' | 'add'; left?: Cell; right?: Cell }
	| { kind: 'gap'; hidden: Row[] }

export const CONTEXT_LINES = 3

/**
 * Rows for a side-by-side view. Removed and added lines in one block are paired
 * row by row ("change"); the rest become one-sided "del"/"add" rows. Unchanged runs
 * longer than the context fold into a "gap" row (unless `all`).
 */
export function lineRows(before: string, after: string, all = false): Row[] {
	const a = before.replace(/\r\n/g, '\n').split('\n')
	const b = after.replace(/\r\n/g, '\n').split('\n')
	const rows: Row[] = []
	let dels: Cell[] = []
	let adds: Cell[] = []
	const flush = () => {
		for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
			const left = dels[k]
			const right = adds[k]
			rows.push({ kind: left && right ? 'change' : left ? 'del' : 'add', left, right })
		}
		dels = []
		adds = []
	}
	for (const op of diffSeq(a, b)) {
		if (op.kind === 'del') dels.push({ n: op.i + 1, text: a[op.i] })
		else if (op.kind === 'add') adds.push({ n: op.j + 1, text: b[op.j] })
		else {
			flush()
			rows.push({ kind: 'same', left: { n: op.i + 1, text: a[op.i] }, right: { n: op.j + 1, text: b[op.j] } })
		}
	}
	flush()
	if (all || rows.every((r) => r.kind === 'same')) return rows

	const out: Row[] = []
	let run: Row[] = []
	const flushRun = (atStart: boolean, atEnd: boolean) => {
		const keepHead = atStart ? 0 : CONTEXT_LINES
		const keepTail = atEnd ? 0 : CONTEXT_LINES
		if (run.length > keepHead + keepTail + 1) {
			out.push(...run.slice(0, keepHead), { kind: 'gap', hidden: run.slice(keepHead, run.length - keepTail) }, ...run.slice(run.length - keepTail))
		} else out.push(...run)
		run = []
	}
	rows.forEach((row) => {
		if (row.kind === 'same') run.push(row)
		else {
			flushRun(out.length === 0, false)
			out.push(row)
		}
	})
	flushRun(out.length === 0, true)
	return out
}

/** Count of removed and added lines. */
export function diffStats(rows: Row[]): { added: number; removed: number } {
	let added = 0
	let removed = 0
	for (const r of rows) {
		if (r.kind === 'gap') continue
		if (r.kind === 'change' || r.kind === 'del') removed++
		if (r.kind === 'change' || r.kind === 'add') added++
	}
	return { added, removed }
}

/**
 * Character ranges that changed inside a paired line, for the darker word marks.
 * Lines that share less than half of their words get no marks (the whole line is new).
 */
export function changeRanges(before: string, after: string): { left: [number, number][]; right: [number, number][] } {
	const parts = wordDiff(before, after)
	const count = (text: string) => (text.match(WORDS) ?? []).filter((w) => w.trim()).length
	const same = parts.filter((p) => p.kind === 'same').reduce((n, p) => n + count(p.text), 0)
	if (same * 2 < (count(before) + count(after)) / 2) return { left: [], right: [] }
	const left: [number, number][] = []
	const right: [number, number][] = []
	let li = 0
	let ri = 0
	for (const p of parts) {
		if (p.kind !== 'add') {
			if (p.kind === 'del') left.push([li, li + p.text.trimEnd().length])
			li += p.text.length
		}
		if (p.kind !== 'del') {
			if (p.kind === 'add') right.push([ri, ri + p.text.trimEnd().length])
			ri += p.text.length
		}
	}
	return { left, right }
}

export type DiffLang = 'text' | 'js' | 'ts' | 'py' | 'sql' | 'json'

/** A best guess of the language, from a card hint or the text itself. */
export function guessLang(text: string, hint?: string): DiffLang {
	if (hint === 'py' || hint === 'js' || hint === 'ts' || hint === 'sql' || hint === 'json' || hint === 'text') return hint
	const t = text.trim()
	if (/^[[{]/.test(t)) {
		try {
			JSON.parse(t)
			return 'json'
		} catch {}
	}
	if (/^\s*(def \w+\(|from \S+ import |import \w+$|class \w+.*:$)/m.test(t)) return 'py'
	if (/^\s*(select|insert into|update \w+ set|delete from|create table|with \w+ as)\b/im.test(t)) return 'sql'
	if (/(^|\n)\s*(const|let|var|function|import|export|interface|type) |=>|\);\s*$/m.test(t)) return 'ts'
	return 'text'
}

export interface Seg {
	kind: string
	text: string
	mark: boolean
}

/** Syntax tokens split into lines; prose ("text") stays one plain token per line. */
export function lineTokens(text: string, lang: DiffLang): { kind: string; text: string }[][] {
	const lines: { kind: string; text: string }[][] = [[]]
	const tokens = lang === 'text' ? [{ kind: 'plain', text }] : tokenize(text, lang)
	for (const tok of tokens) {
		tok.text.split('\n').forEach((piece, k) => {
			if (k > 0) lines.push([])
			if (piece) lines[lines.length - 1].push({ kind: tok.kind, text: piece })
		})
	}
	return lines
}

/** Cut a line's tokens at the mark ranges, so each piece has one colour and one mark state. */
export function markSegments(tokens: { kind: string; text: string }[], ranges: [number, number][]): Seg[] {
	const inMark = (i: number) => ranges.some(([s, e]) => i >= s && i < e)
	const out: Seg[] = []
	let pos = 0
	for (const tok of tokens) {
		for (let k = 0; k < tok.text.length; k++) {
			const ch = tok.text[k]
			const mark = inMark(pos++)
			const last = out[out.length - 1]
			if (last && last.kind === tok.kind && last.mark === mark) last.text += ch
			else out.push({ kind: tok.kind, text: ch, mark })
		}
	}
	return out
}
