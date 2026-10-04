/**
 * User-defined AI providers and models.
 *
 * The server keeps this config in `data/ai-config.json`. The client edits it
 * through the "AI providers" dialog. API keys never leave the server: the
 * client only sees `hasApiKey`.
 */

export type ProviderKind = 'openai-compatible' | 'openai' | 'anthropic' | 'google' | 'systemone'

/** What a model can be used for. */
export type ModelCapability =
	/** Canvas agent: must follow a long JSON schema; strong models only. */
	| 'agent'
	/** Plain chat / text generation (branching chat, Generate Text node). */
	| 'chat'
	/** Accepts images as input (chat with sketches, describe image). */
	| 'vision'
	/** JEV decisions: probabilities for yes/no, choice and score questions. */
	| 'jev'

export const MODEL_CAPABILITIES: ModelCapability[] = ['agent', 'chat', 'vision', 'jev']

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high'

export interface ProviderConfig {
	id: string
	name: string
	kind: ProviderKind
	/** Base URL. For OpenAI-compatible servers this ends in `/v1`. */
	baseURL?: string
	apiKey?: string
	enabled: boolean
}

/** A provider as the client sees it: the key is replaced by a flag. */
export type PublicProviderConfig = Omit<ProviderConfig, 'apiKey'> & { hasApiKey: boolean }

export interface ModelConfig {
	/** Unique key, `providerId/model`. Used everywhere to pick a model. */
	key: string
	providerId: string
	/** Model id sent to the provider (for ComfyUI: the checkpoint file name). */
	model: string
	label: string
	capabilities: ModelCapability[]
	/** Prefill the assistant turn with `{"actions": [` (agent only; some models reject it). */
	supportsPrefill?: boolean
	/** Send `temperature: 0` (agent). Some reasoning models reject temperature. */
	supportsTemperature?: boolean
	reasoningEffort?: ReasoningEffort
	maxOutputTokens?: number
}

export interface AIDefaults {
	agent?: string
	chat?: string
	vision?: string
	jev?: string
}

export interface AIConfig {
	providers: ProviderConfig[]
	models: ModelConfig[]
	defaults: AIDefaults
}

export interface PublicAIConfig {
	providers: PublicProviderConfig[]
	models: ModelConfig[]
	defaults: AIDefaults
}

export interface ProviderKindInfo {
	label: string
	defaultBaseURL?: string
	needsApiKey: boolean
	/** Capabilities this kind of provider can offer. */
	capabilities: ModelCapability[]
	/** Works with no internet connection when the server runs on this machine. */
	local: boolean
}

export const PROVIDER_KINDS: Record<ProviderKind, ProviderKindInfo> = {
	'openai-compatible': {
		label: 'OpenAI-compatible (Ollama, LM Studio, vLLM, llama.cpp…)',
		defaultBaseURL: 'http://127.0.0.1:11434/v1',
		needsApiKey: false,
		capabilities: ['agent', 'chat', 'vision', 'jev'],
		local: true,
	},
	openai: {
		label: 'OpenAI',
		defaultBaseURL: 'https://api.openai.com/v1',
		needsApiKey: true,
		capabilities: ['agent', 'chat', 'vision', 'jev'],
		local: false,
	},
	anthropic: {
		label: 'Anthropic',
		defaultBaseURL: 'https://api.anthropic.com/v1',
		needsApiKey: true,
		capabilities: ['agent', 'chat', 'vision', 'jev'],
		local: false,
	},
	systemone: {
		label: 'JEV System One API (e.g. Julia-1 /v1/systemone)',
		defaultBaseURL: 'http://127.0.0.1:8011',
		needsApiKey: false,
		capabilities: ['jev'],
		local: true,
	},
	google: {
		label: 'Google Gemini',
		defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
		needsApiKey: true,
		capabilities: ['agent', 'chat', 'vision', 'jev'],
		local: false,
	},
}

/** Ready-made provider entries for the "Add provider" menu. */
export const PROVIDER_PRESETS: { label: string; provider: Omit<ProviderConfig, 'id'> }[] = [
	{
		label: 'Ollama',
		provider: {
			name: 'Ollama',
			kind: 'openai-compatible',
			baseURL: 'http://127.0.0.1:11434/v1',
			enabled: true,
		},
	},
	{
		label: 'LM Studio',
		provider: {
			name: 'LM Studio',
			kind: 'openai-compatible',
			baseURL: 'http://127.0.0.1:1234/v1',
			enabled: true,
		},
	},
	{
		label: 'vLLM / llama.cpp server',
		provider: {
			name: 'Local server',
			kind: 'openai-compatible',
			baseURL: 'http://127.0.0.1:8000/v1',
			enabled: true,
		},
	},
	{
		label: 'JEV / Julia (System One API)',
		provider: { name: 'JEV', kind: 'systemone', baseURL: 'http://127.0.0.1:8011', enabled: true },
	},
	{ label: 'OpenAI', provider: { name: 'OpenAI', kind: 'openai', enabled: true } },
	{ label: 'Anthropic', provider: { name: 'Anthropic', kind: 'anthropic', enabled: true } },
	{ label: 'Google Gemini', provider: { name: 'Google', kind: 'google', enabled: true } },
]

export function modelKey(providerId: string, model: string) {
	return `${providerId}/${model}`
}

export function getDefaultModelKey(
	config: { models: ModelConfig[]; defaults: AIDefaults },
	capability: ModelCapability
): string | undefined {
	const preferred = config.defaults[capability as keyof AIDefaults]
	if (preferred && config.models.some((m) => m.key === preferred)) return preferred
	return config.models.find((m) => m.capabilities.includes(capability))?.key
}

/**
 * Guess what a model can do from its id. Used when models are fetched from a
 * provider, so the user only has to fix the guesses that are wrong.
 */
export function guessCapabilities(kind: ProviderKind, model: string): ModelCapability[] {
	const id = model.toLowerCase()
	if (kind === 'systemone') return ['jev']
	// Image generators, embeddings and speech models can't chat.
	if (/(dall-e|gpt-image|flux|sdxl|stable-diffusion|imagen|embed|whisper|tts|rerank)/.test(id)) return []
	const caps: ModelCapability[] = ['chat']
	if (/(vl|vision|gpt-4o|gpt-4\.1|gpt-5|claude|gemini|llava|gemma3|gemma4|pixtral|qwen2\.5-omni)/.test(id)) {
		caps.push('vision')
	}
	if (kind !== 'openai-compatible' || /(qwen3|llama-?3\.3|gpt-oss|deepseek|glm|kimi|mistral-large)/.test(id)) {
		caps.push('agent')
	}
	return caps
}
