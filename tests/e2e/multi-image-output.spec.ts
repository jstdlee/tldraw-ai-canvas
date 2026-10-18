import { expect, test } from '@playwright/test'
import { apiImportImage, createDefaultNode, gotoApp, nodeLocator, runNode, wire, zoomToFit } from './helpers'

/**
 * IMAGE-02: a multi-image value (e.g. Generate image's own "images" port, newline-joined URLs)
 * rendered as one broken `<img src="url1\nurl2">` — a `src` with an embedded newline isn't a
 * valid URL. `ValuePreview` now renders a grid for 2+ images instead.
 */
test.describe('Output card shows a grid for a multi-image value, not a broken image', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('wiring Generate image\'s "images" port into Output renders a grid of tiles', async ({ page }) => {
		const a = await apiImportImage(page, '/examples/girl-base.jpg')
		const b = await apiImportImage(page, '/examples/girl-coat.jpg')
		const genId = await createDefaultNode(page, 'image_gen', { images: JSON.stringify([a, b]) }, { x: 0, y: 0 })
		const outId = await createDefaultNode(page, 'output', { kind: 'image' }, { x: 460, y: 0 })
		await zoomToFit(page)
		await wire(page, genId, 'images', outId, 'input')

		await runNode(page, outId)

		const card = nodeLocator(page, outId)
		await expect(card.locator('.ValuePreview-images')).toBeVisible()
		await expect(card.locator('.ValuePreview-images-tile')).toHaveCount(2)
		await expect(card.locator('.ValuePreview-image')).toHaveCount(0)
	})
})
