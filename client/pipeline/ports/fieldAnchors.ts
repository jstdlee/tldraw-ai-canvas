/**
 * WP17 (every card parameter can be wired): per-shape, per-field port anchors, measured from
 * the DOM by the field row that renders a `field:<key>` port (see `useFieldPortAnchor`). Values
 * are in page units, relative to the card's top-left, so `getNodeTypePorts` can place the port
 * exactly on its row without any node type hand-computing row y positions for wirable fields.
 *
 * WP25: one atom *per shape* (not one shared atom for every shape's anchors) — a ResizeObserver
 * firing for one card no longer invalidates `getNodePorts`'s cache (and everything downstream:
 * input/output values) for every other card on the canvas.
 */
import { Editor, TLShapeId } from 'tldraw'
import { EditorAtomMap } from '../utils'

/** field key -> y (page units, relative to the shape's top-left). */
export type FieldPortAnchors = Record<string, number>

const fieldPortAnchors = new EditorAtomMap<FieldPortAnchors>('field port anchors')

/** All registered anchors for one shape (undefined if none are registered yet). */
export function getFieldPortAnchors(
	editor: Editor,
	shapeId: TLShapeId
): FieldPortAnchors | undefined {
	return fieldPortAnchors.get(editor, shapeId)
}

export function setFieldPortAnchor(editor: Editor, shapeId: TLShapeId, key: string, y: number) {
	// Round to half a page pixel: sub-pixel layout jitter (from ResizeObserver / zoom) must not
	// cause a write (and the resulting port/geometry recompute) on every tiny camera change.
	const rounded = Math.round(y * 2) / 2
	fieldPortAnchors.update(editor, shapeId, (state) => {
		if (state && state[key] === rounded) return state
		return { ...state, [key]: rounded }
	})
}

/** Like `setFieldPortAnchor`, but writes several keys in one atom update (one invalidation of
 * this shape's ports/geometry instead of one per field) — see `useFieldPortAnchor`'s rAF batch,
 * which collects a card's field measurements for one frame before calling this. */
export function setFieldPortAnchors(editor: Editor, shapeId: TLShapeId, values: Record<string, number>) {
	fieldPortAnchors.update(editor, shapeId, (state) => {
		let changed = false
		const next = state ? { ...state } : {}
		for (const key in values) {
			const rounded = Math.round(values[key] * 2) / 2
			if (next[key] !== rounded) {
				next[key] = rounded
				changed = true
			}
		}
		return changed ? next : (state ?? next)
	})
}

/** Called when the field row that owns this anchor unmounts (field no longer shown: a
 * DataPipe op change, a collapsed card, …), so stale anchors don't linger. */
export function clearFieldPortAnchor(editor: Editor, shapeId: TLShapeId, key: string) {
	fieldPortAnchors.update(editor, shapeId, (state) => {
		if (!state || !(key in state)) return state ?? {}
		const rest = { ...state }
		delete rest[key]
		return rest
	})
}

/** Drop every anchor for a shape (e.g. when it's deleted) so the map doesn't grow forever. */
export function clearFieldPortAnchorsForShape(editor: Editor, shapeId: TLShapeId) {
	fieldPortAnchors.delete(editor, shapeId)
}

/** Call once from `onMount`: clears a deleted node's anchors so they don't linger for the
 * rest of the session. */
export function watchFieldPortAnchors(editor: Editor) {
	return editor.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
		if (shape.type !== 'node') return
		clearFieldPortAnchorsForShape(editor, shape.id)
	})
}
