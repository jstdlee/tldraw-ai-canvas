import { categoryOf } from '../../../../shared/nodeGroups'
import { T, useEditor } from 'tldraw'
import { PromptIcon } from '../../components/icons/PromptIcon'
import { TextAreaField } from '../../editors/CodeArea'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { sleep } from '../../utils/sleep'
import { NodeShape } from '../NodeShapeUtil'
import { useInputConnected, WireFieldHeader } from './fields'
import {
	ExecutionResult,
	InfoValues,
	NodeComponentProps,
	NodeDefinition,
	updateNode,
} from './shared'

export type PromptNode = T.TypeOf<typeof PromptNode>
export const PromptNode = T.object({
	type: T.literal('prompt'),
	text: T.string,
})

export class PromptNodeDefinition extends NodeDefinition<PromptNode> {
	static type = 'prompt'
	static validator = PromptNode
	title = 'Prompt'
	heading = 'Prompt'
	icon = <PromptIcon />
	category = categoryOf('prompt')
	override defaultWidthPx = 380
	getDefault(): PromptNode {
		return {
			type: 'prompt',
			text: 'a photo of a cat sitting on a windowsill',
		}
	}
	getBodyHeightPx(shape: NodeShape) {
		// A label row (WP17: "text" is wirable) above a growing text box, roomy enough at the
		// default font not to feel crowded.
		return getNodeRowHeightPx(shape.props.fontSize) * 4
	}
	getPorts(shape: NodeShape, node: PromptNode): Record<string, ShapePort> {
		return {
			output: {
				id: 'output',
				x: this.getWidthPx(shape, node),
				y: NODE_HEADER_HEIGHT_PX / 2,
				terminal: 'start',
				dataType: 'text',
			},
		}
	}
	async execute(_shape: NodeShape, node: PromptNode): Promise<ExecutionResult> {
		await sleep(200)
		return { output: node.text }
	}
	getOutputInfo(shape: NodeShape, node: PromptNode): InfoValues {
		return {
			output: {
				value: node.text,
				isOutOfDate: shape.props.isOutOfDate,
				dataType: 'text',
			},
		}
	}
	Component = PromptNodeComponent
}

function PromptNodeComponent({ shape, node }: NodeComponentProps<PromptNode>) {
	const editor = useEditor()
	const textWired = useInputConnected(shape.id, 'field:text')
	return (
		<>
			<WireFieldHeader shapeId={shape.id} fieldKey="text" label="Text" />
			{!textWired && (
				<div className="NodeGrow PromptNode-row">
					<TextAreaField
						title="Prompt"
						placeholder="Enter your prompt..."
						value={node.text}
						onChange={(text) => updateNode<PromptNode>(editor, shape, (n) => ({ ...n, text }), false)}
					/>
				</div>
			)}
		</>
	)
}
