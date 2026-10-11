import { categoryOf } from '../../../../shared/nodeGroups'
import { T, TLShapeId, useEditor } from 'tldraw'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, PortDataType } from '../../constants'
import { ExecutionGraph } from '../../execution/ExecutionGraph'
import { ShapePort } from '../../ports/Port'
import { openGroup } from '../../subgraph'
import { shapeText } from '../../../clips/shapeText'
import { concatMemberText } from '../../../../shared/groupText'
import { Port } from '../../ports/Port'
import { useFieldPortAnchor } from '../../ports/useFieldPortAnchor'
import type { NodeShape } from '../NodeShapeUtil'
import { IconGroup, UiButton, UiEmpty } from '../../../ui'
import { stopEvent } from './fields'
import {
	areAnyInputsOutOfDate,
	ExecutionResult,
	getInput,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodePortLabel,
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
	/** Connection shapes fully inside the box (both ends members); hidden and restored with them. */
	connectionIds: T.arrayOf(T.string).optional(),
})

const BOX_WIDTH_PX = 360
const THUMB_PX = 170
const BASE_Y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX

/**
 * A group shown as a box: port rows (inputs left, outputs right, same row index so the
 * dots line up with their labels), a thumbnail of its members, and an Open button.
 * Double-click (or "Open group") opens it in place; "Ungroup box" dissolves it.
 */
export class SubgraphNodeDefinition extends NodeDefinition<SubgraphNode> {
	static type = 'subgraph'
	static validator = SubgraphNode
	title = 'Group box'
	heading = 'Box'
	icon = <IconGroup />
	category = categoryOf('subgraph')
	override hidden = true
	resultKeys = ['lastOutputs', 'error'] as const
	getDefault(): SubgraphNode {
		return {
			type: 'subgraph',
			title: 'Group (0 cards)',
			innerIds: [],
			inputs: [],
			outputs: [],
			thumbnail: null,
			lastOutputs: null,
			error: null,
			connectionIds: [],
		}
	}
	override getWidthPx() {
		return BOX_WIDTH_PX
	}
	private rows(node: SubgraphNode) {
		return Math.max(node.inputs.length, node.outputs.length, 1)
	}
	getBodyHeightPx(shape: NodeShape, node: SubgraphNode) {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return rowPx * this.rows(node) + THUMB_PX + rowPx
	}
	getPorts(shape: NodeShape, node: SubgraphNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const ports: Record<string, ShapePort> = {}
		node.inputs.forEach((p, i) => {
			ports[p.id] = { id: p.id, x: 0, y: BASE_Y + rowPx * (i + 0.5), terminal: 'end', dataType: p.dataType }
		})
		node.outputs.forEach((p, i) => {
			ports[p.id] = {
				id: p.id,
				x: this.getWidthPx(),
				y: BASE_Y + rowPx * (i + 0.5),
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
		return Object.fromEntries(node.outputs.map((p) => [p.id, { value: last[p.id] ?? null, isOutOfDate, dataType: p.dataType }]))
	}
	Component = SubgraphNodeComponent
}

/** Anchors one of SubgraphNode's dynamically-numbered ports to its own cell. */
function SubgraphPortCell({
	shapeId,
	portId,
	className,
	children,
}: {
	shapeId: NodeShape['id']
	portId: string
	className: string
	children: React.ReactNode
}) {
	const ref = useFieldPortAnchor<HTMLSpanElement>(shapeId, portId)
	return (
		<span ref={ref} className={className}>
			{children}
		</span>
	)
}

function SubgraphNodeComponent({ shape, node }: NodeComponentProps<SubgraphNode>) {
	const editor = useEditor()
	const rows = Math.max(node.inputs.length, node.outputs.length, 1)
	return (
		<>
			{Array.from({ length: rows }, (_, i) => {
				const input = node.inputs[i]
				const output = node.outputs[i]
				return (
					<NodeRow key={i} className="Subgraph-portRow">
						{input ? (
							<SubgraphPortCell shapeId={shape.id} portId={input.id} className="Subgraph-portCell Subgraph-portCell-in">
								<Port shapeId={shape.id} portId={input.id} />
								<NodePortLabel dataType={input.dataType}>
									<span className="Subgraph-portLabel" title={input.label}>
										{input.label}
									</span>
								</NodePortLabel>
							</SubgraphPortCell>
						) : (
							<span className="Subgraph-portCell Subgraph-portCell-in" />
						)}
						{output ? (
							<SubgraphPortCell shapeId={shape.id} portId={output.id} className="Subgraph-portCell Subgraph-portCell-out">
								<NodePortLabel dataType={output.dataType}>
									<span className="Subgraph-portLabel" title={output.label}>
										{output.label}
									</span>
								</NodePortLabel>
								<Port shapeId={shape.id} portId={output.id} />
							</SubgraphPortCell>
						) : (
							<span className="Subgraph-portCell Subgraph-portCell-out" />
						)}
					</NodeRow>
				)
			})}
			<div
				className="Subgraph-thumb NodeGrow"
				style={{ height: THUMB_PX }}
				onPointerDown={stopEvent}
				onDoubleClick={() => openGroup(editor, shape.id)}
				title="Double-click to open"
			>
				{node.thumbnail ? (
					<img src={node.thumbnail} alt="group members" draggable={false} />
				) : (
					<UiEmpty icon={<IconGroup />} text={`${node.innerIds.length} card${node.innerIds.length === 1 ? '' : 's'} inside`} />
				)}
			</div>
			<NodeRow className="Subgraph-footer">
				<span className="Subgraph-count">
					{node.innerIds.length} card{node.innerIds.length === 1 ? '' : 's'} inside
				</span>
				<UiButton size="sm" label="Open" onClick={() => openGroup(editor, shape.id)} />
			</NodeRow>
		</>
	)
}
