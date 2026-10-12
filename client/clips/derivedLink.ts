import { createShapeId, Editor, TLArrowShape, TLShapeId, toRichText } from 'tldraw'

/** At most this many sources get a link to one result; more would be clutter. */
const MAX_SOURCES = 6

/**
 * A dotted, labelled arrow from a source shape to a result made from it
 * (a rewrite, a summary, a QR code, …). meta.derived keeps the pipeline from
 * treating it as a wire (see pipeline/execution/arrows.ts).
 */
export function linkDerived(editor: Editor, fromId: TLShapeId, toId: TLShapeId, label: string) {
	const from = editor.getShapePageBounds(fromId)
	const to = editor.getShapePageBounds(toId)
	if (!from || !to || fromId === toId) return null
	const id = createShapeId()
	editor.run(() => {
		editor.createShape<TLArrowShape>({
			id,
			type: 'arrow',
			x: from.maxX,
			y: from.midY,
			props: {
				start: { x: 0, y: 0 },
				end: { x: to.minX - from.maxX, y: to.midY - from.midY },
				color: 'blue',
				labelColor: 'blue',
				dash: 'dotted',
				size: 's',
				font: 'sans',
				richText: toRichText(shortLabel(label)),
			},
			meta: { derived: true },
		})
		editor.createBindings([
			{ type: 'arrow', fromId: id, toId: fromId, props: { terminal: 'start', normalizedAnchor: { x: 1, y: 0.5 }, isExact: false, isPrecise: false } },
			{ type: 'arrow', fromId: id, toId, props: { terminal: 'end', normalizedAnchor: { x: 0, y: 0.5 }, isExact: false, isPrecise: false } },
		] as any)
		editor.sendToBack([id])
	})
	return id
}

/** Link each source (capped) to the result. */
export function linkAllDerived(editor: Editor, fromIds: TLShapeId[], toId: TLShapeId, label: string) {
	for (const fromId of fromIds.slice(0, MAX_SOURCES)) linkDerived(editor, fromId, toId, label)
}

/** The selected top-level shapes, read before an async job so a later selection change cannot move the links. */
export function derivedSources(editor: Editor): TLShapeId[] {
	return editor.getSelectedShapeIds().filter((id) => editor.getShape(id)?.type !== 'arrow')
}

function shortLabel(label: string) {
	const one = label.replace(/\s+/g, ' ').trim()
	return one.length > 28 ? one.slice(0, 27) + '…' : one
}
