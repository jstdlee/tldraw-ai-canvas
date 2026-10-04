import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
	AIConfig,
	getDefaultModelKey,
	MODEL_CAPABILITIES,
	ModelCapability,
	PROVIDER_KINDS,
	ModelConfig,
	ProviderConfig,
	PublicAIConfig,
	PublicProviderConfig,
} from '../shared/aiConfig'

/** All runtime data (config, generated images) lives here. Never committed. */
export const DATA_DIR = resolve(process.env.DATA_DIR ?? join(process.cwd(), 'data'))
const CONFIG_PATH = join(DATA_DIR, 'ai-config.json')

/** First-run config: Ollama on this machine, no models yet (use "Fetch models"). */
const SEED_CONFIG: AIConfig = {
	providers: [
		{
			id: 'ollama',
			name: 'Ollama',
			kind: 'openai-compatible',
			baseURL: 'http://127.0.0.1:11434/v1',
			enabled: true,
		},
	],
	models: [],
	defaults: {},
}

let cached: AIConfig | null = null

export function loadConfig(): AIConfig {
	if (cached) return cached
	if (!existsSync(CONFIG_PATH)) {
		cached = structuredClone(SEED_CONFIG)
		return cached
	}
	const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<AIConfig>
	// Older configs may hold image providers (ComfyUI, Replicate) and image jobs: drop them.
	const providers = (raw.providers ?? []).filter((p) => p.kind in PROVIDER_KINDS)
	const ids = new Set(providers.map((p) => p.id))
	const models = (raw.models ?? [])
		.filter((m) => ids.has(m.providerId))
		.map((m) => ({ ...m, capabilities: m.capabilities.filter((c) => MODEL_CAPABILITIES.includes(c)) }))
	const defaults = Object.fromEntries(
		Object.entries(raw.defaults ?? {}).filter(([job]) => MODEL_CAPABILITIES.includes(job as ModelCapability))
	)
	cached = { providers, models, defaults }
	return cached
}

/** Forget the cached config and read the file again. */
export function reloadConfig(): AIConfig {
	cached = null
	return loadConfig()
}

export function saveConfig(config: AIConfig) {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true })
	const tmp = `${CONFIG_PATH}.tmp`
	writeFileSync(tmp, JSON.stringify(config, null, '\t'), { mode: 0o600 })
	renameSync(tmp, CONFIG_PATH)
	chmodSync(CONFIG_PATH, 0o600)
	cached = config
}

export function toPublicConfig(config: AIConfig): PublicAIConfig {
	return {
		providers: config.providers.map(({ apiKey, ...p }) => ({ ...p, hasApiKey: !!apiKey })),
		models: config.models,
		defaults: config.defaults,
	}
}

/**
 * Apply a config edited by the client. The client never sees keys, so a
 * provider without `apiKey` keeps its stored key; an empty string clears it.
 */
export type ClientAIConfig = Omit<PublicAIConfig, 'providers'> & {
	providers: (PublicProviderConfig & { apiKey?: string })[]
}

export function mergeClientConfig(incoming: ClientAIConfig): AIConfig {
	const current = loadConfig()
	const providers: ProviderConfig[] = incoming.providers.map(({ hasApiKey: _h, apiKey, ...p }) => {
		const stored = current.providers.find((c) => c.id === p.id)?.apiKey
		const key = apiKey === undefined ? stored : apiKey || undefined
		return { ...p, ...(key ? { apiKey: key } : {}) }
	})
	const providerIds = new Set(providers.map((p) => p.id))
	return {
		providers,
		models: incoming.models.filter((m) => providerIds.has(m.providerId)),
		defaults: incoming.defaults ?? {},
	}
}

export class ConfigError extends Error {
	status = 400
}

export function getProvider(id: string): ProviderConfig {
	const provider = loadConfig().providers.find((p) => p.id === id)
	if (!provider) throw new ConfigError(`Unknown provider "${id}". Open AI providers to add it.`)
	if (!provider.enabled) throw new ConfigError(`Provider "${provider.name}" is turned off.`)
	return provider
}

/**
 * Find the model to use. `key` may be empty or stale; then the default model
 * for the capability is used.
 */
export function resolveModel(
	key: string | undefined | null,
	capability: ModelCapability
): { model: ModelConfig; provider: ProviderConfig } {
	const config = loadConfig()
	let model = key ? config.models.find((m) => m.key === key) : undefined
	if (!model && key) {
		// A model picked straight from a provider's live list ("providerId/model"),
		// not added in the AI providers dialog: use it with default settings.
		const provider = config.providers.find((p) => key.startsWith(`${p.id}/`))
		if (provider) {
			const id = key.slice(provider.id.length + 1)
			model = { key, providerId: provider.id, model: id, label: id, capabilities: [capability] }
		}
	}
	if (!model) {
		const fallback = getDefaultModelKey(config, capability)
		model = config.models.find((m) => m.key === fallback)
	}
	if (!model) {
		throw new ConfigError(
			`No model for "${capability}". Open AI providers, fetch models and tick "${capability}".`
		)
	}
	return { model, provider: getProvider(model.providerId) }
}
