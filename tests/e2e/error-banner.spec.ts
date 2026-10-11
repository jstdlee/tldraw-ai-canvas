import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator, runNode } from './helpers'

test.describe('error banner', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('a URL card with an empty URL shows the banner with its message', async ({ page }) => {
		const id = await createNode(
			page,
			{ type: 'url_in', url: '', fetchBody: false, lastText: null, error: null },
			{ x: 0, y: 0 }
		)

		await runNode(page, id)

		const banner = nodeLocator(page, id).locator('.NodeErrorBanner')
		await expect(banner).toBeVisible()
		await expect(banner).toContainText('Type a web address, like www.example.com')
	})
})
