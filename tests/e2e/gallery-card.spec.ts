import { expect, test } from '@playwright/test'
import { apiImportImage, createDefaultNode, gotoApp, nodeLocator, nodeProps, runNode, wire, zoomToFit } from './helpers'

/**
 * WP36 "P": Gallery shows a list of images as a grid (lines / JSON list / a table's url column)
 * and passes the same list through; "Download all" zips them.
 */
test.describe('Gallery', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('a newline-joined list of image URLs renders as a grid and passes through unchanged', async ({ page }) => {
		const a = await apiImportImage(page, '/examples/girl-base.jpg')
		const b = await apiImportImage(page, '/examples/girl-coat.jpg')
		const listId = await createDefaultNode(page, 'prompt', { text: `${a}\n${b}` }, { x: 0, y: 0 })
		const galleryId = await createDefaultNode(page, 'gallery', { columns: 2 }, { x: 460, y: 0 })
		await zoomToFit(page)
		await wire(page, listId, 'output', galleryId, 'images')

		await runNode(page, galleryId)

		const card = nodeLocator(page, galleryId)
		await expect(card.locator('.GalleryNode-tile')).toHaveCount(2)
		const props = await nodeProps<{ lastImages: string | null }>(page, galleryId)
		expect(props.lastImages).toBe(`${a}\n${b}`)
	})

	test('"Download all" downloads a .zip', async ({ page }) => {
		const a = await apiImportImage(page, '/examples/girl-base.jpg')
		const galleryId = await createDefaultNode(page, 'gallery', { lastImages: a }, { x: 0, y: 0 })
		await zoomToFit(page)

		const card = nodeLocator(page, galleryId)
		await expect(card.locator('.GalleryNode-tile')).toHaveCount(1)
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			card.getByRole('button', { name: /Download all/ }).click(),
		])
		expect(download.suggestedFilename()).toMatch(/\.zip$/)
	})
})
