import { T, TldrawUiButton, TLShapeId, useEditor } from 'tldraw'
import { TemplateIcon } from '../../components/icons/TemplateIcon'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_ROW_HEIGHT_PX, NODE_WIDTH_PX, PortDataType } from '../../constants'
import { ExecutionGraph } from '../../execution/ExecutionGraph'
import { ShapePort } from '../../ports/Port'
import { unpack } from '../../subgraph'
import { ValuePreview } from '../../ValuePreview'
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
	category = 'logic'
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
		return NODE_ROW_HEIGHT_PX * (this.rows(node) + 1) + THUMB_PX + RESULT_PX
	}
	getPorts(_shape: NodeShape, node: SubgraphNode): Record<string, ShapePort> {
		const ports: Record<string, ShapePort> = {}
		node.inputs.forEach((p, i) => {
			ports[p.id] = { id: p.id, x: 0, y: BASE_Y + NODE_ROW_HEIGHT_PX * (i + 0.5), terminal: 'end', dataType: p.dataType }
		})
		node.outputs.forEach((p, i) => {
			ports[p.id] =
				i === 0
					? { id: p.id, x: this.getWidthPx(), y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: p.dataType }
					: { id: p.id, x: this.getWidthPx(), y: BASE_Y + NODE_ROW_HEIGHT_PX * (i - 0.5), terminal: 'start', dataType: p.dataType }
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
			for (const p of node.outputs) {
				const v = graph.getOutputs(p.nodeId as TLShapeId)?.[p.portId]
				result[p.id] = v === undefined ? STOP_EXECUTION : v
				saved[p.id] = v == null || v === STOP_EXECUTION ? null : String(v)
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
		return Object.fromEntries(node.outputs.map((p) => [p.id, { value: last[p.id] ?? null, isOutOfDate, dataType: p.dataType }]))
	}
	Component = SubgraphNodeComponent
}

function SubgraphNodeComponent({ shape, node }: NodeComponentProps<SubgraphNode>) {
	const editor = useEditor()
	const rows = Math.max(node.inputs.length, node.outputs.length - 1, 0)
	const last = node.lastOutputs ? (JSON.parse(node.lastOutputs) as Record<string, string | null>) : {}
	const firstValue = node.outputs.map((p) => last[p.id]).find((v) => v)
	return (
		<>
			{Array.from({ length: rows }, (_, i) => (
				<div key={i} className="CodeNode-portRow">
					{node.inputs[i] ? (
						<PortRow shapeId={shape.id} portId={node.inputs[i].id} label={node.inputs[i].label} dataType={node.inputs[i].dataType} hint="" />
					) : (
						<NodeRow>{null}</NodeRow>
					)}
					{node.outputs[i + 1] && <span className="CodeNode-outLabel">{node.outputs[i + 1].label} →</span>}
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
			<div className="NodeOutputView" style={{ height: RESULT_PX - 8 }}>
				{node.error ? (
					<span className="NodeStatus is-error">{node.error}</span>
				) : firstValue ? (
					<ValuePreview value={firstValue} />
				) : (
					<span className="NodeRow-disconnected">{node.outputs.length ? `Out: ${node.outputs[0].label}` : 'No outputs'}</span>
				)}
			</div>
		</>
	)
}
