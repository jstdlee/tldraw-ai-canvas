import { categoryOf } from '../../../../shared/nodeGroups'
import { T, useEditor } from 'tldraw'
import { runTextTool, TEXT_TOOL_OPS, TextToolOp } from '../../../../shared/textTools'
import { PromptConcatIcon } from '../../components/icons/PromptConcatIcon'
import {
	getNodeRowHeightPx,
	GROW_FIELD_EXTRA_PX,
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
} from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import { UiGrowingInput } from '../../../ui'
import { PortRow, stopEvent, NodeSelect, WireField } from './fields'
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
	override defaultWidthPx = 380
	resultKeys = ['lastResultText', 'error'] as const
	getDefault(): TextToolNode {
		return { type: 'text_tool', op: 'template', a: '{{input}}', b: '', lastResultText: null, error: null }
	}
	getBodyHeightPx(shape: NodeShape, node: TextToolNode) {
		// WP27 Part B: Param A/B wrap/grow instead of a single-line cutoff (e.g. a template
		// string, a long pattern) — reserve a max-rows cap for each one this op actually shows.
		const op = TEXT_TOOL_OPS.find((o) => o.id === node.op) ?? TEXT_TOOL_OPS[0]
		const growExtra = (op.a ? GROW_FIELD_EXTRA_PX : 0) + (op.b ? GROW_FIELD_EXTRA_PX : 0)
		return getNodeRowHeightPx(shape.props.fontSize) * 5 + growExtra
	}
	getPorts(shape: NodeShape, node: TextToolNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return {
			input: { id: 'input', x: 0, y: BASE_Y + rowPx * 0.5, terminal: 'end', dataType: 'any' },
			input2: { id: 'input2', x: 0, y: BASE_Y + rowPx * 1.5, terminal: 'end', dataType: 'any' },
			output: { id: 'output', x: this.getWidthPx(shape, node), y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
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
			<WireField shapeId={shape.id} fieldKey="op" label="Tool">
				<NodeSelect
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
				</NodeSelect>
			</WireField>
			{/* WP39: Param B used to render a totally blank row (an empty string, not even a
			 * hint) whenever the chosen tool doesn't take a second parameter — the row looked
			 * broken, not "not applicable". Both params now say so plainly when unused, the
			 * same pattern as Decision switch's per-mode fields. */}
			{(['a', 'b'] as const).map((key) => (
				<WireField key={key} shapeId={shape.id} fieldKey={key} label={key === 'a' ? 'Param A' : 'Param B'} grow={!!op[key]}>
					{op[key] ? (
						<UiGrowingInput placeholder={op[key]} value={node[key]} onChange={(next) => set({ [key]: next })} />
					) : (
						<span className="NodeRow-disconnected">not used by {op.label}</span>
					)}
				</WireField>
			))}
		</>
	)
}
