import { createShapeId, Editor, TLShapeId, toRichText } from 'tldraw'
import { capTextForCanvas } from './capOutput'
import { ExecutionResult, STOP_EXECUTION } from './nodes/types/shared'
import { getNodePortConnections, getNodePorts } from './nodes/nodePorts'
import { NodeShape } from './nodes/NodeShapeUtil'
import { placeImageOnCanvas } from './placeOnCanvas'

/** Horizontal gap between the node and the newest output, and between history shapes. */
const GAP = 48
/** How many past outputs to keep on the canvas before the oldest is dropped. */
const MAX_HISTORY = 12
const TEXT_W = 320

/**
 * Lay the output history out in a row to the right of the node: the newest
 * shape sits right beside it, each older one shifts one slot to the right, so
 * every past response stays visible. `ids` is newest-first.
 */
/** Width to reserve. Prefer the shape's own `w` so a new shape does not stack on the last one. */
function shapeWidth(editor: Editor, id: TLShapeId): number {
	const spill = editor.getShape(id)
	const width = spill && typeof (spill.props as { w?: number }).w === 'number' ? (spill.props as { w: number }).w : 0
	if (width > 0) return width
	return editor.getShapePageBounds(id)?.width || TEXT_W
}

/**
 * Move a shape so its page origin is `pageX, pageY`.
 * Shape x/y are parent-local; page bounds are not, so a frame would otherwise shift the row.
 */
function placeAtPage(editor: Editor, id: TLShapeId, pageX: number, pageY: number) {
	const spill = editor.getShape(id)
	const bounds = editor.getShapePageBounds(id)
	if (!spill || !bounds) return
	editor.updateShape({
		id,
		type: spill.type,
		x: spill.x + (pageX - bounds.minX),
		y: spill.y + (pageY - bounds.minY),
	})
}

function layoutHistory(editor: Editor, shape: NodeShape, ids: TLShapeId[]) {
	const bounds = editor.getShapePageBounds(shape.id)
	if (!bounds) return
	let x = bounds.maxX + GAP
	// Newest id is first, so it sits beside the node. Each older one moves one slot right.
	editor.run(() => {
		for (const id of ids) {
			if (!editor.getShape(id)) continue
			placeAtPage(editor, id, x, bounds.minY)
			x += shapeWidth(editor, id) + GAP
		}
	})
}

/**
 * When the main output port has no wire, put the value on a text or image
 * shape beside the node. Each run inserts the newest response next to the node
 * and pushes the previous ones further right, so the whole history is visible.
 */
export async function spillUnconnectedOutput(editor: Editor, shape: NodeShape, outputs: ExecutionResult) {
	const ports = getNodePorts(editor, shape)
	const out =
		Object.values(ports).find((port) => port.id === 'output' && port.terminal === 'start') ??
		Object.values(ports).find((port) => port.terminal === 'start' && !port.feedback)
	if (!out) return
	const wired = getNodePortConnections(editor, shape).some(
		(connection) => connection.terminal === 'start' && connection.ownPortId === out.id
	)
	if (wired) return
	const value = outputs[out.id]
	if (value == null || value === STOP_EXECUTION || value === '') return
	const raw = String(value)

	// Migrate a legacy single spillId into the history list.
	const prior: TLShapeId[] = (
		(shape.props.spillIds as string[] | undefined) ??
		(shape.props.spillId ? [shape.props.spillId as string] : [])
	).filter((id) => !!editor.getShape(id as TLShapeId)) as TLShapeId[]

	let freshId: TLShapeId
	if (/^(data:image\/|\/api\/images\/|\/examples\/)/.test(raw) || out.dataType === 'image') {
		freshId = await placeImageOnCanvas(editor, shape, raw, { maxSize: 360, name: 'node-output' })
	} else {
		// Text over the cap is spilled to a file; the shape shows a preview.
		const label: unknown = shape.props.label
		const name = typeof label === 'string' && label.trim() ? label : shape.props.node.type
		const { text } = await capTextForCanvas(name, raw)
		freshId = createShapeId()
		const bounds = editor.getShapePageBounds(shape.id)
		editor.createShape({
			id: freshId,
			type: 'text',
			x: (bounds?.maxX ?? shape.x) + GAP,
			y: bounds?.minY ?? shape.y,
			props: {
				richText: toRichText(text),
				autoSize: false,
				w: TEXT_W,
				size: 'm',
			},
		})
	}

	// Newest first; drop the oldest past the cap.
	const ids = [freshId, ...prior].slice(0, MAX_HISTORY)
	const dropped = [freshId, ...prior].slice(MAX_HISTORY)
	if (dropped.length) editor.deleteShapes(dropped)

	layoutHistory(editor, shape, ids)
	editor.select(shape.id)
	editor.updateShape<NodeShape>({
		id: shape.id,
		type: 'node',
		props: { spillIds: ids, spillId: undefined },
	})
}
