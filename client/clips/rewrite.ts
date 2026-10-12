import { atom, createShapeId, Editor, TLShape, TLShapeId, toRichText } from 'tldraw'
import { apiGenerateText } from '../pipeline/api/pipelineApi'
import { freeSpot, NEXT_TO_GAP } from '../pipeline/placeOnCanvas'
import { buildRewritePrompt, cleanPresets, REWRITE_PRESETS, RewritePreset, splitParagraphs } from '../../shared/rewrite'
import type { Notify } from './canvasFeatures'
import { linkDerived } from './derivedLink'
import { shapeText } from './shapeText'

/**
 * Rewrite branches (VibeText idea) with plain text shapes:
 * - a variant has meta.rewriteOf = the shape it was made from, and an arrow from it;
 * - "Use this version" copies the text to the root paragraph and removes all its variants.
 */

const CARD_W = 420
const GAP = 24

const PRESETS_KEY = 'ai-canvas.rewrite.presets'

function readPresets(): RewritePreset[] {
	try {
		const raw = localStorage.getItem(PRESETS_KEY)
		return raw ? cleanPresets(JSON.parse(raw)) : REWRITE_PRESETS
	} catch {
		return REWRITE_PRESETS
	}
}

/** The Rewrite presets: the user's own list (main menu → Rewrite presets…) or the defaults. */
export const $rewritePresets = atom<RewritePreset[]>('rewrite presets', readPresets())
/** True while the presets editor is open. */
export const $presetsEditorOpen = atom('rewrite presets editor', false)

export function saveRewritePresets(list: RewritePreset[] | null) {
	try {
		if (list) localStorage.setItem(PRESETS_KEY, JSON.stringify(cleanPresets(list)))
		else localStorage.removeItem(PRESETS_KEY)
	} catch {
		// Private mode: the list lasts for this session only.
	}
	$rewritePresets.set(list ? cleanPresets(list) : REWRITE_PRESETS)
}

/** Text shapes waiting for the Rewrite dialog, or null. */
export const $rewriteTargets = atom<TLShapeId[] | null>('rewrite targets', null)
/** The two shapes in the Compare dialog (left = older), or null. `variant`: right is a variant of left. */
export const $compare = atom<{ left: TLShapeId; right: TLShapeId; variant: boolean } | null>('compare', null)

const rewriteOf = (shape: TLShape | undefined) =>
	typeof shape?.meta?.rewriteOf === 'string' ? (shape.meta.rewriteOf as TLShapeId) : null

/** The selected variant whose source still exists, or null. */
export function selectedVariant(editor: Editor): { variant: TLShape; source: TLShape } | null {
	const variant = editor.getOnlySelectedShape()
	const sourceId = rewriteOf(variant ?? undefined)
	const source = sourceId ? editor.getShape(sourceId) : undefined
	return variant && source ? { variant, source } : null
}

/** Text to compare: the source of code / SQL cards, else the shape's plain text. */
export function compareText(editor: Editor, shape: TLShape): string {
	const node = shape.type === 'node' ? (shape.props as { node?: Record<string, unknown> }).node : undefined
	for (const key of ['code', 'sql']) if (typeof node?.[key] === 'string') return node[key] as string
	return shapeText(editor, shape)
}

/** Language hint for syntax colour: a code card's language, SQL cards, else none (guess). */
export function compareLangHint(shape: TLShape): string | undefined {
	const node = shape.type === 'node' ? (shape.props as { node?: Record<string, unknown> }).node : undefined
	if (typeof node?.code === 'string') return typeof node.lang === 'string' ? node.lang : 'ts'
	if (typeof node?.sql === 'string') return 'sql'
	if (shape.type === 'markdown' || shape.type === 'mermaid') return 'text'
	return undefined
}

/**
 * What Compare would show for the selection: one variant (against its source), or
 * any two shapes with text (left one on the left; a variant always goes right).
 */
export function compareTargets(editor: Editor): { left: TLShapeId; right: TLShapeId; variant: boolean } | null {
	const pick = selectedVariant(editor)
	if (pick) return { left: pick.source.id, right: pick.variant.id, variant: true }
	const shapes = editor.getSelectedShapes()
	if (shapes.length !== 2 || !shapes.every((s) => compareText(editor, s).trim())) return null
	let [a, b] = shapes.sort((x, y) => editor.getShapePageBounds(x.id)!.minX - editor.getShapePageBounds(y.id)!.minX)
	if (rewriteOf(a) === b.id) [a, b] = [b, a]
	return { left: a.id, right: b.id, variant: rewriteOf(b) === a.id }
}

export function openCompare(editor: Editor, notify: Notify) {
	const target = compareTargets(editor)
	if (!target) return notify('Select two shapes with text, or one variant', 'warning')
	$compare.set(target)
}

function textShapes(editor: Editor) {
	return editor.getSelectedShapes().filter((s) => shapeText(editor, s).trim())
}

/** Split one selected text into a column of paragraph cards inside a frame. */
export function splitIntoParagraphs(editor: Editor, notify: Notify) {
	const source = editor.getOnlySelectedShape()
	const text = source ? shapeText(editor, source) : ''
	const parts = splitParagraphs(text)
	if (!source || parts.length < 2) return notify('Select one text with two or more paragraphs', 'warning')
	const bounds = editor.getShapePageBounds(source.id)!
	const frameId = createShapeId()
	const ids: TLShapeId[] = []
	editor.markHistoryStoppingPoint('split paragraphs')
	editor.run(() => {
		editor.createShape({ id: frameId, type: 'frame', x: bounds.minX, y: bounds.minY, props: { w: CARD_W + GAP * 2, h: 100, name: 'Document' } })
		let y = GAP
		for (const part of parts) {
			const id = createShapeId()
			ids.push(id)
			editor.createShape({ id, type: 'text', parentId: frameId, x: GAP, y, props: { richText: toRichText(part), autoSize: false, w: CARD_W } })
			y += (editor.getShapeGeometry(id).bounds.h || 40) + GAP
		}
		editor.updateShape({ id: frameId, type: 'frame', props: { h: y } })
		editor.deleteShapes([source.id])
		editor.select(...ids)
	})
	notify(`${parts.length} paragraphs. Select one and choose Rewrite…`, 'success')
}

/** Open the Rewrite dialog for the selected text shapes. */
export function openRewrite(editor: Editor, notify: Notify) {
	const shapes = textShapes(editor)
	if (!shapes.length) return notify('Select shapes with text first', 'warning')
	$rewriteTargets.set(shapes.map((s) => s.id))
}

/** Where the next variant of `source` goes: right of it (and of its frame), in the first free spot. */
function nextVariantSpot(editor: Editor, source: TLShape) {
	const b = editor.getShapePageBounds(source.id)!
	const frame = editor.getShape(source.parentId)
	const right = frame?.type === 'frame' ? Math.max(b.maxX, editor.getShapePageBounds(frame.id)!.maxX) : b.maxX
	return freeSpot(editor, right + NEXT_TO_GAP, b.minY, CARD_W, 60)
}

function addVariant(editor: Editor, source: TLShape, text: string, instructions: string, label: string) {
	const { x, y } = nextVariantSpot(editor, source)
	const id = createShapeId()
	editor.run(() => {
		editor.createShape({
			id,
			type: 'text',
			x,
			y,
			props: { richText: toRichText(text), autoSize: false, w: CARD_W, color: 'blue' },
			meta: { rewriteOf: source.id, rewritePrompt: instructions, rewriteLabel: label },
		})
		linkDerived(editor, source.id, id, label)
	})
	return id
}

/** Make one new variant for each source shape, one request at a time. */
export async function runRewrite(editor: Editor, notify: Notify, sourceIds: TLShapeId[], instructions: string, label: string) {
	const made: TLShapeId[] = []
	for (const [i, sourceId] of sourceIds.entries()) {
		const source = editor.getShape(sourceId)
		if (!source) continue
		notify(sourceIds.length > 1 ? `Rewriting ${i + 1}/${sourceIds.length}…` : 'Rewriting…')
		try {
			const { text } = await apiGenerateText({ input: shapeText(editor, source), prompt: buildRewritePrompt(instructions) })
			if (!text.trim()) throw new Error('empty answer')
			made.push(addVariant(editor, source, text.trim(), instructions, label))
		} catch (e) {
			notify(`Rewrite failed: ${(e as Error).message}`, 'error')
			break
		}
	}
	if (made.length) {
		editor.select(...made)
		notify(`${made.length} variant${made.length === 1 ? '' : 's'} added`, 'success')
	}
}

/** Same instructions again on the same source: one more sibling variant. */
export function retryVariant(editor: Editor, notify: Notify) {
	const pick = selectedVariant(editor)
	if (!pick) return notify('Select a variant first', 'warning')
	const { rewritePrompt, rewriteLabel } = pick.variant.meta
	return runRewrite(editor, notify, [pick.source.id], String(rewritePrompt ?? ''), String(rewriteLabel ?? 'Rewrite'))
}

/** Copy the variant text into its root paragraph, then delete every variant of that root. */
export function keepVariant(editor: Editor, notify: Notify) {
	const pick = selectedVariant(editor)
	if (!pick) return notify('Select a variant first', 'warning')
	let root = pick.source
	for (let up = rewriteOf(root); up && editor.getShape(up); up = rewriteOf(root)) root = editor.getShape(up)!

	const children = new Map<TLShapeId, TLShapeId[]>()
	for (const s of editor.getCurrentPageShapes()) {
		const of = rewriteOf(s)
		if (of) children.set(of, [...(children.get(of) ?? []), s.id])
	}
	const doomed: TLShapeId[] = []
	const walk = (id: TLShapeId) => (children.get(id) ?? []).forEach((c) => (doomed.push(c), walk(c)))
	walk(root.id)
	const arrows = doomed.flatMap((id) => editor.getBindingsToShape(id, 'arrow').map((b) => b.fromId))
	const text = shapeText(editor, pick.variant)
	const props = 'richText' in root.props ? { richText: toRichText(text) } : root.type === 'markdown' ? { md: text } : null
	if (!props) return notify('This shape type cannot take text', 'warning')

	editor.markHistoryStoppingPoint('use variant')
	editor.run(() => {
		editor.updateShape({ id: root.id, type: root.type, props } as any)
		editor.deleteShapes([...new Set([...arrows, ...doomed])])
		editor.select(root.id)
	})
	fitFrame(editor, root)
	notify(`Kept this version. ${doomed.length} variant${doomed.length === 1 ? '' : 's'} removed`, 'success')
}

/** After a paragraph changes height, restack the column in its frame. */
function fitFrame(editor: Editor, shape: TLShape) {
	const frame = editor.getShape(shape.parentId)
	if (frame?.type !== 'frame') return
	const kids = editor
		.getSortedChildIdsForParent(frame.id)
		.map((id) => editor.getShape(id)!)
		.filter((s) => s.type === 'text')
		.sort((a, b) => a.y - b.y)
	let y = GAP
	editor.run(() => {
		for (const k of kids) {
			editor.updateShape({ id: k.id, type: k.type, y })
			y += editor.getShapeGeometry(k.id).bounds.h + GAP
		}
		editor.updateShape({ id: frame.id, type: 'frame', props: { h: y } })
	})
}

/** The paragraphs of the selected frame (or the selection), top to bottom, to the clipboard. */
export async function copyDocument(editor: Editor, notify: Notify) {
	const sel = editor.getOnlySelectedShape()
	const ids = sel?.type === 'frame' ? editor.getSortedChildIdsForParent(sel.id) : editor.getSelectedShapeIds()
	const text = ids
		.map((id) => editor.getShape(id)!)
		.filter((s) => s && !rewriteOf(s))
		.sort((a, b) => editor.getShapePageBounds(a.id)!.minY - editor.getShapePageBounds(b.id)!.minY)
		.map((s) => shapeText(editor, s).trim())
		.filter(Boolean)
		.join('\n\n')
	if (!text) return notify('Select the Document frame first', 'warning')
	await navigator.clipboard.writeText(text)
	notify(`Copied ${text.split(/\s+/).length} words as Markdown`, 'success')
}
