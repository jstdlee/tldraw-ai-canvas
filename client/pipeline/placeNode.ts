import { createBindingId, createShapeId, Editor, TLShapeId, VecLike } from 'tldraw'
import { findFreeSpot, placeRightOf, type Box } from '../../shared/placement'
import { NEW_NODE_FONT_PX } from './constants'
import { getNextConnectionIndex } from './connection/keepConnectionsAtBottom'
import { getNodePorts } from './nodes/nodePorts'
import { findFirstCompatiblePort } from './ports/portCompatibility'
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
		editor.createShape({ id: shapeId, type: 'node', props: { node, fontSize: NEW_NODE_FONT_PX } })
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
	// FLOW-08: without this, a user's very first edit to a just-placed card (typing into its
	// first field) fused with the creation into one undo step — one Ctrl+Z removed the whole
	// card instead of just reverting the edit. Nested inside a larger editor.run() (e.g. AI
	// build's own multi-card batch), tldraw defers this mark to that outer batch's own boundary,
	// so it doesn't fragment a multi-card build into separate undo steps.
	editor.markHistoryStoppingPoint('create node')
	return shapeId
}

/**
 * Wire `fromId`'s first output port compatible with one of `toId`'s input ports to that
 * input port. Used by "insert and wire" flows (the insert palette's Shift+Enter) where
 * there is no in-progress wire drag to attach to, unlike `PointingPort`'s onClick.
 * Returns the new connection's shape id, or null if neither side has a compatible port.
 */
export function wireNodes(editor: Editor, fromId: TLShapeId, toId: TLShapeId): TLShapeId | null {
	const fromPorts = Object.values(getNodePorts(editor, fromId)).filter((p) => p.terminal === 'start')
	const toPorts = Object.values(getNodePorts(editor, toId))

	let fromPortId: string | null = null
	let toPortId: string | null = null
	for (const fromPort of fromPorts) {
		const match = findFirstCompatiblePort(toPorts, 'end', fromPort.dataType)
		if (match) {
			fromPortId = fromPort.id
			toPortId = match.id
			break
		}
	}
	if (!fromPortId || !toPortId) return null

	const connectionId = createShapeId()
	editor.run(() => {
		editor.createShape({
			id: connectionId,
			type: 'connection',
			index: getNextConnectionIndex(editor),
			props: { start: { x: 0, y: 0 }, end: { x: 80, y: 0 } },
		})
		editor.createBinding({
			id: createBindingId(),
			type: 'connection',
			fromId: connectionId,
			toId: fromId,
			props: { portId: fromPortId!, terminal: 'start', order: 0 },
		})
		editor.createBinding({
			id: createBindingId(),
			type: 'connection',
			fromId: connectionId,
			toId: toId,
			props: { portId: toPortId!, terminal: 'end', order: 1 },
		})
	})
	return connectionId
}
