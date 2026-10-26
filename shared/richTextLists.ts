/**
 * List formats in rich text (bullets, numbers, checklists).
 *
 * Plain text and rich text meet in many places: AI answers become text cards, and card text goes back
 * to the AI. This file keeps lists alive across that trip:
 * - textToRichText: "- a", "1. a", "- [ ] a" / "[x] a" lines become real lists (nesting by indent).
 *   Text with no list lines gives the same document as tldraw's toRichText.
 * - richTextToPlain: lists come back as the same markers.
 * - setListKind / toggleTaskAt: the edits the canvas menus and checkbox clicks need.
 *
 * Pure JSON, no tldraw or TipTap import, so the server and tests can use it too.
 */

export type RTNode = {
	type: string
	attrs?: Record<string, any>
	content?: RTNode[]
	text?: string
	marks?: unknown[]
}
/** Same shape as tldraw's TLRichText (its content is unknown[]). */
export type RichDoc = { type: string; content: any[]; attrs?: any }
export type ListKind = 'bullet' | 'ordered' | 'task'

const LIST_TYPE: Record<ListKind, string> = { bullet: 'bulletList', ordered: 'orderedList', task: 'taskList' }
const ITEM_TYPE: Record<ListKind, string> = { bullet: 'listItem', ordered: 'listItem', task: 'taskItem' }
const KIND_OF: Record<string, ListKind> = { bulletList: 'bullet', orderedList: 'ordered', taskList: 'task' }

/** One parsed list line. */
type Line = { level: number; kind: ListKind; checked: boolean; start: number; text: string }

// "- [ ] a", "* [x] a", "[ ] a", "- a", "• a", "1. a", "2) a"
const LINE = /^([ \t]*)(?:[-*+•][ \t]+\[([ xX])\][ \t]+|\[([ xX])\][ \t]+|([-*+•])[ \t]+|(\d{1,4})[.)][ \t]+)(.*)$/

function indentLevel(ws: string): number {
	let cols = 0
	for (const ch of ws) cols += ch === '\t' ? 2 : 1
	return Math.floor(cols / 2)
}

function parseLine(raw: string): Line | null {
	const m = LINE.exec(raw)
	if (!m) return null
	const [, ws, boxA, boxB, , num, text] = m
	const box = boxA ?? boxB
	const level = indentLevel(ws)
	if (box !== undefined) return { level, kind: 'task', checked: box !== ' ', start: 1, text }
	if (num !== undefined) return { level, kind: 'ordered', checked: false, start: Number(num), text }
	return { level, kind: 'bullet', checked: false, start: 1, text }
}

function paragraph(text: string): RTNode {
	return text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }
}

function makeItem(kind: ListKind, content: RTNode[], checked = false): RTNode {
	return kind === 'task' ? { type: 'taskItem', attrs: { checked }, content } : { type: 'listItem', content }
}

function makeList(kind: ListKind, items: RTNode[], start = 1): RTNode {
	const list: RTNode = { type: LIST_TYPE[kind], content: items }
	if (kind === 'ordered') list.attrs = { start, type: null }
	return list
}

/** Builds lists from consecutive list lines. Deeper lines nest under the item above them. */
function buildLists(lines: Line[]): RTNode[] {
	const out: RTNode[] = []
	let i = 0
	while (i < lines.length) {
		const level = lines[i].level
		const kind = lines[i].kind
		const start = lines[i].start
		const items: RTNode[] = []
		while (i < lines.length && lines[i].level <= level && lines[i].kind === kind) {
			// A shallower line than the first one still joins this run (no parent to hang it on).
			const line = lines[i++]
			const children: Line[] = []
			while (i < lines.length && lines[i].level > level) children.push(lines[i++])
			items.push(makeItem(kind, [paragraph(line.text), ...buildLists(children)], line.checked))
		}
		out.push(makeList(kind, items, start))
	}
	return out
}

/** Plain text → rich text. List lines become lists; other lines become paragraphs, like toRichText. */
export function textToRichText(text: string): RichDoc {
	const content: RTNode[] = []
	let run: Line[] = []
	const flush = () => {
		if (run.length) content.push(...buildLists(run))
		run = []
	}
	for (const raw of text.split('\n')) {
		const line = parseLine(raw)
		if (line) {
			run.push(line)
			continue
		}
		flush()
		content.push(paragraph(raw))
	}
	flush()
	return { type: 'doc', content }
}

function inlineText(node: RTNode): string {
	if (node.type === 'text') return node.text ?? ''
	if (node.type === 'hardBreak') return '\n'
	return (node.content ?? []).map(inlineText).join('')
}

function blockLines(node: RTNode, indent: string): string[] {
	const kind = KIND_OF[node.type]
	if (kind) {
		const lines: string[] = []
		let n = Number(node.attrs?.start ?? 1) || 1
		for (const item of node.content ?? []) {
			const marker =
				kind === 'ordered' ? `${n++}. ` : kind === 'task' ? `- [${item.attrs?.checked ? 'x' : ' '}] ` : '- '
			const [first, ...rest] = item.content ?? []
			const head = first ? blockLines(first, '') : ['']
			lines.push(indent + marker + head[0], ...head.slice(1).map((l) => indent + '  ' + l))
			for (const child of rest) lines.push(...blockLines(child, indent + '  '))
		}
		return lines
	}
	if (node.type === 'paragraph' || node.type === 'heading' || !node.content?.some((c) => c.type !== 'text')) {
		return inlineText(node)
			.split('\n')
			.map((l) => indent + l)
	}
	return (node.content ?? []).flatMap((c) => blockLines(c, indent))
}

/** Rich text → plain text, with list markers ("- ", "1. ", "- [x] "). */
export function richTextToPlain(doc: RichDoc | undefined | null): string {
	if (!doc?.content?.length) return ''
	return doc.content.flatMap((b) => blockLines(b, '')).join('\n')
}

/** Does the document hold at least one list of this kind (top level)? */
export function hasListKind(doc: RichDoc | undefined | null, kind: ListKind): boolean {
	return !!doc?.content?.some((b) => KIND_OF[b.type] === kind)
}

function retagList(list: RTNode, kind: ListKind): RTNode {
	return makeList(
		kind,
		(list.content ?? []).map((item) => retagItem(item, kind)),
		kind === 'ordered' ? Number(list.attrs?.start ?? 1) || 1 : 1
	)
}

function retagItem(item: RTNode, kind: ListKind): RTNode {
	const content = (item.content ?? []).map((c) => (KIND_OF[c.type] ? retagList(c, kind) : c))
	return makeItem(kind, content.length ? content : [paragraph('')], !!item.attrs?.checked)
}

/** List items → paragraphs, depth first. */
function flattenItems(list: RTNode): RTNode[] {
	return (list.content ?? []).flatMap((item) =>
		(item.content ?? []).flatMap((c) => (KIND_OF[c.type] ? flattenItems(c) : [c]))
	)
}

/**
 * Turns the top-level blocks into one kind of list (or back into paragraphs when kind is null).
 * Non-empty paragraphs and lists next to each other join one list; empty paragraphs stay as gaps.
 */
export function setListKind(doc: RichDoc, kind: ListKind | null): RichDoc {
	if (kind === null) {
		return { ...doc, content: doc.content.flatMap((b) => (KIND_OF[b.type] ? flattenItems(b) : [b])) }
	}
	const content: RTNode[] = []
	let items: RTNode[] = []
	const flush = () => {
		if (items.length) content.push(makeList(kind, items))
		items = []
	}
	for (const block of doc.content) {
		if (KIND_OF[block.type]) {
			items.push(...(retagList(block, kind).content ?? []))
		} else if (block.type === 'paragraph' && block.content?.length) {
			items.push(makeItem(kind, [block]))
		} else if (block.type === 'heading') {
			items.push(makeItem(kind, [{ type: 'paragraph', content: block.content }]))
		} else {
			flush()
			content.push(block)
		}
	}
	flush()
	return { ...doc, content }
}

/** Number of checklist items (all depths). */
export function countTasks(doc: RichDoc | undefined | null): { done: number; total: number } {
	let done = 0
	let total = 0
	const walk = (n: RTNode) => {
		if (n.type === 'taskItem') {
			total++
			if (n.attrs?.checked) done++
		}
		n.content?.forEach(walk)
	}
	doc?.content?.forEach(walk)
	return { done, total }
}

/** Flips the checkbox of the index-th checklist item, in document order. Returns a new document. */
export function toggleTaskAt(doc: RichDoc, index: number): RichDoc {
	let seen = -1
	const walk = (n: RTNode): RTNode => {
		let next = n
		if (n.type === 'taskItem' && ++seen === index) {
			next = { ...n, attrs: { ...n.attrs, checked: !n.attrs?.checked } }
		}
		return next.content ? { ...next, content: next.content.map(walk) } : next
	}
	return { ...doc, content: doc.content.map(walk) }
}

/**
 * Plain text for the AI: the caller's usual text, unless the document holds a list,
 * then the list-marker form (tldraw's own plain text drops the markers).
 */
export function listAwareText<T extends string | undefined>(usual: T, doc: RichDoc | undefined | null): T | string {
	return doc?.content?.some((b) => KIND_OF[b.type]) ? richTextToPlain(doc) : usual
}
