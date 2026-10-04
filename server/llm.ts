import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel, streamText } from 'ai'
import { ModelConfig, ProviderConfig } from '../shared/aiConfig'
import { ConfigError } from './config'

/** Build an AI SDK language model from a user-defined provider and model. */
export function getLanguageModel(provider: ProviderConfig, model: ModelConfig): LanguageModel {
	const baseURL = provider.baseURL?.replace(/\/+$/, '') || undefined
	switch (provider.kind) {
		case 'openai-compatible':
			if (!baseURL) throw new ConfigError(`Provider "${provider.name}" needs a base URL.`)
			return createOpenAICompatible({
				name: provider.id,
				baseURL,
				apiKey: provider.apiKey,
			}).chatModel(model.model)
		case 'openai':
			return createOpenAI({ apiKey: provider.apiKey, baseURL })(model.model)
		case 'anthropic':
			return createAnthropic({ apiKey: provider.apiKey, baseURL })(model.model)
		case 'google':
			return createGoogleGenerativeAI({ apiKey: provider.apiKey, baseURL })(model.model)
		default:
			throw new ConfigError(
				`Provider "${provider.name}" (${provider.kind}) cannot run language models.`
			)
	}
}

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>

/** Reasoning settings for the matching provider; other providers ignore them. */
export function getProviderOptions(provider: ProviderConfig, model: ModelConfig): ProviderOptions {
	const effort = model.reasoningEffort
	if (!effort) return {}
	switch (provider.kind) {
		case 'openai':
			return { openai: { reasoningEffort: effort } }
		case 'openai-compatible':
			return { [provider.id]: { reasoningEffort: effort } }
		case 'anthropic':
			return effort === 'none'
				? { anthropic: { thinking: { type: 'disabled' } } }
				: { anthropic: { thinking: { type: 'enabled', budgetTokens: THINKING_BUDGET[effort] } } }
		case 'google':
			return effort === 'none'
				? {}
				: { google: { thinkingConfig: { thinkingBudget: THINKING_BUDGET[effort] } } }
		default:
			return {}
	}
}

const THINKING_BUDGET = { minimal: 1024, low: 2048, medium: 8192, high: 16384 } as const

export interface ProviderModelInfo {
	id: string
	label?: string
	/** Set when the provider says whether the model takes images. */
	vision?: boolean
}

/** Ask a provider which models it serves (for the "Fetch models" button). */
export async function listProviderModels(provider: ProviderConfig): Promise<ProviderModelInfo[]> {
	const base = provider.baseURL?.replace(/\/+$/, '')
	const json = async (url: string, headers: Record<string, string> = {}) => {
		const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })
		if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`)
		return (await res.json()) as any
	}
	switch (provider.kind) {
		case 'openai-compatible':
		case 'openai': {
			const url = `${base ?? 'https://api.openai.com/v1'}/models`
			const auth: Record<string, string> = provider.apiKey
				? { Authorization: `Bearer ${provider.apiKey}` }
				: {}
			const data = await json(url, auth)
			return (data.data ?? data.models ?? []).map((m: any) => {
				const input: unknown = m.modalities?.input ?? m.architecture?.input_modalities
				return {
					id: m.id ?? m.name,
					label: m.display_name ?? m.name,
					...(Array.isArray(input) ? { vision: input.includes('image') } : {}),
				}
			})
		}
		case 'anthropic': {
			const data = await json(`${base ?? 'https://api.anthropic.com/v1'}/models?limit=100`, {
				'x-api-key': provider.apiKey ?? '',
				'anthropic-version': '2023-06-01',
			})
			return data.data.map((m: any) => ({ id: m.id, label: m.display_name }))
		}
		case 'google': {
			const data = await json(
				`${base ?? 'https://generativelanguage.googleapis.com/v1beta'}/models?pageSize=200`,
				{ 'x-goog-api-key': provider.apiKey ?? '' }
			)
			return data.models
				.filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
				.map((m: any) => ({ id: String(m.name).replace(/^models\//, ''), label: m.displayName }))
		}
	}
}
