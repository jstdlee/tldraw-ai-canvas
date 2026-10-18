import { T, useEditor } from 'tldraw'
import { categoryOf } from '../../../../shared/nodeGroups'
import { buildAdhocModelValue } from '../../../../shared/modelRef'
import { useAIConfig } from '../../../ai/aiConfig'
import { cloudflareBase } from '../../../../shared/aiConfig'
import { apiProviderModels } from '../../api/pipelineApi'
import { getNodeRowHeightPx, GROW_FIELD_EXTRA_PX, NODE_HEADER_HEIGHT_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import { UiButton, UiGrowingInput, UiSecretInput, UiSegmented } from '../../../ui'
import { OutputPortRow, stopEvent, NodeSelect, WireField } from './fields'
import { ExecutionResult, InfoValues, NodeComponentProps, NodeDefinition, NodeRow, updateNode } from './shared'

function ModelProviderIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<rect x="2.5" y="5" width="11" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
			<path d="M5 5V3M11 5V3M5 13v1M11 13v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	)
}

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
	getBodyHeightPx(shape: NodeShape): number {
		// kind, URL, key, fetch (with the model count/fetched-at line inline), filter, model
		// rows (WP17: filter/model split onto their own rows), plus the big chosen-model line,
		// plus 2 rows (WP21 Part C) for the modelId/baseURL output rows at the bottom.
		// WP27 Part B: Filter wraps/grows instead of a single-line cutoff.
		// WP39: URL no longer wraps (it stays one line and scrolls horizontally instead of
		// breaking a URL mid-word — see UiGrowingInput_nowrap in ui.css), so it no longer needs
		// its own share of this slack, just Filter's.
		return getNodeRowHeightPx(shape.props.fontSize) * 8 + CURRENT_PX + GROW_FIELD_EXTRA_PX / 2
	}
	getPorts(shape: NodeShape): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		// Fallback position only (before the row below has ever mounted): after the 6 rows
		// above the chosen-model box, plus that box itself.
		const bottomY = NODE_HEADER_HEIGHT_PX / 2 + rowPx * 6.5 + CURRENT_PX
		return {
			model: {
				id: 'model',
				x: WIDTH,
				y: NODE_HEADER_HEIGHT_PX / 2,
				terminal: 'start',
				dataType: 'model',
			},
			// WP21 Part C: the chosen model id and base URL, each wirable on their own.
			modelId: { id: 'modelId', x: WIDTH, y: bottomY, terminal: 'start', dataType: 'text' },
			baseURL: { id: 'baseURL', x: WIDTH, y: bottomY + rowPx, terminal: 'start', dataType: 'text' },
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
			modelId: node.model.trim(),
			baseURL: node.baseURL.trim(),
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
			modelId: { value: node.model.trim() || null, isOutOfDate: shape.props.isOutOfDate, dataType: 'text' },
			baseURL: { value: node.baseURL.trim() || null, isOutOfDate: shape.props.isOutOfDate, dataType: 'text' },
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
			<WireField shapeId={shape.id} fieldKey="kind" label="For">
				<UiSegmented
					value={node.kind ?? 'chat'}
					options={[
						{ value: 'chat', label: 'Chat' },
						{ value: 'image', label: 'Image' },
					]}
					onChange={(kind) => set({ kind }, false)}
				/>
			</WireField>
			<WireField shapeId={shape.id} fieldKey="baseURL" label="URL" grow>
				<>
					<UiGrowingInput
						className="UiGrowingInput_nowrap"
						maxRows={3}
						placeholder="https://api.openai.com/v1"
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
				</>
			</WireField>
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
			<WireField shapeId={shape.id} fieldKey="filter" label="Filter" grow>
				<UiGrowingInput
					maxRows={2}
					placeholder="filter…"
					value={node.filter}
					onChange={(filter) => set({ filter }, false)}
				/>
			</WireField>
			<WireField shapeId={shape.id} fieldKey="model" label="Model" dataType="model">
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
			</WireField>
			<div className="ModelSourceNode-current" style={{ height: CURRENT_PX - 8 }}>
				{node.model || <span className="NodeRow-disconnected">No model chosen</span>}
			</div>
			<OutputPortRow shapeId={shape.id} portId="modelId" label="Model id" dataType="text" />
			<OutputPortRow shapeId={shape.id} portId="baseURL" label="Base URL" dataType="text" />
		</>
	)
}
