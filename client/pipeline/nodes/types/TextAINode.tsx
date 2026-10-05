import { categoryOf } from '../../../../shared/nodeGroups'
import { T, useEditor } from 'tldraw'
import { ModelSelect } from '../../../ai/aiConfig'
import { apiGenerateText } from '../../api/pipelineApi'
import { formatLlmUsage } from '../../../../shared/llmUsage'
import { GenerateTextIcon } from '../../components/icons/GenerateTextIcon'
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
	DEFAULT_LLM_SETTINGS,
	LlmSettingsFields,
	LlmSettingsPanel,
	llmRequestSettings,
	llmSettingsHeight,
} from './llmSettings'
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

/** Ready-made text jobs. `{option}` is replaced by the option field. */
export const TEXT_AI_OPERATIONS = [
	{ id: 'summarize', label: 'Summarize', option: 'length, e.g. 3 sentences', prompt: 'Summarize the input in {option}. Keep the key facts.' },
	{ id: 'bullets', label: 'Bullet points', option: 'max points, e.g. 5', prompt: 'Turn the input into at most {option} short bullet points.' },
	{ id: 'translate', label: 'Translate', option: 'target language, e.g. Chinese', prompt: 'Translate the input into {option}. Return only the translation.' },
	{ id: 'rewrite', label: 'Rewrite / change tone', option: 'tone, e.g. friendly and short', prompt: 'Rewrite the input so it is {option}. Keep the meaning.' },
	{ id: 'fix', label: 'Fix grammar & spelling', option: '', prompt: 'Fix grammar, spelling and punctuation. Return only the corrected text.' },
	{ id: 'simplify', label: 'Simplify (plain English)', option: 'reader, e.g. a 12-year-old', prompt: 'Rewrite the input in simple words for {option}. Short sentences.' },
	{ id: 'keywords', label: 'Keywords / tags', option: 'how many, e.g. 8', prompt: 'List {option} keywords for the input, comma separated, nothing else.' },
	{ id: 'title', label: 'Title / headline', option: 'style, e.g. catchy', prompt: 'Write one {option} title for the input. Return only the title.' },
	{ id: 'json', label: 'Extract to JSON', option: 'fields, e.g. name, email, date', prompt: 'Extract these fields from the input as a JSON object: {option}. Return only JSON.' },
	{ id: 'classify', label: 'Classify', option: 'labels, e.g. bug, feature, question', prompt: 'Classify the input as one of: {option}. Return only the label.' },
	{ id: 'questions', label: 'Questions & answers', option: 'how many, e.g. 5', prompt: 'Write {option} questions with short answers about the input.' },
	{ id: 'explain', label: 'Explain', option: 'audience, e.g. a beginner', prompt: 'Explain the input to {option}.' },
	{ id: 'prompt', label: 'Image prompt', option: 'style, e.g. watercolor', prompt: 'Write one detailed text-to-image prompt ({option} style) that shows the input. Return only the prompt.' },
	{ id: 'custom', label: 'Custom instruction', option: '', prompt: '' },
] as const

const DEFAULT_OPTION: Record<string, string> = {
	summarize: '3 sentences',
	bullets: '5',
	translate: 'English',
	rewrite: 'friendly and short',
	simplify: 'a 12-year-old',
	keywords: '8',
	title: 'catchy',
	json: 'name, date, summary',
	classify: 'positive, neutral, negative',
	questions: '5',
	explain: 'a beginner',
	prompt: 'cinematic',
}

export type TextAINode = T.TypeOf<typeof TextAINode>
export const TextAINode = T.object({
	type: T.literal('text_ai'),
	operation: T.string,
	option: T.string,
	instruction: T.string,
	model: T.string,
	lastResultText: T.string.nullable(),
	error: T.string.nullable(),
	...LlmSettingsFields,
})

const OPTION_HEIGHT_PX = 64
const RESULT_HEIGHT_PX = 120

export function buildTextAIPrompt(node: Pick<TextAINode, 'operation' | 'option' | 'instruction'>) {
	const op = TEXT_AI_OPERATIONS.find((o) => o.id === node.operation) ?? TEXT_AI_OPERATIONS[0]
	if (op.id === 'custom') return node.instruction.trim() || 'Respond to the input.'
	const option = node.option.trim() || DEFAULT_OPTION[op.id] || ''
	const extra = node.instruction.trim() ? `\nAlso: ${node.instruction.trim()}` : ''
	return op.prompt.replace('{option}', option) + extra
}

export class TextAINodeDefinition extends NodeDefinition<TextAINode> {
	static type = 'text_ai'
	static validator = TextAINode
	title = 'AI text'
	heading = 'AI text'
	icon = <GenerateTextIcon />
	category = categoryOf('text_ai')
	resultKeys = ['lastResultText', 'error'] as const
	getDefault(): TextAINode {
		return {
			type: 'text_ai',
			operation: 'summarize',
			option: '',
			instruction: '',
			model: '',
			lastResultText: null,
			error: null,
			...DEFAULT_LLM_SETTINGS,
		}
	}
	getBodyHeightPx(_shape: NodeShape, node: TextAINode) {
		return NODE_ROW_HEIGHT_PX * 3 + OPTION_HEIGHT_PX + llmSettingsHeight(node)
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
			output: {
				id: 'output',
				x: NODE_WIDTH_PX,
				y: NODE_HEADER_HEIGHT_PX / 2,
				terminal: 'start',
				dataType: 'text',
			},
		}
	}
	async execute(shape: NodeShape, node: TextAINode, inputs: InputValues): Promise<ExecutionResult> {
		const input = coerceToText(getInput(inputs, 'input'))
		try {
			const result = await apiGenerateText({
				input: input || undefined,
				prompt: input ? buildTextAIPrompt(node) : `${buildTextAIPrompt(node)}\n\n(No input was given.)`,
				model: node.model || undefined,
				...llmRequestSettings(node),
			})
			const usage = result.usage ? formatLlmUsage(result.usage) : ''
			updateNode<TextAINode>(this.editor, shape, (n) => ({
				...n,
				lastResultText: result.text,
				lastUsage: usage || undefined,
				error: null,
			}))
			return { output: result.text }
		} catch (e) {
			updateNode<TextAINode>(this.editor, shape, (n) => ({ ...n, error: (e as Error).message }), false)
			return { output: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: TextAINode, inputs: InfoValues): InfoValues {
		return {
			output: {
				value: node.lastResultText,
				isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
				dataType: 'text',
			},
		}
	}
	Component = TextAINodeComponent
}

function TextAINodeComponent({ shape, node }: NodeComponentProps<TextAINode>) {
	const editor = useEditor()
	const op = TEXT_AI_OPERATIONS.find((o) => o.id === node.operation) ?? TEXT_AI_OPERATIONS[0]
	const set = (patch: Partial<TextAINode>, outOfDate = true) =>
		updateNode<TextAINode>(editor, shape, (n) => ({ ...n, ...patch }), outOfDate)
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label="Input" dataType="any" hint="text or image" />
			<NodeRow>
				<span className="NodeInputRow-label">Job</span>
				<select
					className="NodeField-select"
					value={node.operation}
					onPointerDown={stopEvent}
					onChange={(e) => set({ operation: e.target.value, option: '' })}
				>
					{TEXT_AI_OPERATIONS.map((o) => (
						<option key={o.id} value={o.id}>
							{o.label}
						</option>
					))}
				</select>
			</NodeRow>
			<div className="NodeField-block" style={{ height: OPTION_HEIGHT_PX }}>
				{op.id === 'custom' ? (
					<textarea
						className="NodeField-textarea"
						placeholder="Instruction, e.g. Turn this into a tweet"
						value={node.instruction}
						onPointerDown={stopEvent}
						onKeyDown={stopEvent}
						onChange={(e) => set({ instruction: e.target.value }, false)}
					/>
				) : (
					<>
						{op.option && (
							<input
								className="NodeField-input"
								placeholder={op.option}
								value={node.option}
								onPointerDown={stopEvent}
								onKeyDown={stopEvent}
								onChange={(e) => set({ option: e.target.value }, false)}
							/>
						)}
						<input
							className="NodeField-input"
							placeholder="Extra instruction (optional)"
							value={node.instruction}
							onPointerDown={stopEvent}
							onKeyDown={stopEvent}
							onChange={(e) => set({ instruction: e.target.value }, false)}
						/>
					</>
				)}
			</div>
			<NodeRow>
				<span className="NodeInputRow-label">Model</span>
				<ModelSelect
					className="node-model-select"
					capability="chat"
					value={node.model}
					onChange={(model) => set({ model }, false)}
				/>
			</NodeRow>
			<LlmSettingsPanel editor={editor} shape={shape} node={node} />
		</>
	)
}
