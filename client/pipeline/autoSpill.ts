import { createShapeId, Editor, TLShapeId, toRichText } from 'tldraw'
import { capTextForCanvas } from './capOutput'
import { ExecutionResult, STOP_EXECUTION } from './nodes/types/shared'
import { getNodePortConnections, getNodePorts } from './nodes/nodePorts'
import { shouldSpillOutput } from './nodes/nodeTypes'
import { NodeShape } from './nodes/NodeShapeUtil'
import { placeImageOnCanvas } from './placeOnCanvas'

/** Horizontal gap between the node and its output label. */
const GAP = 48
const TEXT_W = 320

/**
 * When the main output port has no wire, put the value on a single text or image shape
 * beside the node (WP23 Part A: at most one output label on the canvas). Each run replaces
 * that one shape's content — reusing the same text shape in place, or recreating the image
 * shape since a fresh asset is unavoidable — instead of adding another shape beside it. Any
 * extra shapes left over from an older build (back when every run added one) are removed too.
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
	if (!shouldSpillOutput(editor, shape)) return
	const value = outputs[out.id]
	if (value == null || value === STOP_EXECUTION || value === '') return
	const raw = String(value)

	// Every spill shape from a past run (the current single one, or — migrating an older
	// canvas — the legacy single spillId, or the WP14-era spillIds history list).
	const priorIds: TLShapeId[] = (
		(shape.props.spillIds as string[] | undefined) ??
		(shape.props.spillId ? [shape.props.spillId as string] : [])
	).filter((id) => !!editor.getShape(id as TLShapeId)) as TLShapeId[]

	const isImage = /^(data:image\/|\/api\/images\/|\/examples\/)/.test(raw) || out.dataType === 'image'

	let freshId: TLShapeId
	if (isImage) {
		// A fresh asset is unavoidable for an image; drop whatever was there before placing it.
		if (priorIds.length) editor.deleteShapes(priorIds)
		freshId = await placeImageOnCanvas(editor, shape, raw, { maxSize: 360, name: 'node-output' })
	} else {
		const label: unknown = shape.props.label
		const name = typeof label === 'string' && label.trim() ? label : shape.props.node.type
		const { text } = await capTextForCanvas(name, raw)
		// Reuse the first prior shape that is still a text shape; drop every other leftover.
		const existingText = priorIds.map((id) => editor.getShape(id)).find((s) => s?.type === 'text')
		const toDrop = priorIds.filter((id) => id !== existingText?.id)
		if (toDrop.length) editor.deleteShapes(toDrop)
		if (existingText) {
			freshId = existingText.id as TLShapeId
			editor.updateShape({ id: freshId, type: 'text', props: { richText: toRichText(text) } })
		} else {
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
	}

	editor.select(shape.id)
	editor.updateShape<NodeShape>({
		id: shape.id,
		type: 'node',
		props: { spillIds: [freshId], spillId: undefined },
	})
}
