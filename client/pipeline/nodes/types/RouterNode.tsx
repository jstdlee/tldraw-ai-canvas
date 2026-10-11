import { categoryOf } from '../../../../shared/nodeGroups'
import { T } from 'tldraw'
import { RouterIcon } from '../../components/icons/RouterIcon'
import {
	getNodeRowHeightPx,
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
	NODE_WIDTH_PX,
} from '../../constants'
import { Port, ShapePort } from '../../ports/Port'
import { useFieldPortAnchor } from '../../ports/useFieldPortAnchor'
import { NodeShape } from '../NodeShapeUtil'
import { WireField } from './fields'
import {
	ExecutionResult,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodePortLabel,
	NodeRow,
} from './shared'

export type RouterNode = T.TypeOf<typeof RouterNode>
export const RouterNode = T.object({
	type: T.literal('router'),
	outputCount: T.number,
})

export class RouterNodeDefinition extends NodeDefinition<RouterNode> {
	static type = 'router'
	static validator = RouterNode
	title = 'Router'
	heading = 'Router'
	hidden = true as const
	icon = <RouterIcon />
	category = categoryOf('router')
	getDefault(): RouterNode {
		return {
			type: 'router',
			outputCount: 3,
		}
	}
	getBodyHeightPx(shape: NodeShape, node: RouterNode) {
		// 1 input row + outputCount row (WP17) + N output rows
		return getNodeRowHeightPx(shape.props.fontSize) * (2 + node.outputCount)
	}
	getPorts(shape: NodeShape, node: RouterNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const baseY = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
		const ports: Record<string, ShapePort> = {
			input: {
				id: 'input',
				x: 0,
				y: baseY + rowPx * 0.5,
				terminal: 'end',
				dataType: 'any',
			},
		}
		for (let i = 0; i < node.outputCount; i++) {
			ports[`out_${i}`] = {
				id: `out_${i}`,
				// +1 row (WP17): outputCount got its own row between input and the outputs.
				x: NODE_WIDTH_PX,
				y: baseY + rowPx * (2.5 + i),
				terminal: 'start',
				dataType: 'any',
			}
		}
		return ports
	}
	async execute(
		_shape: NodeShape,
		node: RouterNode,
		inputs: InputValues
	): Promise<ExecutionResult> {
		const value = (inputs.input as string | number | null) ?? null
		const result: ExecutionResult = {}
		for (let i = 0; i < node.outputCount; i++) {
			result[`out_${i}`] = value
		}
		return result
	}
	getOutputInfo(shape: NodeShape, node: RouterNode, inputs: InfoValues): InfoValues {
		const inputInfo = inputs.input
		const result: InfoValues = {}
		for (let i = 0; i < node.outputCount; i++) {
			if (inputInfo) {
				// Router input is always single; forward the value to each output.
				const singleValue = inputInfo.multi ? inputInfo.value[0] : inputInfo.value
				result[`out_${i}`] = {
					value: singleValue,
					isOutOfDate: inputInfo.isOutOfDate || shape.props.isOutOfDate,
					dataType: inputInfo.dataType,
				}
			} else {
				result[`out_${i}`] = {
					value: null,
					isOutOfDate: shape.props.isOutOfDate,
					dataType: 'any',
				}
			}
		}
		return result
	}
	Component = RouterNodeComponent
}

function RouterNodeComponent({ shape, node }: NodeComponentProps<RouterNode>) {
	return (
		<>
			<NodeRow>
				<span
					className="Port Port_end"
					style={{ '--port-color': 'var(--port-color-any)' } as React.CSSProperties}
				/>
				<NodePortLabel dataType="any">Input</NodePortLabel>
				<span className="NodeRow-connected-value">{node.outputCount} outputs</span>
			</NodeRow>
			<WireField shapeId={shape.id} fieldKey="outputCount" label="Outputs" dataType="number">
				<span className="NodeRow-disconnected">{node.outputCount} output ports</span>
			</WireField>
			{Array.from({ length: node.outputCount }, (_, i) => (
				<RouterOutputRow key={i} shapeId={shape.id} index={i} />
			))}
		</>
	)
}

/** WP21 Part A: each `out_<i>` port was defined in `getPorts` but never had a visible `<Port>`. */
function RouterOutputRow({ shapeId, index }: { shapeId: NodeShape['id']; index: number }) {
	const portId = `out_${index}`
	const ref = useFieldPortAnchor<HTMLDivElement>(shapeId, portId)
	return (
		<NodeRow ref={ref} className="NodeRow-right">
			<NodePortLabel dataType="any">Out {index + 1}</NodePortLabel>
			<Port shapeId={shapeId} portId={portId} />
		</NodeRow>
	)
}
