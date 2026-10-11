import { useEffect, useRef } from 'react'
import { TLShapeId, useEditor } from 'tldraw'
import { clearFieldPortAnchor, setFieldPortAnchor } from './fieldAnchors'

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
			setFieldPortAnchor(editor, shapeId, key, page.y - bounds.y)
		}

		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(el)
		return () => {
			observer.disconnect()
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
			keys.forEach((key, i) => setFieldPortAnchor(editor, shapeId, key, y + i * 8))
		}

		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(el)
		return () => {
			observer.disconnect()
			for (const key of keys) clearFieldPortAnchor(editor, shapeId, key)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editor, shapeId, keysKey])

	return ref
}
