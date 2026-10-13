import { describe, expect, it } from 'vitest'
import { toPiModel } from '../server/agent/model'
import { ModelConfig, ProviderConfig } from '../shared/aiConfig'

function provider(partial: Partial<ProviderConfig>): ProviderConfig {
	return { id: 'p', name: 'P', kind: 'openai-compatible', enabled: true, ...partial }
}
function model(partial: Partial<ModelConfig>): ModelConfig {
	return { key: 'p/m', providerId: 'p', model: 'm', label: 'M', capabilities: ['agent'], ...partial }
}

describe('agent model mapping: app provider/model -> pi-ai Model', () => {
	it('maps openai-compatible to openai-completions with the provider baseURL', () => {
		const m = toPiModel(provider({ kind: 'openai-compatible', baseURL: 'http://127.0.0.1:11434/v1' }), model({}))
		expect(m.api).toBe('openai-completions')
		expect(m.baseUrl).toBe('http://127.0.0.1:11434/v1')
		expect(m.id).toBe('m')
	})

	it('maps anthropic to anthropic-messages', () => {
		const m = toPiModel(provider({ kind: 'anthropic', baseURL: 'https://api.anthropic.com/v1' }), model({}))
		expect(m.api).toBe('anthropic-messages')
	})

	it('maps google to google-generative-ai', () => {
		const m = toPiModel(provider({ kind: 'google' }), model({}))
		expect(m.api).toBe('google-generative-ai')
	})

	it('maps cloudflare to an OpenAI-compatible endpoint under the account', () => {
		const m = toPiModel(provider({ kind: 'cloudflare', accountId: 'abc123' }), model({}))
		expect(m.api).toBe('openai-completions')
		expect(m.baseUrl).toContain('abc123')
		expect(m.baseUrl).toMatch(/\/v1$/)
	})

	it('vision capability adds image input', () => {
		const m = toPiModel(provider({}), model({ capabilities: ['agent', 'vision'] }))
		expect(m.input).toEqual(['text', 'image'])
	})

	it('no vision capability -> text only', () => {
		const m = toPiModel(provider({}), model({ capabilities: ['agent'] }))
		expect(m.input).toEqual(['text'])
	})

	it('falls back to a sane default baseURL for openai when none set', () => {
		const m = toPiModel(provider({ kind: 'openai', baseURL: undefined }), model({}))
		expect(m.baseUrl).toBe('https://api.openai.com/v1')
	})
})
