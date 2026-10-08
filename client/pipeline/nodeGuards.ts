import { Editor, TLShape, TLShapeId } from 'tldraw'
import { getConnectionBindings } from './connection/ConnectionBindingUtil'
import { NodeShape } from './nodes/NodeShapeUtil'

function isNode(shape: TLShape | undefined): shape is NodeShape {
	return !!shape && shape.type === 'node'
}

/** Shapes that deleteShapes is removing right now. A wire may go when the pinned node it touches goes too. */
const deleting = new WeakMap<Editor, Map<TLShapeId, number>>()

function isDeleting(editor: Editor, id: TLShapeId) {
	return (deleting.get(editor)?.get(id) ?? 0) > 0
}

function pinnedNodeIds(editor: Editor, ids: (TLShapeId | undefined)[]): TLShapeId[] {
	return ids.filter((id): id is TLShapeId => {
		if (!id) return false
		const shape = editor.getShape(id)
		return isNode(shape) && !!shape.props.pinned && !isDeleting(editor, id)
	})
}

/** The pinned nodes a wire (connection or tldraw arrow) is attached to. */
export function pinnedEnds(editor: Editor, shape: TLShape): TLShapeId[] {
	if (shape.type === 'connection') {
		const { start, end } = getConnectionBindings(editor, shape.id)
		return pinnedNodeIds(editor, [start?.toId, end?.toId])
	}
	if (shape.type === 'arrow') {
		return pinnedNodeIds(
			editor,
			editor.getBindingsFromShape(shape, 'arrow').map((binding) => binding.toId)
		)
	}
	return []
}

/** True when a pin stops this wire from being removed or moved off its port. */
export function isWireLocked(editor: Editor, shape: TLShape): boolean {
	return pinnedEnds(editor, shape).length > 0
}

/**
 * Pin freezes position and size, and keeps every wire on the node in place.
 * Delete-lock refuses deletion. Fields can still change.
 */
export function registerNodeGuards(editor: Editor) {
	const original = editor.deleteShapes.bind(editor)
	editor.deleteShapes = ((shapes: (TLShapeId | TLShape)[]) => {
		const ids = shapes.map((shape) => (typeof shape === 'string' ? shape : shape.id))
		let counts = deleting.get(editor)
		if (!counts) deleting.set(editor, (counts = new Map()))
		for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
		try {
			return original(shapes as TLShapeId[])
		} finally {
			for (const id of ids) counts.set(id, (counts.get(id) ?? 1) - 1)
		}
	}) as typeof editor.deleteShapes

	editor.sideEffects.registerBeforeDeleteHandler('shape', (shape) => {
		if (isNode(shape) && shape.props.deleteLocked) return false
		if (isWireLocked(editor, shape)) return false
		return undefined
	})
	editor.sideEffects.registerBeforeChangeHandler('shape', (prev, next, source) => {
		if (!isNode(prev) || !isNode(next) || !prev.props.pinned) return next
		if (source === 'remote') return next
		return {
			...next,
			x: prev.x,
			y: prev.y,
			rotation: prev.rotation,
			props: { ...next.props, w: prev.props.w, extraH: prev.props.extraH },
		}
	})
}
