import { createShapeId, Editor, TLShapeId, toRichText } from 'tldraw'
import { capTextForCanvas } from './capOutput'
import { ExecutionResult, STOP_EXECUTION } from './nodes/types/shared'
import { getNodePortConnections, getNodePorts } from './nodes/nodePorts'
import { NodeShape } from './nodes/NodeShapeUtil'
import { placeImageOnCanvas } from './placeOnCanvas'

function isImage(value: string) {
	return /^(data:image\/|\/api\/images\/|\/examples\/)/.test(value)
}

/**
 * When the main output port has no wire, put the value on a text or image
 * shape beside the node. The next run updates that same shape.
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
	const spillId = shape.props.spillId as TLShapeId | undefined
	const existing = spillId ? editor.getShape(spillId) : undefined

	if (isImage(raw) || out.dataType === 'image') {
		if (existing) editor.deleteShapes([existing.id])
		const id = await placeImageOnCanvas(editor, shape, raw, { maxSize: 360, name: 'node-output' })
		editor.select(shape.id)
		editor.updateShape<NodeShape>({ id: shape.id, type: 'node', props: { spillId: id } })
		return
	}

	// Text over the cap is spilled to a file; the shape shows a preview.
	const label: unknown = shape.props.label
	const name = typeof label === 'string' && label.trim() ? label : shape.props.node.type
	const { text } = await capTextForCanvas(name, raw)

	if (existing && existing.type === 'text') {
		editor.updateShape({
			id: existing.id,
			type: 'text',
			props: { richText: toRichText(text) },
		})
		return
	}
	if (existing) editor.deleteShapes([existing.id])
	const id = createShapeId()
	const bounds = editor.getShapePageBounds(shape.id)
	editor.createShape({
		id,
		type: 'text',
		x: (bounds?.maxX ?? shape.x) + 48,
		y: bounds?.minY ?? shape.y,
		props: {
			richText: toRichText(text),
			autoSize: false,
			w: 320,
			size: 'm',
		},
	})
	editor.updateShape<NodeShape>({ id: shape.id, type: 'node', props: { spillId: id } })
}
