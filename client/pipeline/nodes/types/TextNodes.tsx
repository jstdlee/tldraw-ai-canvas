import { T, TldrawUiButton, useEditor } from 'tldraw'
import { runTextTool, TEXT_TOOL_OPS, TextToolOp } from '../../../../shared/textTools'
import { PromptConcatIcon } from '../../components/icons/PromptConcatIcon'
import { PreviewIcon } from '../../components/icons/PreviewIcon'
import {
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
	NODE_ROW_HEIGHT_PX,
	NODE_WIDTH_PX,
} from '../../constants'
import { ShapePort } from '../../ports/Port'
import { placeTextOnCanvas } from '../../placeOnCanvas'
import { NodeShape } from '../NodeShapeUtil'
import { NodeTextResult, PortRow, stopEvent } from './fields'
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
	category = 'text'
	resultKeys = ['lastResultText', 'error'] as const
	getDefault(): TextToolNode {
		return { type: 'text_tool', op: 'template', a: '{{input}}', b: '', lastResultText: null, error: null }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 5 + TOOL_RESULT_HEIGHT_PX
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
					{TEXT_TOOL_OPS.map((o) => (
						<option key={o.id} value={o.id}>
							{o.label}
						</option>
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
			<NodeTextResult
				text={node.lastResultText}
				error={node.error}
				empty="Press ▶ Play to run"
				height={TOOL_RESULT_HEIGHT_PX}
			/>
		</>
	)
}

// ---------------------------------------------------------------------------
// Text view: read long text, copy it, or place it on the canvas
// ---------------------------------------------------------------------------

export type TextViewNode = T.TypeOf<typeof TextViewNode>
export const TextViewNode = T.object({
	type: T.literal('text_view'),
	lastText: T.string.nullable(),
})

const VIEW_HEIGHT_PX = 220

export class TextViewNodeDefinition extends NodeDefinition<TextViewNode> {
	static type = 'text_view'
	static validator = TextViewNode
	title = 'Text view'
	heading = 'Text view'
	icon = <PreviewIcon />
	category = 'output'
	resultKeys = ['lastText'] as const
	getDefault(): TextViewNode {
		return { type: 'text_view', lastText: null }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 2 + VIEW_HEIGHT_PX
	}
	getPorts(): Record<string, ShapePort> {
		return {
			input: { id: 'input', x: 0, y: BASE_Y + NODE_ROW_HEIGHT_PX * 0.5, terminal: 'end', dataType: 'any' },
			output: { id: 'output', x: NODE_WIDTH_PX, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, _node: TextViewNode, inputs: InputValues): Promise<ExecutionResult> {
		const text = coerceToText(getInput(inputs, 'input'))
		updateNode<TextViewNode>(this.editor, shape, (n) => ({ ...n, lastText: text }))
		return { output: text }
	}
	getOutputInfo(shape: NodeShape, node: TextViewNode, inputs: InfoValues): InfoValues {
		return {
			output: {
				value: node.lastText,
				isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
				dataType: 'text',
			},
		}
	}
	Component = TextViewNodeComponent
}

function TextViewNodeComponent({ shape, node }: NodeComponentProps<TextViewNode>) {
	const editor = useEditor()
	const text = node.lastText ?? ''
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label="Text" dataType="any" />
			<NodeTextResult text={node.lastText} empty="Connect text and press ▶ Play" height={VIEW_HEIGHT_PX} />
			<NodeRow>
				<TldrawUiButton
					type="normal"
					disabled={!text}
					onPointerDown={stopEvent}
					onClick={() => navigator.clipboard.writeText(text)}
				>
					Copy
				</TldrawUiButton>
				<TldrawUiButton
					type="normal"
					disabled={!text}
					onPointerDown={stopEvent}
					onClick={() => placeTextOnCanvas(editor, shape, text)}
				>
					Place on canvas
				</TldrawUiButton>
				<TldrawUiButton
					type="normal"
					disabled={!text}
					onPointerDown={stopEvent}
					onClick={() => placeTextOnCanvas(editor, shape, text, 'markdown')}
				>
					As Markdown
				</TldrawUiButton>
			</NodeRow>
		</>
	)
}
