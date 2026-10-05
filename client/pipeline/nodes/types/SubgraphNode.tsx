import { categoryOf } from '../../../../shared/nodeGroups'
import { T, TldrawUiButton, TLShapeId, useEditor } from 'tldraw'
import { TemplateIcon } from '../../components/icons/TemplateIcon'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_ROW_HEIGHT_PX, NODE_WIDTH_PX, PortDataType } from '../../constants'
import { ExecutionGraph } from '../../execution/ExecutionGraph'
import { ShapePort } from '../../ports/Port'
import { unpack } from '../../subgraph'
import { shapeText } from '../../../clips/shapeText'
import { concatMemberText } from '../../../../shared/groupText'
import { Port } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import { PortRow, stopEvent } from './fields'
import {
	areAnyInputsOutOfDate,
	ExecutionResult,
	getInput,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	PipelineValue,
	STOP_EXECUTION,
	updateNode,
} from './shared'

export interface SubgraphPort {
	id: string
	label: string
	dataType: PortDataType
	/** The inner node and port this outer port stands for. */
	nodeId: string
	portId: string
}

const SubgraphPortValidator = T.object({
	id: T.string,
	label: T.string,
	dataType: T.string,
	nodeId: T.string,
	portId: T.string,
}) as unknown as T.Validator<SubgraphPort>

export type SubgraphNode = T.TypeOf<typeof SubgraphNode>
export const SubgraphNode = T.object({
	type: T.literal('subgraph'),
	title: T.string,
	innerIds: T.arrayOf(T.string),
	inputs: T.arrayOf(SubgraphPortValidator),
	outputs: T.arrayOf(SubgraphPortValidator),
	thumbnail: T.string.nullable(),
	lastOutputs: T.string.nullable(),
	error: T.string.nullable(),
})

const THUMB_PX = 150
const RESULT_PX = 90
const BASE_Y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX

/**
 * A packed group of nodes: shows a thumbnail, exposes only the inputs that came
 * from outside and the final outputs. Double-click (or "Unpack") to open it.
 */
export class SubgraphNodeDefinition extends NodeDefinition<SubgraphNode> {
	static type = 'subgraph'
	static validator = SubgraphNode
	title = 'Packed group'
	heading = 'Packed'
	icon = <TemplateIcon />
	category = categoryOf('subgraph')
	override hidden = true
	resultKeys = ['lastOutputs', 'error'] as const
	getDefault(): SubgraphNode {
		return { type: 'subgraph', title: 'Packed', innerIds: [], inputs: [], outputs: [], thumbnail: null, lastOutputs: null, error: null }
	}
	override getWidthPx() {
		return 300
	}
	private rows(node: SubgraphNode) {
		return Math.max(node.inputs.length, node.outputs.length - 1, 0)
	}
	getBodyHeightPx(_shape: NodeShape, node: SubgraphNode) {
		return NODE_ROW_HEIGHT_PX * (Math.max(this.rows(node), 1) + 1) + THUMB_PX
	}
	getPorts(_shape: NodeShape, node: SubgraphNode): Record<string, ShapePort> {
		const ports: Record<string, ShapePort> = {}
		const inputs = node.inputs.length ? node.inputs : [{ id: 'input', label: 'In', dataType: 'any' as const, nodeId: '', portId: 'input' }]
		const outputs = node.outputs.length ? node.outputs : [{ id: 'output', label: 'Out', dataType: 'any' as const, nodeId: '', portId: 'output' }]
		inputs.forEach((p, i) => {
			ports[p.id] = { id: p.id, x: 0, y: BASE_Y + NODE_ROW_HEIGHT_PX * (i + 0.5), terminal: 'end', dataType: p.dataType }
		})
		outputs.forEach((p, i) => {
			ports[p.id] = {
				id: p.id,
				x: this.getWidthPx(),
				y: BASE_Y + NODE_ROW_HEIGHT_PX * (i + 0.5),
				terminal: 'start',
				dataType: p.dataType,
			}
		})
		return ports
	}
	async execute(shape: NodeShape, node: SubgraphNode, inputs: InputValues): Promise<ExecutionResult> {
		const inner = new Set(node.innerIds as TLShapeId[])
		const overrides = new Map<string, PipelineValue>()
		for (const p of node.inputs) {
			const v = getInput(inputs, p.id)
			if (v != null) overrides.set(`${p.nodeId}|${p.portId}`, v as PipelineValue)
		}
		try {
			const graph = new ExecutionGraph(this.editor, inner, { allowed: inner, overrides })
			await graph.execute()
			const result: ExecutionResult = {}
			const saved: Record<string, string | null> = {}
			const members = concatMemberText(
				node.innerIds.map((id) => {
					const child = this.editor.getShape(id as TLShapeId)
					return child ? shapeText(this.editor, child) : ''
				})
			)
			for (const p of node.outputs) {
				const v = graph.getOutputs(p.nodeId as TLShapeId)?.[p.portId]
				result[p.id] = v === undefined ? STOP_EXECUTION : v
				saved[p.id] = v == null || v === STOP_EXECUTION ? null : String(v)
			}
			if (!node.outputs.length) {
				result.output = members
				saved.output = members
			}
			updateNode<SubgraphNode>(this.editor, shape, (n) => ({ ...n, lastOutputs: JSON.stringify(saved), error: null }))
			return result
		} catch (e) {
			updateNode<SubgraphNode>(this.editor, shape, (n) => ({ ...n, error: (e as Error).message }), false)
			return Object.fromEntries(node.outputs.map((p) => [p.id, STOP_EXECUTION]))
		}
	}
	getOutputInfo(shape: NodeShape, node: SubgraphNode, inputs: InfoValues): InfoValues {
		const last = node.lastOutputs ? (JSON.parse(node.lastOutputs) as Record<string, string | null>) : {}
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		const outputs = node.outputs.length ? node.outputs : [{ id: 'output', dataType: 'text' as const }]
		return Object.fromEntries(outputs.map((p) => [p.id, { value: last[p.id] ?? null, isOutOfDate, dataType: p.dataType }]))
	}
	Component = SubgraphNodeComponent
}

function SubgraphNodeComponent({ shape, node }: NodeComponentProps<SubgraphNode>) {
	const editor = useEditor()
	const inputs = node.inputs.length ? node.inputs : [{ id: 'input', label: 'In', dataType: 'any' as const }]
	const outputs = node.outputs.length ? node.outputs : [{ id: 'output', label: 'Out', dataType: 'any' as const }]
	return (
		<>
			{inputs.map((port) => (
				<PortRow key={port.id} shapeId={shape.id} portId={port.id} label={port.label} dataType={port.dataType} hint="" />
			))}
			{outputs.map((port) => (
				<div key={port.id} className="NodeRow NodeRow-right">
					<span className="CodeNode-outLabel">{port.label} →</span>
					<Port shapeId={shape.id} portId={port.id} />
				</div>
			))}
			<div className="Subgraph-thumb NodeGrow" style={{ height: THUMB_PX }} onDoubleClick={() => unpack(editor, shape.id)} title="Double-click to unpack">
				{node.thumbnail ? <img src={node.thumbnail} alt="packed nodes" draggable={false} /> : <span className="NodeRow-disconnected">{node.innerIds.length} shapes inside</span>}
			</div>
			<NodeRow>
				<input
					className="NodeField-input"
					value={node.title}
					onPointerDown={stopEvent}
					onKeyDown={stopEvent}
					onChange={(e) => updateNode<SubgraphNode>(editor, shape, (n) => ({ ...n, title: e.target.value }), false)}
				/>
				<TldrawUiButton type="normal" onPointerDown={stopEvent} onClick={() => unpack(editor, shape.id)}>
					Unpack
				</TldrawUiButton>
			</NodeRow>
			{node.error && <span className="NodeStatus is-error">{node.error}</span>}
		</>
	)
}
