/**
 * WP31 Part C: maps the app's own provider/model config (shared/aiConfig.ts) to a pi-ai
 * `Model<Api>` definition. `getModel()` from pi-ai only knows its built-in catalog of model
 * ids, but this app lets a user type any model id for any provider (including local
 * servers), so every mapping builds a custom `Model` object instead — the same approach
 * the pi-ai README shows for Ollama/local/proxy models.
 */

import type { Api, Model } from '@mariozechner/pi-ai'
import { ModelConfig, ProviderConfig, cloudflareBase } from '../../shared/aiConfig'

const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_MAX_TOKENS = 8192
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

function apiFor(kind: ProviderConfig['kind']): Api {
	switch (kind) {
		case 'anthropic':
			return 'anthropic-messages'
		case 'google':
			return 'google-generative-ai'
		// OpenAI, OpenAI-compatible servers (Ollama/LM Studio/vLLM/OpenRouter/…) and
		// Cloudflare Workers AI (which exposes an OpenAI-compatible /v1 endpoint) all
		// speak the OpenAI chat-completions wire format.
		case 'openai':
		case 'openai-compatible':
		case 'cloudflare':
		default:
			return 'openai-completions'
	}
}

function baseUrlFor(provider: ProviderConfig): string {
	if (provider.kind === 'cloudflare') {
		return `${cloudflareBase(provider.accountId ?? '')}/v1`
	}
	return provider.baseURL || 'https://api.openai.com/v1'
}

/** Build the pi-ai model definition for one of this app's (provider, model) pairs. */
export function toPiModel(provider: ProviderConfig, model: ModelConfig): Model<Api> {
	const api = apiFor(provider.kind)
	return {
		id: model.model,
		name: model.label || model.model,
		api,
		provider: provider.id,
		baseUrl: baseUrlFor(provider),
		reasoning: !!model.reasoningEffort && model.reasoningEffort !== 'none',
		input: model.capabilities.includes('vision') ? ['text', 'image'] : ['text'],
		cost: ZERO_COST,
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: model.maxOutputTokens || DEFAULT_MAX_TOKENS,
	} as Model<Api>
}
