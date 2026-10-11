import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeProps, zoomToFit } from './helpers'

/**
 * WP21 Part E ("HTTP request: import from text"): the HTTP card's "Import request…" button
 * opens a paste dialog; applying a captured cURL command fills method/url/query/headers/body
 * (and moves a bearer token into the secret store as authRef, never plain text on the card).
 */
test.describe('HTTP card: import request', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('pasting a curl command fills the card fields', async ({ page }) => {
		const id = await createNode(
			page,
			{
				type: 'http',
				method: 'GET',
				url: 'https://example.com',
				query: '',
				headers: '',
				body: '',
				auth: '',
				authValue: '',
				extractText: true,
				lastStatus: null,
				lastText: null,
				lastImageUrl: null,
				lastHeaders: null,
				lastMs: null,
				error: null,
			},
			{ x: 100, y: 100 }
		)
		await zoomToFit(page)

		// Dismiss the "No AI models yet" banner, if present — it overlaps the canvas and can
		// intercept clicks on a card placed near the top.
		const hideBanner = page.locator('.app-banner', { hasText: 'No AI models yet' }).getByText('×')
		if (await hideBanner.isVisible().catch(() => false)) await hideBanner.click()

		await page.locator(`[data-shape-id="${id}"] button`, { hasText: 'Import request…' }).click()
		const dialog = page.locator('.LargeEditor[aria-label^="Import request"]')
		await expect(dialog).toBeVisible()
		await dialog
			.locator('textarea')
			.fill(
				`curl 'https://api.example.com/v1/items?limit=5' -H 'Authorization: Bearer tok-abc-123' -H 'Content-Type: application/json' --data-raw '{"a":1}'`
			)
		await dialog.locator('button', { hasText: 'Apply' }).click()
		await expect(dialog).toHaveCount(0)

		const node = await nodeProps<{
			method: string
			url: string
			query?: string
			headers: string
			body: string
			auth?: string
			authRef?: string
			authValue?: string
		}>(page, id)
		expect(node.method).toBe('POST')
		expect(node.url).toBe('https://api.example.com/v1/items')
		expect(node.query).toBe('limit=5')
		expect(node.headers).toContain('Content-Type: application/json')
		expect(node.headers).not.toContain('Authorization')
		expect(node.body).toBe('{"a":1}')
		expect(node.auth).toBe('bearer')
		expect(node.authRef).toMatch(/^secret:/)
		expect(node.authValue).toBe('')
	})
})
