import { T, useEditor } from 'tldraw'
import type { LlmUsage } from '../../../../shared/llmUsage'
import { formatLlmUsage } from '../../../../shared/llmUsage'
import { categoryOf } from '../../../../shared/nodeGroups'
import { parseModelValue } from '../../../../shared/modelRef'
import { GenerateTextIcon } from '../../components/icons/GenerateTextIcon'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEIGHT_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import { UiSecretInput, UiTextArea, UiTextInput } from '../../../ui'
import { apiSaveSecret } from '../../api/pipelineApi'
import { PortRow, stopEvent, NodeSelect, NodeTextResult } from './fields'
import { fillLlmTemplate, llmTemplateVars, llmVarPorts, llmVarsHeight, LlmVarRows } from './llmSettings'
import {
	areAnyInputsOutOfDate,
	ExecutionResult,
	getInputText,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	STOP_EXECUTION,
	updateNode,
} from './shared'

const WIDTH = 380
const BASE_Y = NODE_HEADER_HEIGHT_PX + 8
const RESULT_HEIGHT_PX = 110

/**
 * A model call with every setting on the card: endpoint, model id, key, system
 * prompt, temperature, thinking, max tokens. Any OpenAI-compatible endpoint works.
 * The key is stored in this node, so it is saved with the canvas.
 */
export type RawModelNode = T.TypeOf<typeof RawModelNode>
export const RawModelNode = T.object({
	type: T.literal('raw_model'),
	url: T.string,
	model: T.string,
	/** Legacy: a key typed straight into the node. Moved to the server's secret store on first run. */
	apiKey: T.string,
	/** `secret:<id>` from the server's secret store, or `env:NAME`. */
	keyRef: T.string.optional(),
	system: T.string,
	/** Empty means the model's default. */
	temperature: T.string,
	/** '' | none | low | medium | high */
	thinking: T.string,
	maxTokens: T.string,
	lastText: T.string.nullable(),
	lastUsage: T.string.nullable(),
	error: T.string.nullable(),
})

export class RawModelNodeDefinition extends NodeDefinition<RawModelNode> {
	static type = 'raw_model'
	static validator = RawModelNode
	title = 'Raw model'
	heading = 'Raw model'
	icon = (<GenerateTextIcon />)
	category = categoryOf('raw_model')
	override showsOutput = true
	resultKeys = ['lastText', 'lastUsage', 'error'] as const
	getDefault(): RawModelNode {
		return {
			type: 'raw_model',
			url: 'https://api.openai.com/v1',
			model: '',
			apiKey: '',
			system: '',
			temperature: '',
			thinking: '',
			maxTokens: '',
			lastText: null,
			lastUsage: null,
			error: null,
		}
	}
	override getWidthPx() {
		return WIDTH
	}
	private vars(node: RawModelNode) {
		return llmTemplateVars([node.system])
	}
	getBodyHeightPx(_shape: NodeShape, node: RawModelNode) {
		// Rows: prompt, model, URL, model id, key, temp, max tokens, think = 8, plus the
		// system-prompt text box (72), the {{var}} rows, and the result area.
		return NODE_ROW_HEIGHT_PX * 8 + 72 + llmVarsHeight(this.vars(node)) + RESULT_HEIGHT_PX
	}
	getPorts(_shape: NodeShape, node: RawModelNode): Record<string, ShapePort> {
		const vars = this.vars(node)
		return {
			prompt: { id: 'prompt', x: 0, y: BASE_Y + NODE_ROW_HEIGHT_PX * 0.5, terminal: 'end', dataType: 'text' },
			model: { id: 'model', x: 0, y: BASE_Y + NODE_ROW_HEIGHT_PX * 1.5, terminal: 'end', dataType: 'model' },
			...llmVarPorts(vars, BASE_Y + NODE_ROW_HEIGHT_PX * 8 + 72),
			output: { id: 'output', x: WIDTH, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: RawModelNode, inputs: InputValues): Promise<ExecutionResult> {
		try {
			const prompt = getInputText(inputs, 'prompt')
			if (!prompt.trim()) throw new Error('Connect a prompt')
			const vars = this.vars(node)
			const { text: system, warning } = fillLlmTemplate(node.system, vars, inputs)

			// An old canvas may still carry a key typed straight into the node: move it
			// to the server's secret store the first time this node runs.
			let keyRef = node.keyRef
			if (!keyRef && node.apiKey) {
				keyRef = await apiSaveSecret(node.apiKey)
				updateNode<RawModelNode>(this.editor, shape, (n) => ({ ...n, keyRef, apiKey: '' }), false)
			}

			const wiredModel = getInputText(inputs, 'model').trim()
			const parsed = parseModelValue(wiredModel || node.model)
			const url = parsed.adhoc?.baseURL || node.url
			const model = parsed.adhoc?.model || parsed.key || ''
			if (!model) throw new Error('Set a model id, or wire one in')
			if (parsed.adhoc?.keyRef) keyRef = parsed.adhoc.keyRef

			const response = await fetch('/api/raw-model', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					url,
					model,
					keyRef: keyRef || undefined,
					system: system || undefined,
					temperature: node.temperature === '' ? undefined : Number(node.temperature),
					thinking: node.thinking || undefined,
					maxTokens: node.maxTokens === '' ? undefined : Number(node.maxTokens),
					prompt,
				}),
			})
			const payload = (await response.json()) as { text?: string; usage?: LlmUsage; error?: string }
			if (!response.ok) throw new Error(payload.error || response.statusText)
			const text = payload.text ?? ''
			const usage = payload.usage ? formatLlmUsage(payload.usage) : null
			updateNode<RawModelNode>(this.editor, shape, (n) => ({ ...n, lastText: text, lastUsage: [usage, warning].filter(Boolean).join(' · ') || null, error: null }), false)
			return { output: text }
		} catch (error) {
			updateNode<RawModelNode>(this.editor, shape, (n) => ({ ...n, error: (error as Error).message }), false)
			return { output: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: RawModelNode, inputs: InfoValues): InfoValues {
		return {
			output: { value: node.lastText, isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate, dataType: 'text' },
		}
	}
	Component = RawModelComponent
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<NodeRow>
			<span className="NodeInputRow-label">{label}</span>
			{children}
		</NodeRow>
	)
}

function RawModelComponent({ shape, node }: NodeComponentProps<RawModelNode>) {
	const editor = useEditor()
	const vars = llmTemplateVars([node.system])
	const set = (patch: Partial<RawModelNode>) => updateNode<RawModelNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const text = (key: 'url' | 'model' | 'temperature' | 'maxTokens', placeholder: string, type = 'text') => (
		<UiTextInput
			type={type}
			inputMode={type === 'number' ? 'decimal' : 'text'}
			placeholder={placeholder}
			autoComplete="off"
			value={node[key]}
			onChange={(next) => set({ [key]: next })}
		/>
	)
	return (
		<>
			<PortRow shapeId={shape.id} portId="prompt" label="Prompt" dataType="text" />
			<PortRow shapeId={shape.id} portId="model" label="Model id" dataType="model" hint="or type below" />
			<Field label="URL">{text('url', 'https://api.openai.com/v1')}</Field>
			<Field label="Model">{text('model', 'model id, or wire one')}</Field>
			<Field label="Key">
				<UiSecretInput value={node.keyRef} onChange={(keyRef) => set({ keyRef })} placeholder="optional" />
			</Field>
			<div className="NodeGrow" style={{ minHeight: 72 }}>
				<UiTextArea
					className="NodeField-textarea"
					grow
					placeholder="System prompt"
					value={node.system}
					onChange={(system) => set({ system })}
				/>
			</div>
			<Field label="Temp">{text('temperature', 'default', 'number')}</Field>
			<Field label="Max tok">{text('maxTokens', 'default', 'number')}</Field>
			<Field label="Think">
				<NodeSelect className="NodeField-select" value={node.thinking} onPointerDown={stopEvent} onChange={(e) => set({ thinking: e.target.value })}>
					<option value="">default</option>
					<option value="none">none</option>
					<option value="low">low</option>
					<option value="medium">medium</option>
					<option value="high">high</option>
				</NodeSelect>
			</Field>
			<LlmVarRows shapeId={shape.id} vars={vars} />
			<NodeTextResult text={node.lastText} error={node.error} empty="Output appears here" height={RESULT_HEIGHT_PX} />
		</>
	)
}
