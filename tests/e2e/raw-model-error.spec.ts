import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator, nodeProps, runNode, zoomToFit } from './helpers'

/**
 * AI-06: a network-level failure calling the Raw model card's own endpoint (connection
 * refused, DNS, timeout) used to show the server's bare `fetch failed` TypeError verbatim —
 * no context on what was unreachable or why. Uses a real connection-refused port on
 * localhost (no internet dependency, no mocking needed — this exercises the real server route).
 */
test.describe('Raw model card: a network error gets a clear message', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('shows "Could not reach <url>", not the bare "fetch failed"', async ({ page }) => {
		const promptId = await createNode(page, { type: 'prompt', text: 'hi' }, { x: 0, y: 300 })
		const rawId = await createNode(
			page,
			{
				type: 'raw_model',
				url: 'http://127.0.0.1:1/v1', // port 1: always connection-refused, no network needed
				model: 'test-model',
				apiKey: '',
				keyRef: '',
				models: '',
				system: '',
				temperature: '',
				thinking: '',
				maxTokens: '',
				lastText: null,
				lastUsage: null,
				error: null,
			},
			{ x: 400, y: 100 }
		)
		const { wire } = await import('./helpers')
		await wire(page, promptId, 'output', rawId, 'prompt')
		await zoomToFit(page)
		await runNode(page, rawId)

		const node = await nodeProps<{ error: string | null }>(page, rawId)
		expect(node.error).toMatch(/Could not reach/)
		expect(node.error).not.toBe('fetch failed')
		await expect(nodeLocator(page, rawId)).toContainText('Could not reach')
	})
})
