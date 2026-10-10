import { NodeSelect } from './NodeSelect'
import { Editor, T } from 'tldraw'
import { IconChevronDown, IconChevronRight, UiButton, UiNumberInput, UiSlider, UiTextArea } from '../../../ui'
import { NodeShape } from '../NodeShapeUtil'
import { NodeType } from '../nodeTypes'
import { updateNode } from './shared'

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
	lastUsage?: string
}

export const DEFAULT_LLM_SETTINGS: Required<LlmSettings> = {
	system: '',
	temperature: null,
	maxTokens: null,
	showSettings: false,
	thinking: '',
	lastUsage: '',
}

/** Height of the open settings panel (closed: one row for the toggle). */
export const LLM_SETTINGS_OPEN_HEIGHT_PX = 196
export const LLM_SETTINGS_TOGGLE_HEIGHT_PX = 28
export function llmSettingsHeight(node: LlmSettings) {
	return LLM_SETTINGS_TOGGLE_HEIGHT_PX + (node.showSettings ? LLM_SETTINGS_OPEN_HEIGHT_PX : 0)
}

export function llmRequestSettings(node: LlmSettings) {
	return {
		system: node.system?.trim() || undefined,
		temperature: node.temperature ?? null,
		maxTokens: node.maxTokens ?? null,
		thinking: node.thinking || undefined,
	}
}

/** Collapsible "Model settings" panel shown inside a node. */
export function LlmSettingsPanel<N extends NodeType & LlmSettings>({
	editor,
	shape,
	node,
}: {
	editor: Editor
	shape: NodeShape
	node: N
}) {
	const set = (patch: Partial<LlmSettings>) =>
		updateNode<N>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const stop = (e: React.SyntheticEvent) => e.stopPropagation()
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
				{!node.showSettings && !node.lastUsage && (node.system || node.temperature != null || node.maxTokens != null || node.thinking) && (
					<span className="LlmSettings-badge">custom</span>
				)}
			</button>
			{node.showSettings && (
				<div className="LlmSettings-body" style={{ height: LLM_SETTINGS_OPEN_HEIGHT_PX }}>
					<UiTextArea
						className="LlmSettings-system"
						placeholder="System prompt (optional): role, tone, rules…"
						value={node.system ?? ''}
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
