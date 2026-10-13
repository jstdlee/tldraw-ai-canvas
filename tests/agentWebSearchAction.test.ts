import { describe, expect, it } from 'vitest'
import { $searchConfig, firstConfiguredSearchProvider } from '../client/ai/aiConfig'
import { WebSearchAction } from '../shared/schema/AgentActionSchemas'

describe('agent web-search action (WP31 Part E): gating + schema', () => {
	it('firstConfiguredSearchProvider is undefined before the config loads', () => {
		$searchConfig.set(null)
		expect(firstConfiguredSearchProvider()).toBeUndefined()
	})

	it('firstConfiguredSearchProvider is undefined when no provider has a key', () => {
		$searchConfig.set({})
		expect(firstConfiguredSearchProvider()).toBeUndefined()
	})

	it('firstConfiguredSearchProvider picks a configured provider, preferring exa/tavily/brave order', () => {
		$searchConfig.set({ brave: { keyRef: 'secret:b' } })
		expect(firstConfiguredSearchProvider()).toBe('brave')
		$searchConfig.set({ exa: { keyRef: 'secret:e' }, brave: { keyRef: 'secret:b' } })
		expect(firstConfiguredSearchProvider()).toBe('exa')
	})

	it('the web-search action schema requires _type and a string query', () => {
		expect(WebSearchAction.safeParse({ _type: 'web-search', query: 'local-first software' }).success).toBe(true)
		expect(WebSearchAction.safeParse({ _type: 'web-search' }).success).toBe(false)
		expect(WebSearchAction.safeParse({ _type: 'wrong', query: 'x' }).success).toBe(false)
	})
})
