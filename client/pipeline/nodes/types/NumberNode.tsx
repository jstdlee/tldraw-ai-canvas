import { categoryOf } from '../../../../shared/nodeGroups'
import { T, TldrawUiSlider, useEditor } from 'tldraw'
import { NumberIcon } from '../../components/icons/NumberIcon'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { sleep } from '../../utils/sleep'
import { NodeShape } from '../NodeShapeUtil'
import { WireField } from './fields'
import {
	ExecutionResult,
	InfoValues,
	NodeComponentProps,
	NodeDefinition,
	updateNode,
} from './shared'

export type NumberNode = T.TypeOf<typeof NumberNode>
export const NumberNode = T.object({
	type: T.literal('number'),
	value: T.number,
})

export class NumberNodeDefinition extends NodeDefinition<NumberNode> {
	static type = 'number'
	static validator = NumberNode
	title = 'Number'
	heading = 'Number'
	hidden = true as const
	override defaultWidthPx = 280
	icon = <NumberIcon />
	category = categoryOf('number')
	getDefault(): NumberNode {
		return {
			type: 'number',
			value: 50,
		}
	}
	getBodyHeightPx(shape: NodeShape) {
		return getNodeRowHeightPx(shape.props.fontSize)
	}
	getPorts(shape: NodeShape, node: NumberNode): Record<string, ShapePort> {
		return {
			output: {
				id: 'output',
				x: this.getWidthPx(shape, node),
				y: NODE_HEADER_HEIGHT_PX / 2,
				terminal: 'start',
				dataType: 'number',
			},
		}
	}
	async execute(_shape: NodeShape, node: NumberNode): Promise<ExecutionResult> {
		await sleep(200)
		return { output: node.value }
	}
	getOutputInfo(shape: NodeShape, node: NumberNode): InfoValues {
		return {
			output: {
				value: node.value,
				isOutOfDate: shape.props.isOutOfDate,
				dataType: 'number',
			},
		}
	}
	Component = NumberNodeComponent
}

function NumberNodeComponent({ shape, node }: NodeComponentProps<NumberNode>) {
	const editor = useEditor()
	return (
		<WireField shapeId={shape.id} fieldKey="value" label="Value" dataType="number">
			<div className="NumberNode" onPointerDown={editor.markEventAsHandled}>
				<TldrawUiSlider
					steps={100}
					value={node.value}
					label="Value"
					title={node.value.toString()}
					onValueChange={(value) => {
						editor.setSelectedShapes([shape.id])
						updateNode<NumberNode>(editor, shape, (node) => ({ ...node, value }), false)
					}}
					onHistoryMark={() => {}}
				/>
			</div>
		</WireField>
	)
}
