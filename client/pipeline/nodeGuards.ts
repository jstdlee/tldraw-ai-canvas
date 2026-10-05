import { Editor, TLShape } from 'tldraw'
import { NodeShape } from './nodes/NodeShapeUtil'

function isNode(shape: TLShape): shape is NodeShape {
	return shape.type === 'node'
}

/** Pin freezes position and size. Delete-lock refuses deletion. Fields can still change. */
export function registerNodeGuards(editor: Editor) {
	editor.sideEffects.registerBeforeDeleteHandler('shape', (shape) => {
		if (isNode(shape) && shape.props.deleteLocked) return false
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
