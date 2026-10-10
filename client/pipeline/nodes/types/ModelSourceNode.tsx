import { T, useEditor } from 'tldraw'
import { categoryOf } from '../../../../shared/nodeGroups'
import { buildAdhocModelValue } from '../../../../shared/modelRef'
import { useAIConfig } from '../../../ai/aiConfig'
import { cloudflareBase } from '../../../../shared/aiConfig'
import { apiProviderModels } from '../../api/pipelineApi'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_ROW_HEIGHT_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import { UiButton, UiSecretInput, UiSegmented, UiTextInput } from '../../../ui'
import { stopEvent, NodeSelect } from './fields'
import { ExecutionResult, InfoValues, NodeComponentProps, NodeDefinition, NodeRow, updateNode } from './shared'

function ModelProviderIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<rect x="2.5" y="5" width="11" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
			<path d="M5 5V3M11 5V3M5 13v1M11 13v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	)
}

const ROW = NODE_ROW_HEIGHT_PX
const CURRENT_PX = 52
const WIDTH = 420

export interface ModelListEntry {
	id: string
	label?: string
}

export type ModelSourceNode = T.TypeOf<typeof ModelSourceNode>
export const ModelSourceNode = T.object({
	type: T.literal('model_source'),
	baseURL: T.string,
	keyRef: T.string.optional(),
	/** JSON array of the last fetched models (`ModelListEntry[]`). */
	models: T.string,
	model: T.string,
	filter: T.string,
	/** What the chosen model is for. Informational only. */
	kind: T.string.optional(),
	fetchedAt: T.number.nullable().optional(),
	error: T.string.nullable(),
})

export const MODEL_SOURCE_PRESETS: { label: string; baseURL: string }[] = [
	{ label: 'OpenAI', baseURL: 'https://api.openai.com/v1' },
	{ label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1' },
	{ label: 'Groq', baseURL: 'https://api.groq.com/openai/v1' },
	{ label: 'Together', baseURL: 'https://api.together.xyz/v1' },
	{ label: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1' },
	{ label: 'Ollama (this machine)', baseURL: 'http://127.0.0.1:11434/v1' },
	{ label: 'LM Studio (this machine)', baseURL: 'http://127.0.0.1:1234/v1' },
]

export function parseModelsList(node: Pick<ModelSourceNode, 'models'>): ModelListEntry[] {
	if (!node.models) return []
	try {
		const parsed = JSON.parse(node.models)
		return Array.isArray(parsed) ? parsed.filter((m) => m && typeof m.id === 'string') : []
	} catch {
		return []
	}
}

function formatFetchedAt(ts: number | null | undefined): string {
	if (!ts) return 'not fetched yet'
	const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000))
	if (seconds < 5) return 'fetched just now'
	if (seconds < 60) return `fetched ${seconds}s ago`
	const minutes = Math.round(seconds / 60)
	if (minutes < 60) return `fetched ${minutes}m ago`
	return `fetched ${Math.round(minutes / 60)}h ago`
}

export class ModelSourceNodeDefinition extends NodeDefinition<ModelSourceNode> {
	static type = 'model_source'
	static validator = ModelSourceNode
	title = 'Model provider'
	heading = 'Model provider'
	icon = <ModelProviderIcon />
	category = categoryOf('model_source')
	override showsOutput = true
	override defaultWidthPx = WIDTH
	resultKeys = ['model', 'models', 'error'] as const
	getDefault(): ModelSourceNode {
		return {
			type: 'model_source',
			baseURL: 'https://api.openai.com/v1',
			keyRef: undefined,
			models: '',
			model: '',
			filter: '',
			kind: 'chat',
			fetchedAt: null,
			error: null,
		}
	}
	override getWidthPx() {
		return WIDTH
	}
	getBodyHeightPx(): number {
		// kind, URL, key, fetch (with the model count/fetched-at line inline), filter/select rows,
		// plus the big chosen-model line.
		return ROW * 5 + CURRENT_PX
	}
	getPorts(): Record<string, ShapePort> {
		return {
			model: {
				id: 'model',
				x: WIDTH,
				y: NODE_HEADER_HEIGHT_PX / 2,
				terminal: 'start',
				dataType: 'model',
			},
		}
	}
	async execute(_shape: NodeShape, node: ModelSourceNode): Promise<ExecutionResult> {
		if (!node.model.trim()) throw new Error('Pick a model first (Fetch models, then choose one)')
		return {
			model: buildAdhocModelValue({
				kind: 'adhoc',
				baseURL: node.baseURL.trim(),
				model: node.model.trim(),
				keyRef: node.keyRef || undefined,
			}),
		}
	}
	getOutputInfo(shape: NodeShape, node: ModelSourceNode): InfoValues {
		const value = node.model.trim()
			? buildAdhocModelValue({
					kind: 'adhoc',
					baseURL: node.baseURL.trim(),
					model: node.model.trim(),
					keyRef: node.keyRef || undefined,
				})
			: null
		return {
			model: { value, isOutOfDate: shape.props.isOutOfDate, dataType: 'model' },
		}
	}
	Component = ModelSourceNodeComponent
}

function ModelSourceNodeComponent({ shape, node }: NodeComponentProps<ModelSourceNode>) {
	const editor = useEditor()
	const aiConfig = useAIConfig()
	const set = (patch: Partial<ModelSourceNode>, outOfDate = true) =>
		updateNode<ModelSourceNode>(editor, shape, (n) => ({ ...n, ...patch }), outOfDate)

	const cloudflareProvider = aiConfig?.providers.find((p) => p.kind === 'cloudflare' && p.enabled && p.accountId)
	const presets = [
		...MODEL_SOURCE_PRESETS,
		...(cloudflareProvider ? [{ label: 'Cloudflare', baseURL: `${cloudflareBase(cloudflareProvider.accountId!)}/v1` }] : []),
		{ label: 'Custom…', baseURL: '' },
	]

	const models = parseModelsList(node)
	const filtered = node.filter.trim()
		? models.filter((m) => (m.label ?? m.id).toLowerCase().includes(node.filter.trim().toLowerCase()))
		: models

	const fetchModels = async () => {
		set({ error: null }, false)
		try {
			const result = await apiProviderModels({ kind: 'openai-compatible', baseURL: node.baseURL, keyRef: node.keyRef })
			const list: ModelListEntry[] = result.models.map((m) => ({ id: m.id, label: m.label }))
			set(
				{
					models: JSON.stringify(list),
					model: node.model && list.some((m) => m.id === node.model) ? node.model : (list[0]?.id ?? ''),
					fetchedAt: Date.now(),
					error: null,
				},
				false
			)
		} catch (e) {
			set({ error: (e as Error).message }, false)
		}
	}

	return (
		<>
			<NodeRow>
				<span className="NodeInputRow-label">For</span>
				<UiSegmented
					value={node.kind ?? 'chat'}
					options={[
						{ value: 'chat', label: 'Chat' },
						{ value: 'image', label: 'Image' },
					]}
					onChange={(kind) => set({ kind }, false)}
				/>
			</NodeRow>
			<NodeRow>
				<span className="NodeInputRow-label">URL</span>
				<UiTextInput
					placeholder="https://api.openai.com/v1"
					autoComplete="off"
					value={node.baseURL}
					onChange={(baseURL) => set({ baseURL }, false)}
				/>
				<NodeSelect
					className="NodeField-select ModelSourceNode-presets"
					value=""
					title="Presets"
					onPointerDown={stopEvent}
					onChange={(e) => {
						if (e.target.value) set({ baseURL: e.target.value }, false)
					}}
				>
					<option value="">Presets…</option>
					{presets.map((p) => (
						<option key={p.label} value={p.baseURL}>
							{p.label}
						</option>
					))}
				</NodeSelect>
			</NodeRow>
			<NodeRow>
				<span className="NodeInputRow-label">Key</span>
				<UiSecretInput value={node.keyRef} onChange={(keyRef) => set({ keyRef }, false)} placeholder="optional" />
			</NodeRow>
			<NodeRow>
				<UiButton size="sm" label="Fetch models" onClick={() => void fetchModels()} />
				<span className="ModelSourceNode-meta">
					{models.length ? `${models.length} models` : 'no models yet'} · {formatFetchedAt(node.fetchedAt)}
				</span>
			</NodeRow>
			<NodeRow>
				<UiTextInput
					placeholder="filter…"
					value={node.filter}
					onChange={(filter) => set({ filter }, false)}
				/>
				<NodeSelect
					className="NodeField-select"
					value={node.model}
					onPointerDown={stopEvent}
					onChange={(e) => set({ model: e.target.value })}
				>
					{!filtered.length && <option value="">No models — Fetch models first</option>}
					{filtered.map((m) => (
						<option key={m.id} value={m.id}>
							{m.label && m.label !== m.id ? `${m.label} (${m.id})` : m.id}
						</option>
					))}
				</NodeSelect>
			</NodeRow>
			<div className="ModelSourceNode-current" style={{ height: CURRENT_PX - 8 }}>
				{node.model || <span className="NodeRow-disconnected">No model chosen</span>}
			</div>
		</>
	)
}
