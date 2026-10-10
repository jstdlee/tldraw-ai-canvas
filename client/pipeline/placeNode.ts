import { createShapeId, Editor, TLShapeId, VecLike } from 'tldraw'
import { findFreeSpot, placeRightOf, type Box } from '../../shared/placement'
import { isPacked } from './subgraph'
import { NodeType } from './nodes/nodeTypes'

/** Page bounds of every shape worth avoiding: skip wires and packed (hidden) shapes. */
export function collectTakenBoxes(editor: Editor, exclude?: TLShapeId): Box[] {
	const boxes: Box[] = []
	for (const shape of editor.getCurrentPageShapes()) {
		if (shape.id === exclude) continue
		if (shape.type === 'connection') continue
		if (isPacked(shape)) continue
		const bounds = editor.getShapePageBounds(shape.id)
		if (!bounds) continue
		boxes.push({ x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height })
	}
	return boxes
}

/**
 * Create a new node shape and place it in a free spot: near `opts.near` (or the
 * viewport centre), or to the right of `opts.rightOf`. Creates the shape first so the
 * real rendered size (from its node type's size contract) is used for the search.
 */
export function createNodeAt(
	editor: Editor,
	node: NodeType,
	opts: { near?: VecLike | 'viewport'; rightOf?: TLShapeId; select?: boolean } = {}
): TLShapeId {
	const shapeId = createShapeId()
	editor.run(() => {
		editor.createShape({ id: shapeId, type: 'node', props: { node } })
		const bounds = editor.getShapePageBounds(shapeId)
		if (!bounds) return
		const taken = collectTakenBoxes(editor, shapeId)
		const size = { w: bounds.width, h: bounds.height }

		let pos: { x: number; y: number }
		if (opts.rightOf) {
			const anchorBounds = editor.getShapePageBounds(opts.rightOf)
			pos = anchorBounds
				? placeRightOf(
						{ x: anchorBounds.x, y: anchorBounds.y, w: anchorBounds.width, h: anchorBounds.height },
						size,
						taken
					)
				: { x: bounds.x, y: bounds.y }
		} else {
			const want =
				!opts.near || opts.near === 'viewport' ? editor.getViewportPageBounds().center : opts.near
			pos = findFreeSpot({ x: want.x - size.w / 2, y: want.y - size.h / 2 }, size, taken)
		}

		editor.updateShape({ id: shapeId, type: 'node', x: pos.x, y: pos.y })
		if (opts.select !== false) editor.select(shapeId)
	})
	return shapeId
}
