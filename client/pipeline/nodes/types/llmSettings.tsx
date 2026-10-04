import { Editor, T } from 'tldraw'
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
}

export interface LlmSettings {
	system?: string
	temperature?: number | null
	maxTokens?: number | null
	showSettings?: boolean
}

export const DEFAULT_LLM_SETTINGS: Required<LlmSettings> = {
	system: '',
	temperature: null,
	maxTokens: null,
	showSettings: false,
}

/** Height of the open settings panel (closed: one row for the toggle). */
export const LLM_SETTINGS_OPEN_HEIGHT_PX = 150
export const LLM_SETTINGS_TOGGLE_HEIGHT_PX = 28

export function llmSettingsHeight(node: LlmSettings) {
	return LLM_SETTINGS_TOGGLE_HEIGHT_PX + (node.showSettings ? LLM_SETTINGS_OPEN_HEIGHT_PX : 0)
}

export function llmRequestSettings(node: LlmSettings) {
	return {
		system: node.system?.trim() || undefined,
		temperature: node.temperature ?? null,
		maxTokens: node.maxTokens ?? null,
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
				className="LlmSettings-toggle"
				onPointerDown={stop}
				onClick={() => set({ showSettings: !node.showSettings })}
			>
				{node.showSettings ? '▾' : '▸'} Model settings
				{!node.showSettings && (node.system || node.temperature != null || node.maxTokens != null) && (
					<span className="LlmSettings-badge">custom</span>
				)}
			</button>
			{node.showSettings && (
				<div className="LlmSettings-body" style={{ height: LLM_SETTINGS_OPEN_HEIGHT_PX }}>
					<textarea
						className="LlmSettings-system"
						placeholder="System prompt (optional): role, tone, rules…"
						value={node.system ?? ''}
						onPointerDown={stop}
						onKeyDown={stop}
						onChange={(e) => set({ system: e.target.value })}
					/>
					<label className="LlmSettings-row">
						<span>Temperature</span>
						<input
							type="range"
							min={0}
							max={2}
							step={0.1}
							value={node.temperature ?? 0.7}
							onPointerDown={stop}
							onChange={(e) => set({ temperature: Number(e.target.value) })}
						/>
						<span className="LlmSettings-value">
							{node.temperature == null ? 'auto' : node.temperature.toFixed(1)}
						</span>
						{node.temperature != null && (
							<button className="LlmSettings-reset" onPointerDown={stop} onClick={() => set({ temperature: null })}>
								reset
							</button>
						)}
					</label>
					<label className="LlmSettings-row">
						<span>Max tokens</span>
						<input
							type="number"
							min={1}
							placeholder="auto"
							value={node.maxTokens ?? ''}
							onPointerDown={stop}
							onKeyDown={stop}
							onChange={(e) => set({ maxTokens: e.target.value ? Math.max(1, Number(e.target.value)) : null })}
						/>
					</label>
				</div>
			)}
		</div>
	)
}
