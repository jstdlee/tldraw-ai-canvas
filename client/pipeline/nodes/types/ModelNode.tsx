import { T, useEditor } from 'tldraw'
import { getModelLabel, ModelSelect } from '../../../ai/aiConfig'
import { ModelIcon } from '../../components/icons/ModelIcon'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEIGHT_PX, NODE_WIDTH_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import {
	ExecutionResult,
	InfoValues,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	updateNode,
} from './shared'

/**
 * Picks an image model from the user's AI providers (see "AI providers").
 * The output is a model key; an empty key means "the default image model".
 */
export type ModelNode = T.TypeOf<typeof ModelNode>
export const ModelNode = T.object({
	type: T.literal('model'),
	modelKey: T.string,
})

export class ModelNodeDefinition extends NodeDefinition<ModelNode> {
	static type = 'model'
	static validator = ModelNode
	title = 'Image model'
	heading = 'Model'
	icon = <ModelIcon />
	category = 'input'
	getDefault(): ModelNode {
		return { type: 'model', modelKey: '' }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX
	}
	getPorts(): Record<string, ShapePort> {
		return {
			output: {
				id: 'output',
				x: NODE_WIDTH_PX,
				y: NODE_HEADER_HEIGHT_PX / 2,
				terminal: 'start',
				dataType: 'model',
			},
		}
	}
	async execute(_shape: NodeShape, node: ModelNode): Promise<ExecutionResult> {
		return { output: node.modelKey }
	}
	getOutputInfo(shape: NodeShape, node: ModelNode): InfoValues {
		return {
			output: {
				value: node.modelKey || getModelLabel(null, 'image'),
				isOutOfDate: shape.props.isOutOfDate,
				dataType: 'model',
			},
		}
	}
	Component = ModelNodeComponent
}

function ModelNodeComponent({ shape, node }: NodeComponentProps<ModelNode>) {
	const editor = useEditor()
	return (
		<NodeRow>
			<span className="NodeInputRow-label">Model</span>
			<ModelSelect
				className="node-model-select"
				capability="image"
				value={node.modelKey}
				onChange={(modelKey) => updateNode<ModelNode>(editor, shape, (n) => ({ ...n, modelKey }))}
			/>
		</NodeRow>
	)
}
