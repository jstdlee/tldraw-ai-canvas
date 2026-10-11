import { categoryOf } from '../../../../shared/nodeGroups'
import { T, useEditor } from 'tldraw'
import { ModelSelect } from '../../../ai/aiConfig'
import { apiGenerateText } from '../../api/pipelineApi'
import { startExecution } from '../../execution/executionState'
import { formatLlmUsage } from '../../../../shared/llmUsage'
import { GenerateTextIcon } from '../../components/icons/GenerateTextIcon'
import {
	getNodeRowHeightPx,
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
} from '../../constants'
import { Port, ShapePort } from '../../ports/Port'
import { useFieldPortAnchor } from '../../ports/useFieldPortAnchor'
import { NodeShape } from '../NodeShapeUtil'
import { UiButton, UiTextArea, UiTextInput } from '../../../ui'
import { PortRow, stopEvent, useInputConnected, NodeSelect, NodeTextResult, WireField, WireFieldHeader } from './fields'
import {
	DEFAULT_LLM_SETTINGS,
	fillLlmTemplate,
	llmEffectiveSettings,
	llmModelPort,
	LlmSettingsFields,
	LlmSettingsPanel,
	llmSettingsHeight,
	llmSettingsPorts,
	llmTemplateVars,
	llmVarPorts,
	llmVarsHeight,
	LlmVarRows,
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

/** Ready-made text jobs. `{option}` is replaced by the option field. (shared/textAiOps.ts) */
import { TEXT_AI_OPERATIONS } from '../../../../shared/textAiOps'
export { TEXT_AI_OPERATIONS }

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
	/** When set, replaces the generated job prompt. Editable under Model settings. */
	promptOverride: T.string.optional(),
	model: T.string,
	lastResultText: T.string.nullable(),
	error: T.string.nullable(),
	...LlmSettingsFields,
})

const OPTION_HEIGHT_PX = 80
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
	override defaultWidthPx = 380
	override showsOutput = true
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
	private vars(node: TextAINode) {
		return llmTemplateVars([node.promptOverride ?? buildTextAIPrompt(node), node.instruction, node.system])
	}
	/** The option/instruction area's height: WP17 gave `option`/`instruction` their own rows
	 * (custom job: just "Instruction", with a growing text box below its label row). */
	private optionBlockHeightPx(node: TextAINode, rowPx: number) {
		const op = TEXT_AI_OPERATIONS.find((o) => o.id === node.operation) ?? TEXT_AI_OPERATIONS[0]
		if (op.id === 'custom') return rowPx + OPTION_HEIGHT_PX
		return rowPx * (op.option ? 2 : 1)
	}
	getBodyHeightPx(shape: NodeShape, node: TextAINode) {
		// The advanced job-prompt editor adds a block when settings are open.
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return (
			rowPx * 3 +
			this.optionBlockHeightPx(node, rowPx) +
			llmSettingsHeight(node, rowPx) +
			llmVarsHeight(this.vars(node), rowPx) +
			// +rowPx (WP17): the job-prompt override got its own label row.
			(node.showSettings ? 140 + rowPx : 0) +
			RESULT_HEIGHT_PX
		)
	}
	getPorts(shape: NodeShape, node: TextAINode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const baseY = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
		// Rows above the model row: input, job dropdown, then the option/instruction block.
		const modelY = baseY + rowPx * 2.5 + this.optionBlockHeightPx(node, rowPx)
		const settingsStartY = baseY + rowPx * 3 + this.optionBlockHeightPx(node, rowPx)
		const vars = this.vars(node)
		return {
			input: { id: 'input', x: 0, y: baseY + rowPx * 0.5, terminal: 'end', dataType: 'any' },
			model: llmModelPort(modelY),
			...llmSettingsPorts(settingsStartY, !!node.showSettings, rowPx),
			...llmVarPorts(vars, settingsStartY + llmSettingsHeight(node, rowPx), rowPx),
			output: {
				id: 'output',
				x: this.getWidthPx(shape, node),
				y: NODE_HEADER_HEIGHT_PX / 2,
				terminal: 'start',
				dataType: 'text',
			},
		}
	}
	async execute(shape: NodeShape, node: TextAINode, inputs: InputValues): Promise<ExecutionResult> {
		const input = coerceToText(getInput(inputs, 'input'))
		const jobPromptSource = node.promptOverride?.trim() || buildTextAIPrompt(node)
		const vars = this.vars(node)
		const { text: jobPrompt, warning } = fillLlmTemplate(jobPromptSource, vars, inputs)
		const settings = llmEffectiveSettings(node, inputs)
		try {
			const result = await apiGenerateText({
				input: input || undefined,
				prompt: input ? jobPrompt : `${jobPrompt}\n\n(No input was given.)`,
				model: settings.model || node.model || undefined,
				system: settings.system,
				temperature: settings.temperature,
				maxTokens: settings.maxTokens,
				thinking: settings.thinking,
			})
			const usage = result.usage ? formatLlmUsage(result.usage) : ''
			updateNode<TextAINode>(this.editor, shape, (n) => ({
				...n,
				lastResultText: result.text,
				lastUsage: [usage, warning].filter(Boolean).join(' · ') || undefined,
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
	const modelWired = useInputConnected(shape.id, 'model')
	const modelRowRef = useFieldPortAnchor<HTMLDivElement>(shape.id, 'model')
	const vars = llmTemplateVars([node.promptOverride ?? buildTextAIPrompt(node), node.instruction, node.system])
	const set = (patch: Partial<TextAINode>, outOfDate = true) =>
		updateNode<TextAINode>(editor, shape, (n) => ({ ...n, ...patch }), outOfDate)
	const run = () => void startExecution(editor, new Set([shape.id]))
	const instructionWired = useInputConnected(shape.id, 'field:instruction')
	const promptOverrideWired = useInputConnected(shape.id, 'field:promptOverride')
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label="Input" dataType="any" hint="text or image" />
			<WireField shapeId={shape.id} fieldKey="operation" label="Job">
				<NodeSelect
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
				</NodeSelect>
			</WireField>
			{op.id === 'custom' ? (
				<>
					<WireFieldHeader shapeId={shape.id} fieldKey="instruction" label="Instruction" />
					{!instructionWired && (
						<div className="NodeGrow" style={{ minHeight: OPTION_HEIGHT_PX }}>
							<UiTextArea
								className="NodeField-textarea"
								grow
								placeholder="Instruction, e.g. Turn this into a tweet"
								value={node.instruction}
								onChange={(instruction) => set({ instruction }, false)}
								onSubmit={run}
								submitOn="enter"
							/>
							<div className="LlmSubmitHint">Enter to run · Shift+Enter new line</div>
						</div>
					)}
				</>
			) : (
				<>
					{op.option && (
						<WireField shapeId={shape.id} fieldKey="option" label="Option">
							<UiTextInput placeholder={op.option} value={node.option} onChange={(option) => set({ option }, false)} />
						</WireField>
					)}
					<WireField shapeId={shape.id} fieldKey="instruction" label="Instruction">
						<UiTextInput
							placeholder="Extra instruction (optional, Enter to run)"
							value={node.instruction}
							onChange={(instruction) => set({ instruction }, false)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && !e.nativeEvent.isComposing) run()
							}}
						/>
					</WireField>
				</>
			)}
			{modelWired ? (
				<PortRow shapeId={shape.id} portId="model" label="Model" dataType="model" />
			) : (
				<NodeRow ref={modelRowRef}>
					<Port shapeId={shape.id} portId="model" />
					<span className="NodeInputRow-label">Model</span>
					<ModelSelect
						className="node-model-select"
						capability="chat"
						value={node.model}
						onChange={(model) => set({ model }, false)}
					/>
				</NodeRow>
			)}
			<LlmSettingsPanel editor={editor} shape={shape} node={node} modelWired={modelWired} />
			<LlmVarRows shapeId={shape.id} vars={vars} />
			{node.showSettings && (
				<>
					<WireFieldHeader shapeId={shape.id} fieldKey="promptOverride" label="Job prompt (advanced)" />
					{!promptOverrideWired && (
						<div className="NodeField-block">
							{node.promptOverride != null && (
								<UiButton size="sm" variant="low" label="reset" onClick={() => set({ promptOverride: undefined }, false)} />
							)}
							<UiTextArea
								className="NodeField-textarea"
								style={{ height: 72 }}
								value={node.promptOverride ?? buildTextAIPrompt(node)}
								onChange={(promptOverride) => set({ promptOverride }, false)}
							/>
						</div>
					)}
				</>
			)}
			<NodeTextResult text={node.lastResultText} error={node.error} empty="Output appears here" height={RESULT_HEIGHT_PX} />
		</>
	)
}
