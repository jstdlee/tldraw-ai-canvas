import { useState } from 'react'
import { T, useEditor } from 'tldraw'
import type { LlmUsage } from '../../../../shared/llmUsage'
import { formatLlmUsage } from '../../../../shared/llmUsage'
import { categoryOf } from '../../../../shared/nodeGroups'
import { parseModelValue } from '../../../../shared/modelRef'
import { GenerateTextIcon } from '../../components/icons/GenerateTextIcon'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import { UiButton, UiSecretInput, UiTextArea, UiTextInput } from '../../../ui'
import { apiProviderModels, apiSaveSecret } from '../../api/pipelineApi'
import { parseModelsList, type ModelListEntry } from './ModelSourceNode'
import { currentRunSignal } from '../../execution/executionState'
import { isAbortError } from '../../../../shared/abort'
import { PortRow, stopEvent, NodeSelect, NodeTextResult, useInputConnected, WireField, WireFieldHeader } from './fields'
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
	/** WP21 Part D: JSON array of the last fetched models (`ModelListEntry[]`), from "Fetch models". */
	models: T.string.optional(),
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
			models: '',
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
	getBodyHeightPx(shape: NodeShape, node: RawModelNode) {
		// Rows: prompt, model, URL, model id, "Fetch models" + fetched-models filter/select
		// (WP21 Part D, 2 rows), key, system label (WP17), temp, max tokens, think = 11, plus
		// the system-prompt text box (72), the {{var}} rows, and the result area.
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return rowPx * 11 + 72 + llmVarsHeight(this.vars(node), rowPx) + RESULT_HEIGHT_PX
	}
	getPorts(shape: NodeShape, node: RawModelNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const vars = this.vars(node)
		return {
			prompt: { id: 'prompt', x: 0, y: BASE_Y + rowPx * 0.5, terminal: 'end', dataType: 'text' },
			model: { id: 'model', x: 0, y: BASE_Y + rowPx * 1.5, terminal: 'end', dataType: 'model' },
			...llmVarPorts(vars, BASE_Y + rowPx * 10 + 72, rowPx),
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
				signal: currentRunSignal(this.editor),
			})
			const payload = (await response.json()) as { text?: string; usage?: LlmUsage; error?: string }
			if (!response.ok) throw new Error(payload.error || response.statusText)
			const text = payload.text ?? ''
			const usage = payload.usage ? formatLlmUsage(payload.usage) : null
			updateNode<RawModelNode>(this.editor, shape, (n) => ({ ...n, lastText: text, lastUsage: [usage, warning].filter(Boolean).join(' · ') || null, error: null }), false)
			return { output: text }
		} catch (error) {
			updateNode<RawModelNode>(this.editor, shape, (n) => ({ ...n, error: isAbortError(error) ? null : (error as Error).message }), false)
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

function RawModelComponent({ shape, node }: NodeComponentProps<RawModelNode>) {
	const editor = useEditor()
	const vars = llmTemplateVars([node.system])
	const systemWired = useInputConnected(shape.id, 'field:system')
	const [filter, setFilter] = useState('')
	const [fetchError, setFetchError] = useState<string | null>(null)
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
	const models: ModelListEntry[] = parseModelsList({ models: node.models ?? '' })
	const filtered = filter.trim()
		? models.filter((m) => (m.label ?? m.id).toLowerCase().includes(filter.trim().toLowerCase()))
		: models
	const fetchModels = async () => {
		setFetchError(null)
		try {
			const result = await apiProviderModels({ kind: 'openai-compatible', baseURL: node.url, keyRef: node.keyRef })
			const list: ModelListEntry[] = result.models.map((m) => ({ id: m.id, label: m.label }))
			set({ models: JSON.stringify(list) })
		} catch (e) {
			setFetchError((e as Error).message)
		}
	}
	return (
		<>
			<PortRow shapeId={shape.id} portId="prompt" label="Prompt" dataType="text" />
			<PortRow shapeId={shape.id} portId="model" label="Model id" dataType="model" hint="or type below" />
			<WireField shapeId={shape.id} fieldKey="url" label="URL">{text('url', 'https://api.openai.com/v1')}</WireField>
			<NodeRow>
				<span className="NodeInputRow-label">Model</span>
				{text('model', 'model id, or wire one')}
			</NodeRow>
			<NodeRow>
				<UiButton size="sm" label="Fetch models" onClick={() => void fetchModels()} />
				<span className="ModelSourceNode-meta" title={fetchError ?? ''}>
					{fetchError ?? (models.length ? `${models.length} models fetched` : 'no models fetched yet')}
				</span>
			</NodeRow>
			<NodeRow>
				<UiTextInput
					placeholder="filter fetched models…"
					disabled={!models.length}
					value={filter}
					onChange={setFilter}
				/>
				<NodeSelect
					className="NodeField-select"
					value=""
					title="Fetched models"
					disabled={!models.length}
					onPointerDown={stopEvent}
					onChange={(e) => {
						if (e.target.value) set({ model: e.target.value })
					}}
				>
					<option value="">{models.length ? 'Pick fetched…' : 'Fetch models first'}</option>
					{filtered.map((m) => (
						<option key={m.id} value={m.id}>
							{m.label && m.label !== m.id ? `${m.label} (${m.id})` : m.id}
						</option>
					))}
				</NodeSelect>
			</NodeRow>
			<NodeRow>
				<span className="NodeInputRow-label">Key</span>
				<UiSecretInput value={node.keyRef} onChange={(keyRef) => set({ keyRef })} placeholder="optional" />
			</NodeRow>
			<WireFieldHeader shapeId={shape.id} fieldKey="system" label="System" />
			{!systemWired && (
				<div className="NodeGrow" style={{ minHeight: 72 }}>
					<UiTextArea
						className="NodeField-textarea"
						grow
						placeholder="System prompt"
						value={node.system}
						onChange={(system) => set({ system })}
					/>
				</div>
			)}
			<WireField shapeId={shape.id} fieldKey="temperature" label="Temp" dataType="number">{text('temperature', 'default', 'number')}</WireField>
			<WireField shapeId={shape.id} fieldKey="maxTokens" label="Max tok" dataType="number">{text('maxTokens', 'default', 'number')}</WireField>
			<WireField shapeId={shape.id} fieldKey="thinking" label="Think">
				<NodeSelect className="NodeField-select" value={node.thinking} onPointerDown={stopEvent} onChange={(e) => set({ thinking: e.target.value })}>
					<option value="">default</option>
					<option value="none">none</option>
					<option value="low">low</option>
					<option value="medium">medium</option>
					<option value="high">high</option>
				</NodeSelect>
			</WireField>
			<LlmVarRows shapeId={shape.id} vars={vars} />
			<NodeTextResult text={node.lastText} error={node.error} empty="Output appears here" height={RESULT_HEIGHT_PX} />
		</>
	)
}
