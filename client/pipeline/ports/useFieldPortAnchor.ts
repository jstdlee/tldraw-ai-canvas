import { useEffect, useRef } from 'react'
import { Editor, TLShapeId, useEditor } from 'tldraw'
import { clearFieldPortAnchor, setFieldPortAnchors } from './fieldAnchors'

/**
 * WP25: a card can have several wirable fields, each with its own ResizeObserver (one per row —
 * a row's height follows the card's own font-size setting, not a single card-wide size). Several
 * can fire in the same frame (a card-wide font change resizes every row at once); writing each
 * one straight to the anchors atom would invalidate this card's ports/geometry once per field.
 * This collects a card's pending measurements and flushes them as one `setFieldPortAnchors` call
 * per rAF, so a multi-field resize costs one write, not N.
 */
const pendingByEditor = new WeakMap<Editor, Map<TLShapeId, Map<string, number>>>()
const rafByEditor = new WeakMap<Editor, Map<TLShapeId, number>>()

function queueAnchorWrite(editor: Editor, shapeId: TLShapeId, key: string, y: number) {
	let byShape = pendingByEditor.get(editor)
	if (!byShape) {
		byShape = new Map()
		pendingByEditor.set(editor, byShape)
	}
	let values = byShape.get(shapeId)
	if (!values) {
		values = new Map()
		byShape.set(shapeId, values)
	}
	values.set(key, y)

	let rafIds = rafByEditor.get(editor)
	if (!rafIds) {
		rafIds = new Map()
		rafByEditor.set(editor, rafIds)
	}
	if (rafIds.has(shapeId)) return // already scheduled to flush this shape's pending writes

	const id = requestAnimationFrame(() => {
		rafIds!.delete(shapeId)
		const pending = byShape!.get(shapeId)
		byShape!.delete(shapeId)
		if (pending && pending.size > 0) {
			setFieldPortAnchors(editor, shapeId, Object.fromEntries(pending))
		}
	})
	rafIds.set(shapeId, id)
}

/** True when the row unmounts only because its card went off-screen (culled), not because the
 * field was hidden or the card deleted. */
function keepWhileCulled(editor: Editor, shapeId: TLShapeId): boolean {
	return !!editor.getShape(shapeId) && editor.getCulledShapes().has(shapeId)
}

/**
 * Attach the returned ref to the DOM element of a field's row. While mounted, its vertical
 * center is measured and published to the field-port anchor atom (in page units, relative to
 * the card's top-left), so `getNodeTypePorts` can put the `field:<key>` port exactly on this
 * row. Re-measures on resize (row height follows the card's font size); unregisters on unmount
 * (e.g. a DataPipe op change hides this param) so stale anchors don't linger.
 */
export function useFieldPortAnchor<T extends HTMLElement>(shapeId: TLShapeId, key: string) {
	const editor = useEditor()
	const ref = useRef<T | null>(null)

	useEffect(() => {
		const el = ref.current
		if (!el) return

		const measure = () => {
			const rect = el.getBoundingClientRect()
			if (rect.width === 0 && rect.height === 0) return
			const bounds = editor.getShapePageBounds(shapeId)
			if (!bounds) return
			// screenToPage already accounts for camera pan/zoom, so the result is in page units.
			const page = editor.screenToPage({ x: rect.left, y: rect.top + rect.height / 2 })
			queueAnchorWrite(editor, shapeId, key, page.y - bounds.y)
		}

		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(el)
		return () => {
			observer.disconnect()
			// WP25: a culled card's body is swapped for a placeholder (NodeBody), which unmounts
			// this row. Its anchor is relative to the shape, so it stays valid: keep it, so wires
			// from the off-screen card keep their row, and nothing re-measures on scroll back.
			if (keepWhileCulled(editor, shapeId)) return
			clearFieldPortAnchor(editor, shapeId, key)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editor, shapeId, key])

	return ref
}

/**
 * Like `useFieldPortAnchor`, but registers the same measured row for several field keys at
 * once — for fields that share one row while a section is collapsed (e.g. "More settings":
 * several fields stack on the section's own header row until it's opened).
 */
export function useFieldPortAnchors<T extends HTMLElement>(shapeId: TLShapeId, keys: string[]) {
	const editor = useEditor()
	const ref = useRef<T | null>(null)
	const keysKey = keys.join(',')

	useEffect(() => {
		const el = ref.current
		if (!el || keys.length === 0) return

		const measure = () => {
			const rect = el.getBoundingClientRect()
			if (rect.width === 0 && rect.height === 0) return
			const bounds = editor.getShapePageBounds(shapeId)
			if (!bounds) return
			const page = editor.screenToPage({ x: rect.left, y: rect.top + rect.height / 2 })
			const y = page.y - bounds.y
			// Stacked 8px apart (rule: no two ports sharing a collapsed row's anchor share a point).
			keys.forEach((key, i) => queueAnchorWrite(editor, shapeId, key, y + i * 8))
		}

		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(el)
		return () => {
			observer.disconnect()
			if (keepWhileCulled(editor, shapeId)) return
			for (const key of keys) clearFieldPortAnchor(editor, shapeId, key)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editor, shapeId, keysKey])

	return ref
}
