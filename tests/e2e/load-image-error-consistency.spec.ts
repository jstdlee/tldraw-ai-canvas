import { expect, test } from '@playwright/test'
import { createDefaultNode, gotoApp, nodeLocator, nodeProps, runNode, wire, zoomToFit } from './helpers'

/**
 * IMAGE-05: a broken URL reported differently depending on how it reached Load image — a nice
 * inline message via the Source field's own "Load" button, a generic run-failed banner via a
 * wired `url` port. Both paths now store the same message on `node.error` (LoadImageNode.tsx),
 * so the SAME text shows either way (inline when idle, or in the run banner after a Run).
 *
 * The broken URL is absolute and points at an unknown path under `/api/` — the app's own API
 * server 404s it cleanly (unlike a path under `/examples/`, where Vite's dev-server SPA fallback
 * can return 200 text/html for a missing static file instead of a real 404).
 */
test.describe('Load image: the same broken-URL message, field or wired', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('Source field "Load" and a wired "url" port report the identical message for the same broken URL', async ({ page }) => {
		const brokenUrl = new URL('/api/does-not-exist-at-all-404test', page.url()).toString()

		const fieldId = await createDefaultNode(page, 'load_image', {}, { x: 0, y: 0 })
		await zoomToFit(page)
		await nodeLocator(page, fieldId).locator('input[placeholder="Image URL"]').fill(brokenUrl)
		await nodeLocator(page, fieldId).getByRole('button', { name: 'Load' }).click()
		await expect.poll(async () => (await nodeProps<{ error: string | null }>(page, fieldId)).error).not.toBeNull()
		const fieldProps = await nodeProps<{ error: string | null }>(page, fieldId)
		expect(fieldProps.error).toMatch(/404/)
		await expect(nodeLocator(page, fieldId).locator('.NodeImagePreview-empty')).toContainText(fieldProps.error!)

		const urlId = await createDefaultNode(page, 'prompt', { text: brokenUrl }, { x: 0, y: 300 })
		const wiredId = await createDefaultNode(page, 'load_image', {}, { x: 460, y: 300 })
		await zoomToFit(page)
		await wire(page, urlId, 'output', wiredId, 'url')
		await runNode(page, wiredId)
		const wiredProps = await nodeProps<{ error: string | null }>(page, wiredId)

		// The whole point: the identical message, whichever path it came from.
		expect(wiredProps.error).toBe(fieldProps.error)
		const banner = nodeLocator(page, wiredId).locator('.NodeErrorBanner')
		await expect(banner).toBeVisible()
		await expect(banner).toContainText(fieldProps.error!)
	})
})
