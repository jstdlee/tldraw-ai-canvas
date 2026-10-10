import { NodeSelect } from './NodeSelect'
import { TLShapeId, Editor, T } from 'tldraw'
import { IconChevronDown, IconChevronRight, UiButton, UiNumberInput, UiSlider, UiTextArea } from '../../../ui'
import { NODE_ROW_HEIGHT_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { findVars, fillVars, MAX_TEMPLATE_VARS } from '../../../../shared/templateVars'
import { NodeShape } from '../NodeShapeUtil'
import { NodeType } from '../nodeTypes'
import { PortRow, useInputConnected } from './fields'
import { InputValues, updateNode } from './shared'

/**
 * Per-node model settings for nodes that call a language model.
 * `temperature` / `maxTokens` of null mean "use the model's default".
 */
// Optional, so canvases saved before these settings existed still load.
export const LlmSettingsFields = {
	system: T.string.optional(),
	temperature: T.number.nullable().optional(),
	maxTokens: T.number.nullable().optional(),
	showSettings: T.boolean.optional(),
	thinking: T.string.optional(),
	/** Last call: tokens, time, and tokens per second. */
	lastUsage: T.string.optional(),
}

export interface LlmSettings {
	system?: string
	temperature?: number | null
	maxTokens?: number | null
	showSettings?: boolean
	/** '' = model default, 'none' | 'low' | 'medium' | 'high'. */
	thinking?: string
	/** Some cards (Image generation) declare this `string | null` from before WP10. */
	lastUsage?: string | null
}

// `lastUsage` here is always a plain string (never null): every card except Image
// generation declares it with `T.string.optional()` via `LlmSettingsFields`, so the
// default must stay assignable to `string | undefined`, not `string | null`.
export const DEFAULT_LLM_SETTINGS: Required<Omit<LlmSettings, 'lastUsage'>> & { lastUsage: string } = {
	system: '',
	temperature: null,
	maxTokens: null,
	showSettings: false,
	thinking: '',
	lastUsage: '',
}

/** One row per settings port (system, params), always shown so they can be wired. */
export const LLM_PORT_ROW_HEIGHT_PX = NODE_ROW_HEIGHT_PX
/** Height of the open settings panel (closed: the toggle + the two port rows). */
export const LLM_SETTINGS_OPEN_HEIGHT_PX = 196
export const LLM_SETTINGS_TOGGLE_HEIGHT_PX = 28
export function llmSettingsHeight(node: LlmSettings) {
	return LLM_SETTINGS_TOGGLE_HEIGHT_PX + LLM_PORT_ROW_HEIGHT_PX * 2 + (node.showSettings ? LLM_SETTINGS_OPEN_HEIGHT_PX : 0)
}

/** The `system` and `params` settings ports, one row each, right after the toggle row. */
export function llmSettingsPorts(startY: number): Record<string, ShapePort> {
	return {
		system: {
			id: 'system',
			x: 0,
			y: startY + LLM_SETTINGS_TOGGLE_HEIGHT_PX + LLM_PORT_ROW_HEIGHT_PX * 0.5,
			terminal: 'end',
			dataType: 'text',
		},
		params: {
			id: 'params',
			x: 0,
			y: startY + LLM_SETTINGS_TOGGLE_HEIGHT_PX + LLM_PORT_ROW_HEIGHT_PX * 1.5,
			terminal: 'end',
			dataType: 'text',
		},
	}
}

/** The `model` settings port, overriding the card's own model picker. Its own row. */
export function llmModelPort(y: number): ShapePort {
	return { id: 'model', x: 0, y, terminal: 'end', dataType: 'model' }
}

export function llmRequestSettings(node: LlmSettings) {
	return {
		system: node.system?.trim() || undefined,
		temperature: node.temperature ?? null,
		maxTokens: node.maxTokens ?? null,
		thinking: node.thinking || undefined,
	}
}

// ---------------------------------------------------------------------------
// Template variables: {{name}} in the card's text becomes an input port.
// ---------------------------------------------------------------------------

export { MAX_TEMPLATE_VARS }

/** Distinct `{{name}}` variables across the card's own texts, in order, capped. */
export function llmTemplateVars(texts: (string | undefined)[]): string[] {
	return findVars(texts)
}

/** One input port per variable, stacked one row each, starting at `startY`. */
export function llmVarPorts(vars: string[], startY: number): Record<string, ShapePort> {
	const ports: Record<string, ShapePort> = {}
	vars.forEach((name, i) => {
		ports[`var:${name}`] = {
			id: `var:${name}`,
			x: 0,
			y: startY + NODE_ROW_HEIGHT_PX * (i + 0.5),
			terminal: 'end',
			dataType: 'any',
		}
	})
	return ports
}

export function llmVarsHeight(vars: string[]) {
	return vars.length * NODE_ROW_HEIGHT_PX
}

/** One `PortRow` per `{{name}}` variable, shown below the card's own rows. */
export function LlmVarRows({ shapeId, vars }: { shapeId: TLShapeId; vars: string[] }) {
	return (
		<>
			{vars.map((name) => (
				<PortRow key={name} shapeId={shapeId} portId={`var:${name}`} label={`{{${name}}}`} dataType="any" />
			))}
		</>
	)
}

/** Fill `{{name}}` in `text` from the wired `var:<name>` inputs; warn about any left unwired. */
export function fillLlmTemplate(
	text: string,
	vars: string[],
	inputs: InputValues
): { text: string; warning?: string } {
	if (!vars.length) return { text }
	const values: Record<string, string> = {}
	const missing: string[] = []
	for (const name of vars) {
		const raw = inputs[`var:${name}`]
		const value = Array.isArray(raw) ? raw[0] : raw
		if (value == null || value === '') missing.push(name)
		values[name] = value == null ? '' : String(value)
	}
	return {
		text: fillVars(text, values),
		warning: missing.length ? `${missing.map((name) => `{{${name}}}`).join(', ')} not wired` : undefined,
	}
}

// ---------------------------------------------------------------------------
// params (JSON): temperature, maxTokens, thinking, topP, seed, n, size.
// ---------------------------------------------------------------------------

export interface LlmParamsOverride {
	temperature?: number
	maxTokens?: number
	thinking?: string
	topP?: number
	seed?: number
	n?: number
	size?: string
}

const PARAMS_ERROR = 'params must be JSON, e.g. {"temperature":0.2}'

/** Parse the `params` port's JSON text. Throws `PARAMS_ERROR` on invalid JSON. */
export function parseLlmParams(text: string): LlmParamsOverride {
	if (!text.trim()) return {}
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch {
		throw new Error(PARAMS_ERROR)
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(PARAMS_ERROR)
	return value as LlmParamsOverride
}

/** Combine a node's own settings with wired `model` / `system` / `params` overrides. */
export function llmEffectiveSettings(
	node: LlmSettings,
	inputs: InputValues
): ReturnType<typeof llmRequestSettings> & { model?: string } {
	const base = llmRequestSettings(node)
	const wiredSystem = inputs.system
	const system = typeof wiredSystem === 'string' && wiredSystem.trim() ? wiredSystem : base.system
	const wiredModel = inputs.model
	const model = typeof wiredModel === 'string' && wiredModel.trim() ? wiredModel : undefined
	const paramsText = inputs.params
	const params = parseLlmParams(typeof paramsText === 'string' ? paramsText : '')
	return {
		...base,
		system,
		model,
		temperature: params.temperature ?? base.temperature,
		maxTokens: params.maxTokens ?? base.maxTokens,
		thinking: params.thinking || base.thinking,
	}
}

/** Collapsible "Model settings" panel shown inside a node. */
export function LlmSettingsPanel<N extends NodeType & LlmSettings>({
	editor,
	shape,
	node,
	modelWired,
}: {
	editor: Editor
	shape: NodeShape
	node: N
	/** Whether the card's own "model" port is wired (shown in the badge count too). */
	modelWired?: boolean
}) {
	const set = (patch: Partial<LlmSettings>) =>
		updateNode<N>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const stop = (e: React.SyntheticEvent) => e.stopPropagation()
	const systemWired = useInputConnected(shape.id, 'system')
	const paramsWired = useInputConnected(shape.id, 'params')
	const wiredCount = (modelWired ? 1 : 0) + (systemWired ? 1 : 0) + (paramsWired ? 1 : 0)
	return (
		<div className="LlmSettings">
			<button
				type="button"
				className="LlmSettings-toggle"
				onPointerDown={stop}
				onClick={() => set({ showSettings: !node.showSettings })}
			>
				{node.showSettings ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
				Model settings
				{wiredCount > 0 ? (
					<span className="LlmSettings-badge">{wiredCount} wired</span>
				) : (
					!node.showSettings &&
					!node.lastUsage &&
					(node.system || node.temperature != null || node.maxTokens != null || node.thinking) && (
						<span className="LlmSettings-badge">custom</span>
					)
				)}
			</button>
			<PortRow shapeId={shape.id} portId="system" label="System" dataType="text" hint="optional" />
			<PortRow shapeId={shape.id} portId="params" label="Params" dataType="text" hint='e.g. {"temperature":0.2}' />
			{node.showSettings && (
				<div className="LlmSettings-body" style={{ height: LLM_SETTINGS_OPEN_HEIGHT_PX }}>
					<UiTextArea
						className="LlmSettings-system"
						placeholder={systemWired ? '(from the System input)' : 'System prompt (optional): role, tone, rules…'}
						disabled={systemWired}
						value={systemWired ? '' : (node.system ?? '')}
						onChange={(system) => set({ system })}
					/>
					<label className="LlmSettings-row">
						<span>Temperature</span>
						<UiSlider
							label="Temperature"
							min={0}
							max={2}
							step={0.1}
							value={node.temperature ?? 0.7}
							onChange={(temperature) => set({ temperature })}
						/>
						<span className="LlmSettings-value">
							{node.temperature == null ? 'auto' : node.temperature.toFixed(1)}
						</span>
						{node.temperature != null && (
							<UiButton size="sm" variant="low" label="reset" onClick={() => set({ temperature: null })} />
						)}
					</label>
					<label className="LlmSettings-row">
						<span>Thinking</span>
						<NodeSelect
							className="NodeField-select"
							value={node.thinking ?? ''}
							onPointerDown={stop}
							onChange={(e) => set({ thinking: e.target.value })}
						>
							<option value="">model default</option>
							<option value="none">off (fast)</option>
							<option value="low">low</option>
							<option value="medium">medium</option>
							<option value="high">high (slow, careful)</option>
						</NodeSelect>
					</label>
					<label className="LlmSettings-row">
						<span>Max tokens</span>
						<UiNumberInput
							min={1}
							placeholder="auto"
							value={node.maxTokens ?? null}
							onChange={(maxTokens) => set({ maxTokens: maxTokens == null ? null : Math.max(1, maxTokens) })}
						/>
					</label>
				</div>
			)}
		</div>
	)
}
