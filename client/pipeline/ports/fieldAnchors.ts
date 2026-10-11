/**
 * WP17 (every card parameter can be wired): per-shape, per-field port anchors, measured from
 * the DOM by the field row that renders a `field:<key>` port (see `useFieldPortAnchor`). Values
 * are in page units, relative to the card's top-left, so `getNodeTypePorts` can place the port
 * exactly on its row without any node type hand-computing row y positions for wirable fields.
 */
import { Editor, TLShapeId } from 'tldraw'
import { EditorAtom } from '../utils'

/** shapeId -> field key -> y (page units, relative to the shape's top-left). */
export type FieldPortAnchors = Record<string, Record<string, number>>

const fieldPortAnchors = new EditorAtom<FieldPortAnchors>('field port anchors', () => ({}))

/** All registered anchors for one shape (undefined if none are registered yet). */
export function getFieldPortAnchors(
	editor: Editor,
	shapeId: TLShapeId
): Record<string, number> | undefined {
	return fieldPortAnchors.get(editor)[shapeId]
}

export function setFieldPortAnchor(editor: Editor, shapeId: TLShapeId, key: string, y: number) {
	fieldPortAnchors.update(editor, (state) => {
		const forShape = state[shapeId]
		if (forShape && forShape[key] === y) return state
		return { ...state, [shapeId]: { ...forShape, [key]: y } }
	})
}

/** Called when the field row that owns this anchor unmounts (field no longer shown: a
 * DataPipe op change, a collapsed card, …), so stale anchors don't linger. */
export function clearFieldPortAnchor(editor: Editor, shapeId: TLShapeId, key: string) {
	fieldPortAnchors.update(editor, (state) => {
		const forShape = state[shapeId]
		if (!forShape || !(key in forShape)) return state
		const rest = { ...forShape }
		delete rest[key]
		return { ...state, [shapeId]: rest }
	})
}

/** Drop every anchor for a shape (e.g. when it's deleted) so the map doesn't grow forever. */
export function clearFieldPortAnchorsForShape(editor: Editor, shapeId: TLShapeId) {
	fieldPortAnchors.update(editor, (state) => {
		if (!(shapeId in state)) return state
		const rest = { ...state }
		delete rest[shapeId]
		return rest
	})
}

/** Call once from `onMount`: clears a deleted node's anchors so they don't linger for the
 * rest of the session. */
export function watchFieldPortAnchors(editor: Editor) {
	return editor.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
		if (shape.type !== 'node') return
		clearFieldPortAnchorsForShape(editor, shape.id)
	})
}
