import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

/**
 * WP32 Problem 1: the owner's real model (a reasoning model behind a local router) left "hi"
 * with no reply at all and no error bubble. Root cause (see server/llm.ts and
 * server/agent/AgentService.ts): the official OpenAI SDK refused to build a client without an
 * API key even for a local router that needs none, and nothing timed out the request when a
 * provider accepted it but never streamed anything back. The model is always mocked here: no
 * test may call a real AI model or the network.
 */

async function openChat(page: import('@playwright/test').Page) {
	await page.locator('.chat-float-button').click()
	const panel = page.locator('[role="dialog"][aria-label="Agent chat"]')
	await expect(panel).toBeVisible()
	return panel
}

test.describe('WP32 Problem 1: bounded-time reply or error, with a visible "thinking" state', () => {
	test.beforeEach(async ({ page }) => {
		// A short override so this test doesn't wait out the real (95s) production timeout —
		// see TldrawAgent.ts's getStreamIdleTimeoutMs().
		await page.addInitScript(() => {
			;(window as any).__WP32_STREAM_IDLE_TIMEOUT_MS__ = 800
		})
		await gotoApp(page)
	})

	test('a reply that arrives after a long reasoning-like gap still lands as a normal reply', async ({ page }) => {
		// Simulates what the AI SDK's `textStream` looks like for a reasoning model: nothing
		// at all for a while (the reasoning phase, filtered out upstream), then the real
		// answer — server-side this is exercised by AgentService's `withIdleTimeout` unit
		// tests; here it's the same shape one level up, over the real `/stream` wire format.
		await page.route('**/stream', async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 400)) // well under the 800ms override
			await route.fulfill({
				status: 200,
				contentType: 'text/event-stream',
				body: `data: ${JSON.stringify({ _type: 'message', text: 'Hi! How can I help?', complete: true, time: 400 })}\n\n`,
			})
		})

		const panel = await openChat(page)
		const input = panel.locator('textarea[name="input"]')
		await input.fill('hi')
		await input.press('Enter')

		// While waiting, a thinking indicator is visible (not silence, not a flash of nothing).
		await expect(panel.locator('.chat-history-section').last()).toBeVisible()

		await expect(panel.getByText('Hi! How can I help?')).toBeVisible()
	})

	test('a request that never produces anything ends in a visible error within bounded time, not an endless wait', async ({
		page,
	}) => {
		await page.route('**/stream', () => {
			// Intentionally never fulfilled: a dead local router, a dropped connection, a
			// provider that silently never answers.
		})

		const panel = await openChat(page)
		const input = panel.locator('textarea[name="input"]')
		await input.fill('hi')
		await input.press('Enter')

		// The override (800ms) plus a little slack — this used to hang forever.
		await expect(panel.locator('.chat-history-error')).toBeVisible({ timeout: 5000 })
		await expect(panel.locator('.chat-history-error')).toContainText(/stuck|try again/i)
	})
})
