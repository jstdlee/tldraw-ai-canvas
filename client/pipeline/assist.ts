import { atom, createBindingId, createShapeId, Editor, TLShapeId } from 'tldraw'
import { allowedProps, parseComposePlan, parseFillPlan } from '../../shared/nodeAssist'
import { catalogPrompt } from '../../shared/nodeCatalog'
import { featurePrompt } from '../../shared/featureList'
import { shapeText } from '../clips/shapeText'
import { apiGenerateText } from './api/pipelineApi'
import { getNodeDefinition, NodeType } from './nodes/nodeTypes'
import { NodeShape } from './nodes/NodeShapeUtil'

export const $assist = atom<{ mode: 'fill'; shapeId: TLShapeId } | { mode: 'compose'; shapeIds: TLShapeId[] } | null>(
	'node assist',
	null
)

export function openFillAssist(shapeId: TLShapeId) {
	$assist.set({ mode: 'fill', shapeId })
}

export function openComposeAssist(shapeIds: TLShapeId[]) {
	$assist.set({ mode: 'compose', shapeIds })
}

function nodeSummary(shape: NodeShape) {
	const node = shape.props.node as unknown as Record<string, unknown>
	const brief: Record<string, unknown> = { type: node.type }
	for (const [key, value] of Object.entries(node)) {
		if (key === 'type' || value == null || value === '') continue
		if (typeof value === 'string' && value.length > 400) brief[key] = value.slice(0, 400) + '…'
		else if (typeof value !== 'object') brief[key] = value
	}
	return { id: shape.id, ...brief }
}

export async function runFill(editor: Editor, shapeId: TLShapeId, intent: string) {
	const shape = editor.getShape(shapeId)
	if (!shape || shape.type !== 'node') throw new Error('Select a node')
	const node = shape.props.node as unknown as Record<string, unknown>
	const { text } = await apiGenerateText({
		temperature: 0.2,
		system:
			'You set the fields of one workflow node. Reply with JSON only: {"props": { ...fields }}. ' +
			'Do not change type. Use only fields that already exist. Leave result fields empty.\n\n' +
			catalogPrompt(),
		prompt: `Node:\n${JSON.stringify(nodeSummary(shape))}\n\nSelection text:\n${shapeText(editor, shape)}\n\nThe user wants: ${intent}`,
	})
	const plan = parseFillPlan(text)
	const props = allowedProps(node, plan.props)
	if (!Object.keys(props).length) throw new Error('The model did not change any field')
	editor.updateShape<NodeShape>({
		id: shape.id,
		type: 'node',
		props: { node: { ...shape.props.node, ...props } as NodeType, isOutOfDate: true },
	})
}

export async function runCompose(editor: Editor, shapeIds: TLShapeId[], intent: string) {
	const shapes = shapeIds
		.map((id) => editor.getShape(id))
		.filter((shape): shape is NodeShape => !!shape && shape.type === 'node')
	if (!shapes.length) throw new Error('Select one or more nodes')
	const { text } = await apiGenerateText({
		temperature: 0.2,
		system:
			'You wire workflow nodes so they do what the user asks. Reply with JSON only:\n' +
			'{"updates":[{"id":"existing shape id","props":{}}],"add":[{"tempId":"n1","type":"prompt","props":{},"x":0,"y":0}],"connect":[{"from":"id or tempId","fromPort":"output","to":"id or tempId","toPort":"input"}]}\n' +
			'Use existing ids for selected nodes. Add a node when one is missing. Use only the ports and fields listed. ' +
			'The catalog is a static list of this app. It is not a live MCP server.\n\n' +
			catalogPrompt() +
			'\n\nApp features:\n' +
			featurePrompt(),
		prompt: `Selected nodes:\n${JSON.stringify(shapes.map(nodeSummary), null, 2)}\n\nSelection text:\n${shapes
			.map((shape) => shapeText(editor, shape))
			.filter(Boolean)
			.join('\n---\n')}\n\nThe user wants: ${intent}`,
	})
	const plan = parseComposePlan(text)
	const ids = new Map<string, TLShapeId>()
	for (const shape of shapes) ids.set(shape.id, shape.id)
	editor.markHistoryStoppingPoint('ai arrange nodes')
	editor.run(() => {
		for (const update of plan.updates) {
			const shape = editor.getShape(update.id as TLShapeId)
			if (!shape || shape.type !== 'node') continue
			const node = shape.props.node as unknown as Record<string, unknown>
			const props = allowedProps(node, update.props)
			editor.updateShape<NodeShape>({
				id: shape.id,
				type: 'node',
				props: { node: { ...shape.props.node, ...props } as NodeType, isOutOfDate: true },
			})
		}
		const origin = editor.getViewportPageBounds().center
		for (const add of plan.add) {
			let base: NodeType
			try {
				base = getNodeDefinition(editor, add.type as NodeType['type']).getDefault()
			} catch {
				continue
			}
			const id = createShapeId()
			ids.set(add.tempId, id)
			const props = allowedProps(base as unknown as Record<string, unknown>, add.props)
			editor.createShape({
				id,
				type: 'node',
				x: origin.x + add.x,
				y: origin.y + add.y,
				props: { node: { ...base, ...props, type: add.type } as NodeType },
			})
		}
		for (const wire of plan.connect) {
			const fromId = ids.get(wire.from) ?? (editor.getShape(wire.from as TLShapeId) ? (wire.from as TLShapeId) : undefined)
			const toId = ids.get(wire.to) ?? (editor.getShape(wire.to as TLShapeId) ? (wire.to as TLShapeId) : undefined)
			if (!fromId || !toId) continue
			const connectionId = createShapeId()
			editor.createShape({
				id: connectionId,
				type: 'connection',
				props: { start: { x: 0, y: 0 }, end: { x: 80, y: 0 } },
			})
			editor.createBinding({
				id: createBindingId(),
				type: 'connection',
				fromId: connectionId,
				toId: fromId,
				props: { terminal: 'start', portId: wire.fromPort, order: 0 },
			})
			editor.createBinding({
				id: createBindingId(),
				type: 'connection',
				fromId: connectionId,
				toId: toId,
				props: { terminal: 'end', portId: wire.toPort, order: 1 },
			})
		}
	})
}
