import { atom, createBindingId, createShapeId, Editor, TLShapeId } from 'tldraw'
import { allowedProps, parseAssistPlan, type AssistPlan } from '../../shared/nodeAssist'
import { catalogPrompt, NODE_PORTS } from '../../shared/nodeCatalog'
import { featurePrompt } from '../../shared/featureList'
import { shapeText } from '../clips/shapeText'
import { apiGenerateText } from './api/pipelineApi'
import { getNodeDefinition, NodeType } from './nodes/nodeTypes'
import { NodeShape } from './nodes/NodeShapeUtil'
import { getNodePortConnections } from './nodes/nodePorts'

export const $assist = atom<{ mode: 'fill'; shapeId: TLShapeId } | { mode: 'compose'; shapeIds: TLShapeId[] } | null>(
	'node assist',
	null
)

/** Answer text for a selection that is not a node. Shown in a dialog, not on the canvas. */
export const $aiNote = atom<string | null>('ai note', null)

/**
 * Draft text per node, so closing the AI-star card and reopening it brings back
 * what you were typing. Keyed by shape id.
 */
export const $assistDrafts = atom<Record<string, string>>('assist drafts', {})

export interface AssistResult {
	direction: string
	changed: boolean
}

export function assistDraft(shapeId: TLShapeId): string {
	return $assistDrafts.get()[shapeId] ?? ''
}

export function setAssistDraft(shapeId: TLShapeId, text: string) {
	$assistDrafts.update((drafts) => {
		const next = { ...drafts }
		if (text) next[shapeId] = text
		else delete next[shapeId]
		return next
	})
}

export function openFillAssist(shapeId: TLShapeId) {
	$assist.set({ mode: 'fill', shapeId })
}

export function openComposeAssist(shapeIds: TLShapeId[]) {
	$assist.set({ mode: 'compose', shapeIds })
}

const ASSIST_SYSTEM =
	'You improve workflow nodes. Read each node\'s properties, attributes, wires, and the user prompt. ' +
	'Reply with JSON only:\n' +
	'{"direction":"one sentence","props":{},"updates":[{"id":"shape id","props":{}}],' +
	'"add":[{"tempId":"n1","type":"prompt","props":{},"x":360,"y":0}],' +
	'"connect":[{"from":"id or tempId","fromPort":"output","to":"id or tempId","toPort":"input"}]}\n' +
	'direction is the change or the next step. props fills the one selected node. ' +
	'updates fills the listed nodes. add and connect when the request needs another node or a wire. ' +
	'Use only fields and ports from the catalog. Do not change type. Omit keys you do not change. ' +
	'A direction alone is valid when you only advise. ' +
	'The catalog is a static list of this app. It is not a live MCP server.\n\n' +
	catalogPrompt() +
	'\n\nApp features:\n' +
	featurePrompt()

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

function describeNode(editor: Editor, shape: NodeShape) {
	const wires = getNodePortConnections(editor, shape).map((link) => {
		const other = editor.getShape(link.connectedShapeId)
		const otherType =
			other?.type === 'node' ? (other.props as { node?: { type?: string } }).node?.type : other?.type
		return {
			direction: link.terminal === 'end' ? 'in' : 'out',
			port: link.ownPortId,
			otherId: link.connectedShapeId,
			otherType: otherType ?? 'shape',
			otherPort: link.connectedPortId,
		}
	})
	return { ...nodeSummary(shape), wires }
}

/** Defaults plus catalog fields, so an optional key such as promptOverride can be set. */
function fieldBase(editor: Editor, node: Record<string, unknown>): Record<string, unknown> {
	const type = typeof node.type === 'string' ? node.type : ''
	let defaults: Record<string, unknown> = {}
	try {
		if (type) defaults = getNodeDefinition(editor, type as NodeType['type']).getDefault() as unknown as Record<string, unknown>
	} catch {
		defaults = {}
	}
	const base: Record<string, unknown> = { ...defaults, ...node }
	for (const key of NODE_PORTS[type]?.fields ?? []) {
		if (!(key in base)) base[key] = ''
	}
	return base
}

function writeProps(editor: Editor, shape: NodeShape, patch: Record<string, unknown>): boolean {
	const node = shape.props.node as unknown as Record<string, unknown>
	const props = allowedProps(fieldBase(editor, node), patch)
	if (!Object.entries(props).some(([key, value]) => node[key] !== value)) return false
	editor.updateShape<NodeShape>({
		id: shape.id,
		type: 'node',
		props: { node: { ...shape.props.node, ...props } as NodeType, isOutOfDate: true },
	})
	return true
}

function applyPlan(editor: Editor, shapes: NodeShape[], plan: AssistPlan): boolean {
	const ids = new Map<string, TLShapeId>()
	for (const shape of shapes) ids.set(shape.id, shape.id)
	let changed = false
	editor.markHistoryStoppingPoint('ai arrange nodes')
	editor.run(() => {
		const updates = [...plan.updates]
		if (shapes.length === 1 && Object.keys(plan.props).length) updates.push({ id: shapes[0].id, props: plan.props })
		for (const update of updates) {
			const shape = editor.getShape(update.id as TLShapeId)
			if (!shape || shape.type !== 'node') continue
			if (writeProps(editor, shape, update.props)) changed = true
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
			changed = true
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
			changed = true
		}
	})
	return changed
}

async function askModel(editor: Editor, shapes: NodeShape[], intent: string): Promise<AssistResult> {
	const { text } = await apiGenerateText({
		temperature: 0.2,
		system: ASSIST_SYSTEM,
		prompt: `Selected nodes:\n${JSON.stringify(shapes.map((shape) => describeNode(editor, shape)), null, 2)}\n\nSelection text:\n${shapes
			.map((shape) => shapeText(editor, shape))
			.filter(Boolean)
			.join('\n---\n')}\n\nThe user wants: ${intent}`,
	})
	const plan = parseAssistPlan(text)
	const changed = applyPlan(editor, shapes, plan)
	if (!changed && !plan.direction) throw new Error('The model did not change the node')
	return { direction: plan.direction, changed }
}

export async function runFill(editor: Editor, shapeId: TLShapeId, intent: string): Promise<AssistResult> {
	const shape = editor.getShape(shapeId)
	if (!shape || shape.type !== 'node') throw new Error('Select a node')
	return askModel(editor, [shape], intent)
}

export async function runCompose(editor: Editor, shapeIds: TLShapeId[], intent: string): Promise<AssistResult> {
	const shapes = shapeIds
		.map((id) => editor.getShape(id))
		.filter((shape): shape is NodeShape => !!shape && shape.type === 'node')
	if (!shapes.length) throw new Error('Select one or more nodes')
	return askModel(editor, shapes, intent)
}
