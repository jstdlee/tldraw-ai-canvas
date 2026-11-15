/**
 * WP48: preview-then-Apply bookkeeping. Every canvas change the AI makes is applied at once
 * (outside undo) and recorded as a diff; Discard reverts the diff exactly, Apply turns it into
 * one undo step. Pure (no tldraw import) so it can be unit-tested (tests/aiPreview.test.ts).
 * The diff has the same shape as tldraw's `RecordsDiff`.
 */

export interface PreviewRecord {
	id: string
	typeName?: string
	type?: string
	props?: unknown
}

export interface PreviewDiff<R extends PreviewRecord = PreviewRecord> {
	added: Record<string, R>
	updated: Record<string, [from: R, to: R]>
	removed: Record<string, R>
}

export function emptyDiff<R extends PreviewRecord>(): PreviewDiff<R> {
	return { added: {}, updated: {}, removed: {} }
}

export function isDiffEmpty(diff: PreviewDiff | null | undefined): boolean {
	if (!diff) return true
	return !Object.keys(diff.added).length && !Object.keys(diff.updated).length && !Object.keys(diff.removed).length
}

/** Only records saved with the canvas (shapes, bindings, assets): never camera, selection or pointer. */
export function documentOnly<R extends PreviewRecord>(diff: PreviewDiff<R>): PreviewDiff<R> {
	const keep = (id: string) => /^(shape|binding|asset):/.test(id)
	const pick = <T>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([id]) => keep(id)))
	return { added: pick(diff.added), updated: pick(diff.updated), removed: pick(diff.removed) }
}

function sameRecord(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b)
}

/** One diff with the net effect of `diffs` applied in order (like tldraw's squashRecordDiffs). */
export function squashDiffs<R extends PreviewRecord>(diffs: PreviewDiff<R>[]): PreviewDiff<R> {
	const out = emptyDiff<R>()
	for (const diff of diffs) {
		for (const [id, rec] of Object.entries(diff.added)) {
			if (out.removed[id]) {
				// Removed, then added back: an update (or nothing at all).
				const from = out.removed[id]
				delete out.removed[id]
				if (!sameRecord(from, rec)) out.updated[id] = [from, rec]
			} else {
				out.added[id] = rec
			}
		}
		for (const [id, [from, to]] of Object.entries(diff.updated)) {
			if (out.added[id]) out.added[id] = to
			else if (out.updated[id]) out.updated[id] = [out.updated[id][0], to]
			else out.updated[id] = [from, to]
			if (out.updated[id] && sameRecord(out.updated[id][0], out.updated[id][1])) delete out.updated[id]
		}
		for (const [id, rec] of Object.entries(diff.removed)) {
			if (out.added[id]) {
				delete out.added[id]
			} else if (out.updated[id]) {
				out.removed[id] = out.updated[id][0]
				delete out.updated[id]
			} else {
				out.removed[id] = rec
			}
		}
	}
	return out
}

/** The diff that undoes `diff`. */
export function reverseDiff<R extends PreviewRecord>(diff: PreviewDiff<R>): PreviewDiff<R> {
	const updated: Record<string, [R, R]> = {}
	for (const [id, [from, to]] of Object.entries(diff.updated)) updated[id] = [to, from]
	return { added: { ...diff.removed }, updated, removed: { ...diff.added } }
}

/**
 * The preview diff "rebased" on what the records are now. The user may have panned, run a card
 * or moved a previewed shape since the preview: Apply keeps those later values instead of
 * replaying the AI's own records over them. Records the user deleted meanwhile are dropped.
 */
export function rebaseDiff<R extends PreviewRecord>(diff: PreviewDiff<R>, current: (id: string) => R | undefined): PreviewDiff<R> {
	const out = emptyDiff<R>()
	for (const id of Object.keys(diff.added)) {
		const now = current(id)
		if (now) out.added[id] = now
	}
	for (const [id, [from]] of Object.entries(diff.updated)) {
		const now = current(id)
		if (now) out.updated[id] = [from, now]
		else out.removed[id] = from
	}
	for (const [id, rec] of Object.entries(diff.removed)) {
		if (!current(id)) out.removed[id] = rec
	}
	return out
}

export interface PreviewMarks {
	/** New shapes: drawn semi-transparent with a dashed outline. */
	added: string[]
	/** Existing shapes the preview changed. */
	changed: string[]
	/** For changed cards: the card fields (`props.node.<key>`) whose value changed. */
	fields: Record<string, string[]>
}

function nodeOf(rec: PreviewRecord): Record<string, unknown> | null {
	const props = rec.props as { node?: unknown } | undefined
	return props && typeof props.node === 'object' && props.node ? (props.node as Record<string, unknown>) : null
}

/** What to mark on the canvas for a preview diff. */
export function previewMarks(diff: PreviewDiff | null | undefined): PreviewMarks {
	const marks: PreviewMarks = { added: [], changed: [], fields: {} }
	if (!diff) return marks
	for (const id of Object.keys(diff.added)) if (id.startsWith('shape:')) marks.added.push(id)
	for (const [id, [from, to]] of Object.entries(diff.updated)) {
		if (!id.startsWith('shape:')) continue
		marks.changed.push(id)
		const a = nodeOf(from)
		const b = nodeOf(to)
		if (!a || !b) continue
		const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
			(key) => key !== 'type' && !sameRecord(a[key], b[key])
		)
		if (keys.length) marks.fields[id] = keys
	}
	return marks
}

/** A short line for the thread: "2 new shapes, 1 changed". */
export function previewSummary(diff: PreviewDiff | null | undefined): string {
	const marks = previewMarks(diff)
	const removed = diff ? Object.keys(diff.removed).filter((id) => id.startsWith('shape:')).length : 0
	const parts: string[] = []
	if (marks.added.length) parts.push(`${marks.added.length} new shape${marks.added.length === 1 ? '' : 's'}`)
	if (marks.changed.length) parts.push(`${marks.changed.length} changed`)
	if (removed) parts.push(`${removed} removed`)
	return parts.join(', ') || 'No visible change'
}

/**
 * The CSS that marks a preview on the canvas, by shape id (tldraw puts `data-shape-id` on every
 * shape's wrapper). Field rows carry `data-field-keys` (useFieldPortAnchor).
 */
export function previewMarksCss(marks: PreviewMarks): string {
	const esc = (id: string) => id.replace(/["\\]/g, '\\$&')
	const rules: string[] = []
	if (marks.added.length) {
		const sel = marks.added.map((id) => `.tl-shape[data-shape-id="${esc(id)}"]`).join(',\n')
		rules.push(`${sel} { opacity: 0.55 !important; }`)
		const outlined = marks.added
			.map((id) => `.tl-shape[data-shape-id="${esc(id)}"]:not([data-shape-type="connection"]):not([data-shape-type="arrow"])`)
			.join(',\n')
		rules.push(`${outlined} { outline: calc(2px / var(--tl-zoom, 1)) dashed var(--tl-color-primary); outline-offset: calc(4px / var(--tl-zoom, 1)); }`)
	}
	if (marks.changed.length) {
		const sel = marks.changed.map((id) => `.tl-shape[data-shape-id="${esc(id)}"]:not([data-shape-type="connection"])`).join(',\n')
		rules.push(`${sel} { outline: calc(2px / var(--tl-zoom, 1)) solid var(--tl-color-primary); outline-offset: calc(4px / var(--tl-zoom, 1)); }`)
	}
	for (const [id, keys] of Object.entries(marks.fields)) {
		for (const key of keys) {
			rules.push(
				`.tl-shape[data-shape-id="${esc(id)}"] [data-field-keys~="${esc(key)}"] { background: color-mix(in srgb, var(--tl-color-primary) 16%, transparent); box-shadow: inset 0.2em 0 0 var(--tl-color-primary); }`
			)
		}
	}
	return rules.join('\n')
}

// ---------------------------------------------------------------------------
// The end of an agent turn
// ---------------------------------------------------------------------------

/** A chat item, reduced to what decides whether the user got any reply. */
export interface TurnItem {
	type: string
	actionType?: string
	complete?: boolean
	hasDiff?: boolean
}

/**
 * True when the turn showed the user something: a message, a question, a task, an error, or a
 * canvas change. Otherwise the turn ends with "Nothing to change." (WP48 bug 1).
 */
export function turnHasReply(items: TurnItem[]): boolean {
	return items.some((item) => {
		if (item.type === 'error' || item.type === 'task') return true
		if (item.type !== 'action') return false
		if (item.hasDiff) return true
		return item.actionType === 'message' || item.actionType === 'ask-user' || item.actionType === 'build-workflow' ||
			item.actionType === 'fill-card' || item.actionType === 'edit-text'
	})
}
