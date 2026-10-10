import { categoryOf } from '../../../../shared/nodeGroups'
import { T, useEditor, useValue } from 'tldraw'
import { ModelSelect } from '../../../ai/aiConfig'
import { apiGenerateText } from '../../api/pipelineApi'
import { startExecution } from '../../execution/executionState'
import { formatLlmUsage } from '../../../../shared/llmUsage'
import { GenerateTextIcon } from '../../components/icons/GenerateTextIcon'
import {
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
	NODE_ROW_HEIGHT_PX,
} from '../../constants'
import { Port, ShapePort } from '../../ports/Port'
import { getNodeInputPortValues } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import { UiTextArea } from '../../../ui'
import { PortRow, useInputConnected, NodeTextResult } from './fields'
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
	getInputText,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodePlaceholder,
	NodePortLabel,
	NodeRow,
	updateNode,
} from './shared'

export type GenerateTextNode = T.TypeOf<typeof GenerateTextNode>
export const GenerateTextNode = T.object({
	type: T.literal('generate_text'),
	model: T.string,
	lastResultText: T.string.nullable(),
	/** Used as the prompt when the "prompt" port is not wired. */
	promptText: T.string.optional(),
	...LlmSettingsFields,
})

const DEFAULT_PROMPT = 'Describe this image in detail.'
const PROMPT_TEXT_PX = 88
const RESULT_PX = 120

export class GenerateTextNodeDefinition extends NodeDefinition<GenerateTextNode> {
	static type = 'generate_text'
	static validator = GenerateTextNode
	title = 'Generate text'
	heading = 'Generate text'
	icon = <GenerateTextIcon />
	category = categoryOf('generate_text')
	override defaultWidthPx = 380
	override showsOutput = true
	resultKeys = ['lastResultText'] as const
	getDefault(): GenerateTextNode {
		return {
			type: 'generate_text',
			model: '',
			lastResultText: null,
			promptText: '',
			...DEFAULT_LLM_SETTINGS,
		}
	}
	private vars(node: GenerateTextNode) {
		return llmTemplateVars([node.promptText, node.system])
	}
	getBodyHeightPx(_shape: NodeShape, node: GenerateTextNode) {
		const vars = this.vars(node)
		// input + prompt-port + model rows, the prompt text box, settings, variables, result.
		return (
			NODE_ROW_HEIGHT_PX * 3 +
			PROMPT_TEXT_PX +
			llmSettingsHeight(node) +
			llmVarsHeight(vars) +
			RESULT_PX
		)
	}
	getPorts(shape: NodeShape, node: GenerateTextNode): Record<string, ShapePort> {
		const baseY = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
		const modelY = baseY + NODE_ROW_HEIGHT_PX * 2 + PROMPT_TEXT_PX + NODE_ROW_HEIGHT_PX * 0.5
		const settingsStartY = baseY + NODE_ROW_HEIGHT_PX * 3 + PROMPT_TEXT_PX
		const vars = this.vars(node)
		return {
			input: {
				id: 'input',
				x: 0,
				y: baseY + NODE_ROW_HEIGHT_PX * 0.5,
				terminal: 'end',
				dataType: 'any',
			},
			prompt: {
				id: 'prompt',
				x: 0,
				y: baseY + NODE_ROW_HEIGHT_PX * 1.5,
				terminal: 'end',
				dataType: 'text',
			},
			...llmModelPortMap(modelY),
			...llmSettingsPorts(settingsStartY),
			...llmVarPorts(vars, settingsStartY + llmSettingsHeight(node)),
			output: {
				id: 'output',
				x: this.getWidthPx(shape, node),
				y: NODE_HEADER_HEIGHT_PX / 2,
				terminal: 'start',
				dataType: 'text',
			},
		}
	}
	async execute(
		shape: NodeShape,
		node: GenerateTextNode,
		inputs: InputValues
	): Promise<ExecutionResult> {
		const input = coerceToText(getInput(inputs, 'input')) || undefined
		const promptSource = getInputText(inputs, 'prompt') || node.promptText?.trim() || DEFAULT_PROMPT
		const vars = this.vars(node)
		const { text: prompt, warning } = fillLlmTemplate(promptSource, vars, inputs)
		const settings = llmEffectiveSettings(node, inputs)

		const result = await apiGenerateText({
			input,
			prompt,
			model: settings.model || node.model || undefined,
			system: settings.system,
			temperature: settings.temperature,
			maxTokens: settings.maxTokens,
			thinking: settings.thinking,
		})

		const usage = result.usage ? formatLlmUsage(result.usage) : ''
		updateNode<GenerateTextNode>(this.editor, shape, (n) => ({
			...n,
			lastResultText: result.text,
			lastUsage: [usage, warning].filter(Boolean).join(' · ') || undefined,
		}))

		return { output: result.text }
	}
	getOutputInfo(shape: NodeShape, node: GenerateTextNode, inputs: InfoValues): InfoValues {
		return {
			output: {
				value: node.lastResultText,
				isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
				dataType: 'text',
			},
		}
	}
	Component = GenerateTextNodeComponent
}

/** The `model` settings port lives on its own row, right after the prompt text box. */
function llmModelPortMap(y: number) {
	return { model: llmModelPort(y) }
}

function GenerateTextNodeComponent({ shape, node }: NodeComponentProps<GenerateTextNode>) {
	const editor = useEditor()

	const inputPort = useValue('input port', () => getNodeInputPortValues(editor, shape.id).input, [
		editor,
		shape.id,
	])
	const promptPort = useValue(
		'prompt port',
		() => getNodeInputPortValues(editor, shape.id).prompt,
		[editor, shape.id]
	)
	const modelWired = useInputConnected(shape.id, 'model')
	const vars = llmTemplateVars([node.promptText, node.system])
	const run = () => void startExecution(editor, new Set([shape.id]))

	return (
		<>
			<NodeRow>
				<Port shapeId={shape.id} portId="input" />
				<NodePortLabel dataType="any">Input</NodePortLabel>
				{inputPort ? (
					<span className="NodeRow-connected-value">
						{inputPort.isOutOfDate ? (
							<NodePlaceholder />
						) : (
							<span title={String(inputPort.value)}>
								{String(inputPort.value ?? '').slice(0, 20)}
								{String(inputPort.value ?? '').length > 20 ? '...' : ''}
							</span>
						)}
					</span>
				) : (
					<span className="NodeRow-disconnected">not connected</span>
				)}
			</NodeRow>
			<PortRow shapeId={shape.id} portId="prompt" label="Prompt" dataType="text" hint="or type below" />
			<div className="NodeField-block" style={{ height: PROMPT_TEXT_PX }}>
				<UiTextArea
					className="NodeField-textarea"
					grow
					disabled={!!promptPort}
					placeholder={promptPort ? '(from the Prompt input)' : DEFAULT_PROMPT}
					value={promptPort ? '' : (node.promptText ?? '')}
					onChange={(promptText) => updateNode<GenerateTextNode>(editor, shape, (n) => ({ ...n, promptText }), false)}
					onSubmit={run}
					submitOn="enter"
				/>
				{!promptPort && <div className="LlmSubmitHint">Enter to run · Shift+Enter new line</div>}
			</div>
			{modelWired ? (
				<PortRow shapeId={shape.id} portId="model" label="Model" dataType="model" />
			) : (
				<NodeRow>
					<Port shapeId={shape.id} portId="model" />
					<span className="NodeInputRow-label">Model</span>
					<ModelSelect
						className="node-model-select"
						capability={inputPort ? 'vision' : 'chat'}
						value={node.model}
						onChange={(model) => updateNode<GenerateTextNode>(editor, shape, (n) => ({ ...n, model }))}
					/>
				</NodeRow>
			)}
			<LlmSettingsPanel editor={editor} shape={shape} node={node} modelWired={modelWired} />
			<LlmVarRows shapeId={shape.id} vars={vars} />
			<NodeTextResult text={node.lastResultText} empty="Output appears here" height={RESULT_PX} />
		</>
	)
}
