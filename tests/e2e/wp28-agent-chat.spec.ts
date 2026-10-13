import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

/**
 * WP28: agent chat — plain replies get a real reply with no canvas change (Part A), and the
 * canvas doesn't flash connections/highlights for a plain conversation (Part B). The model is
 * always mocked: no test here may call a real AI model or the network.
 */

/** Build an SSE body `/stream` would send for a list of complete actions. */
function sseBody(actions: Record<string, unknown>[]): string {
	return actions.map((action) => `data: ${JSON.stringify({ ...action, complete: true, time: 50 })}\n\n`).join('')
}

async function mockStream(page: import('@playwright/test').Page, actions: Record<string, unknown>[]) {
	await page.route('**/stream', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'text/event-stream',
			body: sseBody(actions),
		})
	)
}

async function openChat(page: import('@playwright/test').Page) {
	await page.locator('.chat-float-button').click()
	const panel = page.locator('[role="dialog"][aria-label="Agent chat"]')
	await expect(panel).toBeVisible()
	return panel
}

test.describe('WP28 Part A: a plain message always gets a reply', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('"hi" with nothing selected shows an assistant reply and leaves the canvas untouched', async ({ page }) => {
		await mockStream(page, [{ _type: 'message', text: 'Hi! How can I help?' }])

		const shapeCountBefore = await page.evaluate(() => (window as any).editor.getCurrentPageShapes().length)

		const panel = await openChat(page)
		const input = panel.locator('textarea[name="input"]')
		await input.fill('hi')
		await input.press('Enter')

		await expect(panel.getByText('Hi! How can I help?')).toBeVisible()

		const shapeCountAfter = await page.evaluate(() => (window as any).editor.getCurrentPageShapes().length)
		expect(shapeCountAfter).toBe(shapeCountBefore)
	})

	test('a failed request shows an error reply instead of leaving the chat silent', async ({ page }) => {
		// No "actions" key at all: the server would see this as a non-JSON reply and error out,
		// the same way an unreachable or misconfigured model does.
		await page.route('**/stream', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'text/event-stream',
				body: `data: ${JSON.stringify({ error: 'did not return canvas actions' })}\n\n`,
			})
		)

		const panel = await openChat(page)
		const input = panel.locator('textarea[name="input"]')
		await input.fill('hi')
		await input.press('Enter')

		await expect(panel.locator('.chat-history-error')).toBeVisible()
		await expect(panel.locator('.chat-history-error')).toContainText('did not return canvas actions')
	})
})

test.describe('WP28 Part B: no pre-drawing', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('sending a message does not add any shape or highlight before a real action lands', async ({ page }) => {
		// Hangs forever (no fulfill) so the request is still "generating" when we check —
		// this is exactly the window where the canvas used to flash a box around the viewport.
		await page.route('**/stream', () => {
			// Intentionally never resolves for the duration of this test.
		})

		const shapeCountBefore = await page.evaluate(() => (window as any).editor.getCurrentPageShapes().length)

		const panel = await openChat(page)
		const input = panel.locator('textarea[name="input"]')
		await input.fill('hi')
		await input.press('Enter')

		// Give the (never-resolving) request a moment to start "generating".
		await page.waitForTimeout(300)

		const shapeCountDuring = await page.evaluate(() => (window as any).editor.getCurrentPageShapes().length)
		expect(shapeCountDuring).toBe(shapeCountBefore)
	})

	test('a real create action still draws a shape (so Part B is not over-suppressed)', async ({ page }) => {
		await mockStream(page, [
			{
				_type: 'create',
				intent: 'Draw a box',
				shape: {
					_type: 'rectangle',
					shapeId: 'shape1',
					x: 100,
					y: 100,
					w: 200,
					h: 100,
					color: 'black',
					fill: 'none',
					note: 'a box',
				},
			},
		])

		const panel = await openChat(page)
		const input = panel.locator('textarea[name="input"]')
		await input.fill('draw a box')
		await input.press('Enter')

		await expect
			.poll(() => page.evaluate(() => (window as any).editor.getCurrentPageShapes().length))
			.toBeGreaterThan(0)

		const shapeTypes = await page.evaluate(() =>
			(window as any).editor.getCurrentPageShapes().map((s: any) => s.type)
		)
		expect(shapeTypes).toContain('geo')
	})
})
