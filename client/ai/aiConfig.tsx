import { NodeSelect } from '../pipeline/nodes/types/NodeSelect'
import { atom, useValue } from 'tldraw'
import {
	getDefaultModelKey,
	ModelCapability,
	ModelConfig,
	PublicAIConfig,
	PublicProviderConfig,
} from '../../shared/aiConfig'
import { McpServerConfig } from '../../shared/mcpConfig'
import { SearchProviderId } from '../../shared/search'
import { SkillInfo } from '../../shared/skills'

/** The user's AI providers and models, as served by the local server (no keys). */
export const $aiConfig = atom<PublicAIConfig | null>('ai config', null)
export const $aiConfigError = atom<string | null>('ai config error', null)

async function readJson<T>(res: Response): Promise<T> {
	const data = await res.json().catch(() => ({ error: res.statusText }))
	if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
	return data as T
}

let retryTimer: ReturnType<typeof setTimeout> | undefined

/** Load the config; while the server is down, keep retrying every 3 s. */
export async function refreshAIConfig() {
	clearTimeout(retryTimer)
	try {
		$aiConfig.set(await readJson<PublicAIConfig>(await fetch('/api/config')))
		$aiConfigError.set(null)
	} catch (e) {
		$aiConfigError.set(`Cannot reach the local server: ${(e as Error).message}`)
		retryTimer = setTimeout(refreshAIConfig, 3000)
	}
}

// Another tab (or a script) may have changed the config.
if (typeof window !== 'undefined') window.addEventListener('focus', () => refreshAIConfig())

/** Save the config. Providers may carry a new `apiKey` ('' clears it). */
export async function saveAIConfig(
	config: Omit<PublicAIConfig, 'providers'> & {
		providers: (PublicProviderConfig & { apiKey?: string })[]
	}
) {
	const saved = await readJson<PublicAIConfig>(
		await fetch('/api/config', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(config),
		})
	)
	$aiConfig.set(saved)
	return saved
}

export async function fetchProviderModels(
	provider: PublicProviderConfig & { apiKey?: string }
): Promise<{ id: string; label?: string; vision?: boolean }[]> {
	const res = await fetch('/api/providers/models', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ provider }),
	})
	return (await readJson<{ models: { id: string; label?: string; vision?: boolean }[] }>(res)).models
}

/** WP24: the "Search providers" section's own small config (Exa/Tavily/Brave key refs). */
export type SearchConfig = Partial<Record<'exa' | 'tavily' | 'brave', { keyRef?: string }>>

export async function fetchSearchConfig(): Promise<SearchConfig> {
	return readJson<SearchConfig>(await fetch('/api/search-config'))
}

export async function saveSearchConfig(config: SearchConfig): Promise<SearchConfig> {
	return readJson<SearchConfig>(
		await fetch('/api/search-config', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(config),
		})
	)
}

/** Runs one real query against a search provider (used by the "Test" button in the providers
 * dialog's unified list). Throws with the server's message on failure (bad/missing key, etc). */
export async function testSearchProvider(provider: SearchProviderId, keyRef: string | undefined): Promise<number> {
	const result = await readJson<{ results: unknown[] }>(
		await fetch('/api/search', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ provider, query: 'test', count: 1, keyRef }),
		})
	)
	return result.results.length
}

// --- WP31: MCP servers + skills ---------------------------------------------

export async function fetchMcpConfig(): Promise<McpServerConfig[]> {
	return readJson<McpServerConfig[]>(await fetch('/api/mcp-config'))
}

export async function saveMcpConfig(config: McpServerConfig[]): Promise<McpServerConfig[]> {
	return readJson<McpServerConfig[]>(
		await fetch('/api/mcp-config', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(config),
		})
	)
}

export async function testMcpServer(server: McpServerConfig): Promise<{ name: string; description?: string }[]> {
	return (
		await readJson<{ tools: { name: string; description?: string }[] }>(
			await fetch('/api/mcp-config/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ server }),
			})
		)
	).tools
}

export async function fetchSkills(rescan = false): Promise<SkillInfo[]> {
	return (await readJson<{ skills: SkillInfo[] }>(await fetch(rescan ? '/api/skills/rescan' : '/api/skills', { method: rescan ? 'POST' : 'GET' })))
		.skills
}

/** WP31 Part E: whether the canvas agent chat may offer its `web-search` action — only
 * when at least one search provider (Exa/Tavily/Brave) has a saved key. */
export const $searchConfig = atom<SearchConfig | null>('search config (agent)', null)
export function loadSearchProviders() {
	if ($searchConfig.get()) return
	fetchSearchConfig()
		.then((c) => $searchConfig.set(c))
		.catch(() => {})
}
export function firstConfiguredSearchProvider(): 'exa' | 'tavily' | 'brave' | undefined {
	const config = $searchConfig.get()
	if (!config) return undefined
	return (['exa', 'tavily', 'brave'] as const).find((id) => config[id]?.keyRef)
}

/** For the Agent card's multi-selects: configured MCP servers and scanned skills, loaded once. */
export const $mcpServers = atom<McpServerConfig[] | null>('mcp servers', null)
export const $skills = atom<SkillInfo[] | null>('skills', null)
let mcpSkillsLoading = false

export function loadMcpServersAndSkills(force = false) {
	if (mcpSkillsLoading) return
	if (!force && $mcpServers.get() && $skills.get()) return
	mcpSkillsLoading = true
	Promise.all([
		fetchMcpConfig().then((s) => $mcpServers.set(s)),
		fetchSkills().then((s) => $skills.set(s)),
	])
		.catch(() => {})
		.finally(() => {
			mcpSkillsLoading = false
		})
}

export function useAIConfig() {
	return useValue('ai config', () => $aiConfig.get(), [])
}

export function useModels(capability: ModelCapability): ModelConfig[] {
	return useValue(
		'models ' + capability,
		() => ($aiConfig.get()?.models ?? []).filter((m) => m.capabilities.includes(capability)),
		[capability]
	)
}

export function getDefaultModel(capability: ModelCapability): ModelConfig | undefined {
	const config = $aiConfig.get()
	if (!config) return undefined
	const key = getDefaultModelKey(config, capability)
	return config.models.find((m) => m.key === key)
}

export function getModelLabel(key: string | null | undefined, capability: ModelCapability) {
	const config = $aiConfig.get()
	const model = key ? config?.models.find((m) => m.key === key) : getDefaultModel(capability)
	if (!model && key) {
		const live = $liveModels.get()?.flatMap((p) => p.models).find((m) => m.key === key)
		return live?.label ?? key.slice(key.indexOf('/') + 1)
	}
	if (!model) return 'No model set'
	return model.label || model.key
}

export interface LiveModel {
	key: string
	model: string
	label: string
	capabilities: ModelCapability[]
}

export interface LiveProviderModels {
	providerId: string
	providerName: string
	error?: string
	models: LiveModel[]
}

/** Every model the enabled providers report (their /v1/models), loaded on demand. */
export const $liveModels = atom<LiveProviderModels[] | null>('live models', null)
let liveLoading: Promise<void> | null = null
let liveLoadedAt = 0

export function loadLiveModels(force = false) {
	if (liveLoading) return liveLoading
	if (!force && $liveModels.get() && Date.now() - liveLoadedAt < 60_000) return Promise.resolve()
	liveLoading = fetch('/api/models')
		.then((res) => readJson<{ providers: LiveProviderModels[] }>(res))
		.then((data) => {
			$liveModels.set(data.providers)
			liveLoadedAt = Date.now()
		})
		.catch(() => {})
		.finally(() => {
			liveLoading = null
		})
	return liveLoading
}

/** Whether the AI providers dialog is open. */
export const $providersDialogOpen = atom('providers dialog open', false)
export function openProvidersDialog() {
	$providersDialogOpen.set(true)
}

/**
 * A model picker limited to models with one capability. The empty value
 * means "the default model for this capability".
 */
export function ModelSelect({
	capability,
	value,
	onChange,
	className,
	title,
}: {
	capability: ModelCapability
	value: string
	onChange(value: string): void
	className?: string
	title?: string
}) {
	const models = useModels(capability)
	const defaultLabel = useValue('default label', () => getModelLabel(null, capability), [capability])
	const live = useValue('live models', () => $liveModels.get(), [])
	const configured = new Set(models.map((m) => m.key))
	const liveGroups = (live ?? [])
		.map((p) => ({
			...p,
			models: p.models.filter((m) => m.capabilities.includes(capability) && !configured.has(m.key)),
		}))
		.filter((p) => p.models.length > 0)
	const isLive = liveGroups.some((p) => p.models.some((m) => m.key === value))
	const missing = value && !configured.has(value) && !isLive
	return (
		<NodeSelect
			className={className}
			title={title ?? (value || 'Default model')}
			value={value}
			onFocus={() => loadLiveModels()}
			onPointerDown={(e) => {
				e.stopPropagation()
				loadLiveModels()
			}}
			onChange={(e) => {
				if (e.target.value === '__providers__') {
					openProvidersDialog()
					return
				}
				onChange(e.target.value)
			}}
		>
			<option value="">Default: {defaultLabel}</option>
			{models.map((m) => (
				<option key={m.key} value={m.key}>
					{m.label || m.key}
				</option>
			))}
			{liveGroups.map((p) => (
				<optgroup key={p.providerId} label={`${p.providerName} — all models`}>
					{p.models.map((m) => (
						<option key={m.key} value={m.key}>
							{m.label === m.model ? m.model : `${m.label} (${m.model})`}
						</option>
					))}
				</optgroup>
			))}
			{missing && <option value={value}>{value}</option>}
			{!live && <option disabled>Loading models from providers…</option>}
			<option value="__providers__">AI providers…</option>
		</NodeSelect>
	)
}
