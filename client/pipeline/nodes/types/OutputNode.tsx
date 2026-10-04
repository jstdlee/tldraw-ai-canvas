import { T, useEditor } from 'tldraw'
import { ContentKind } from '../../../../shared/contentKind'
import { PreviewIcon } from '../../components/icons/PreviewIcon'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_ROW_HEIGHT_PX, NODE_WIDTH_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { ValuePreview } from '../../ValuePreview'
import { NodeShape } from '../NodeShapeUtil'
import { PortRow, stopEvent } from './fields'
import {
	areAnyInputsOutOfDate,
	coerceToText,
	ExecutionResult,
	getInput,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	updateNode,
} from './shared'

/**
 * Shows whatever reaches it — text, image, Markdown, Mermaid, JSON or a link —
 * and passes it on. Draw a tldraw arrow from its output to any shape to put the
 * value on the canvas.
 */
export type OutputNode = T.TypeOf<typeof OutputNode>
export const OutputNode = T.object({
	type: T.literal('output'),
	kind: T.string,
	lastValue: T.string.nullable(),
})

const VIEW_HEIGHT_PX = 240
const KINDS: { id: ContentKind | 'auto'; label: string }[] = [
	{ id: 'auto', label: 'Auto' },
	{ id: 'text', label: 'Text' },
	{ id: 'markdown', label: 'Markdown' },
	{ id: 'mermaid', label: 'Mermaid' },
	{ id: 'image', label: 'Image' },
	{ id: 'url', label: 'Link' },
	{ id: 'json', label: 'JSON' },
]

export class OutputNodeDefinition extends NodeDefinition<OutputNode> {
	static type = 'output'
	static validator = OutputNode
	title = 'Output'
	heading = 'Output'
	icon = <PreviewIcon />
	category = 'output'
	resultKeys = ['lastValue'] as const
	getDefault(): OutputNode {
		return { type: 'output', kind: 'auto', lastValue: null }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 2 + VIEW_HEIGHT_PX
	}
	getPorts(): Record<string, ShapePort> {
		return {
			input: {
				id: 'input',
				x: 0,
				y: NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX + NODE_ROW_HEIGHT_PX * 0.5,
				terminal: 'end',
				dataType: 'any',
			},
			output: { id: 'output', x: NODE_WIDTH_PX, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'any' },
		}
	}
	async execute(shape: NodeShape, _node: OutputNode, inputs: InputValues): Promise<ExecutionResult> {
		const value = coerceToText(getInput(inputs, 'input'))
		updateNode<OutputNode>(this.editor, shape, (n) => ({ ...n, lastValue: value }))
		return { output: value }
	}
	getOutputInfo(shape: NodeShape, node: OutputNode, inputs: InfoValues): InfoValues {
		const live = inputs.input && !Array.isArray(inputs.input.value) ? inputs.input.value : null
		return {
			output: {
				value: typeof live === 'string' || typeof live === 'number' ? live : node.lastValue,
				isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
				dataType: 'any',
			},
		}
	}
	Component = OutputNodeComponent
}

function OutputNodeComponent({ shape, node }: NodeComponentProps<OutputNode>) {
	const editor = useEditor()
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label="Value" dataType="any" />
			<NodeRow>
				<span className="NodeInputRow-label">Show as</span>
				<select
					className="NodeField-select"
					value={node.kind}
					onPointerDown={stopEvent}
					onChange={(e) => updateNode<OutputNode>(editor, shape, (n) => ({ ...n, kind: e.target.value }), false)}
				>
					{KINDS.map((k) => (
						<option key={k.id} value={k.id}>
							{k.label}
						</option>
					))}
				</select>
			</NodeRow>
			<div className="NodeGrow NodeOutputView" style={{ height: VIEW_HEIGHT_PX - 8 }}>
				{node.lastValue ? (
					<ValuePreview value={node.lastValue} kind={node.kind as ContentKind | 'auto'} />
				) : (
					<span className="NodeRow-disconnected">Connect a value and press ▶ Play</span>
				)}
			</div>
		</>
	)
}
