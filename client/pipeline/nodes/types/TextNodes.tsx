import { categoryOf } from '../../../../shared/nodeGroups'
import { T, useEditor } from 'tldraw'
import { runTextTool, TEXT_TOOL_OPS, TextToolOp } from '../../../../shared/textTools'
import { PromptConcatIcon } from '../../components/icons/PromptConcatIcon'
import {
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
	NODE_ROW_HEIGHT_PX,
	NODE_WIDTH_PX,
} from '../../constants'
import { ShapePort } from '../../ports/Port'
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
	STOP_EXECUTION,
	updateNode,
} from './shared'

const BASE_Y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX

// ---------------------------------------------------------------------------
// Text tools: find/replace, regex, template, JSON path, split… (no AI)
// ---------------------------------------------------------------------------

export type TextToolNode = T.TypeOf<typeof TextToolNode>
export const TextToolNode = T.object({
	type: T.literal('text_tool'),
	op: T.string,
	a: T.string,
	b: T.string,
	lastResultText: T.string.nullable(),
	error: T.string.nullable(),
})

const TOOL_RESULT_HEIGHT_PX = 96

export class TextToolNodeDefinition extends NodeDefinition<TextToolNode> {
	static type = 'text_tool'
	static validator = TextToolNode
	title = 'Text tools'
	heading = 'Text tools'
	icon = <PromptConcatIcon />
	category = categoryOf('text_tool')
	resultKeys = ['lastResultText', 'error'] as const
	getDefault(): TextToolNode {
		return { type: 'text_tool', op: 'template', a: '{{input}}', b: '', lastResultText: null, error: null }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 5
	}
	getPorts(): Record<string, ShapePort> {
		return {
			input: { id: 'input', x: 0, y: BASE_Y + NODE_ROW_HEIGHT_PX * 0.5, terminal: 'end', dataType: 'any' },
			input2: { id: 'input2', x: 0, y: BASE_Y + NODE_ROW_HEIGHT_PX * 1.5, terminal: 'end', dataType: 'any' },
			output: { id: 'output', x: NODE_WIDTH_PX, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: TextToolNode, inputs: InputValues): Promise<ExecutionResult> {
		try {
			const text = runTextTool(
				node.op as TextToolOp,
				coerceToText(getInput(inputs, 'input')),
				node.a,
				node.b,
				coerceToText(getInput(inputs, 'input2'))
			)
			updateNode<TextToolNode>(this.editor, shape, (n) => ({ ...n, lastResultText: text, error: null }))
			return { output: text }
		} catch (e) {
			updateNode<TextToolNode>(this.editor, shape, (n) => ({ ...n, error: (e as Error).message }), false)
			return { output: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: TextToolNode, inputs: InfoValues): InfoValues {
		return {
			output: {
				value: node.lastResultText,
				isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
				dataType: 'text',
			},
		}
	}
	Component = TextToolNodeComponent
}

function TextToolNodeComponent({ shape, node }: NodeComponentProps<TextToolNode>) {
	const editor = useEditor()
	const op = TEXT_TOOL_OPS.find((o) => o.id === node.op) ?? TEXT_TOOL_OPS[0]
	const set = (patch: Partial<TextToolNode>) =>
		updateNode<TextToolNode>(editor, shape, (n) => ({ ...n, ...patch }))
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label="Input" dataType="any" />
			<PortRow shapeId={shape.id} portId="input2" label="Input 2" dataType="any" hint="optional" />
			<NodeRow>
				<span className="NodeInputRow-label">Tool</span>
				<select
					className="NodeField-select"
					value={node.op}
					onPointerDown={stopEvent}
					onChange={(e) => set({ op: e.target.value, a: '', b: '' })}
				>
					{[...new Set(TEXT_TOOL_OPS.map((o) => o.group))].map((group) => (
						<optgroup key={group} label={group}>
							{TEXT_TOOL_OPS.filter((o) => o.group === group).map((o) => (
								<option key={o.id} value={o.id}>
									{o.label}
								</option>
							))}
						</optgroup>
					))}
				</select>
			</NodeRow>
			{(['a', 'b'] as const).map((key) => (
				<NodeRow key={key}>
					{op[key] ? (
						<input
							className="NodeField-input"
							placeholder={op[key]}
							value={node[key]}
							onPointerDown={stopEvent}
							onKeyDown={stopEvent}
							onChange={(e) => set({ [key]: e.target.value })}
						/>
					) : (
						<span className="NodeRow-disconnected">{key === 'a' ? 'no options' : ''}</span>
					)}
				</NodeRow>
			))}
		</>
	)
}
