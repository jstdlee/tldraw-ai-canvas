import { expect, test } from '@playwright/test'
import { apiImportImage, createDefaultNode, gotoApp, nodeLocator, wire, zoomToFit } from './helpers'

/**
 * IMAGE-06: every download used to be named literally "image.<ext>" (the card footer menu) or
 * "image-N.png" regardless of the real content type (a Generate image tile) — both collide
 * across cards/runs and the tile name could lie about the format. Both now use the result's real
 * content type and a name that identifies the card/result.
 */
test.describe('downloaded images are named for the card/result, with the real extension', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('the card footer "Download image" names the file after the card, not literally "image"', async ({ page }) => {
		const src = await apiImportImage(page, '/examples/girl-base.jpg')
		const loadId = await createDefaultNode(page, 'load_image', { imageUrl: src, source: src }, { x: 0, y: 0 })
		await zoomToFit(page)
		await nodeLocator(page, loadId).locator('.NodeFooterMenu-trigger').click()
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByRole('menuitem', { name: 'Download image' }).click(),
		])
		const name = download.suggestedFilename()
		expect(name).not.toBe('image.jpg')
		expect(name).toMatch(/^image-[a-z0-9]+\.(jpe?g|png)$/)
	})

	test('a Generate image tile download uses the real content type, not a hardcoded .png', async ({ page }) => {
		const a = await apiImportImage(page, '/examples/girl-base.jpg') // a real .jpg behind the URL
		const genId = await createDefaultNode(
			page,
			'image_gen',
			{ n: 2, images: JSON.stringify([a, a]) },
			{ x: 0, y: 0 }
		)
		await zoomToFit(page)
		const tile = nodeLocator(page, genId).locator('.ImageGenNode-tile').first()
		await expect(tile).toBeVisible()
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			tile.getByRole('button', { name: 'Download' }).click(),
		])
		expect(download.suggestedFilename()).toMatch(/^generate-image-1\.jpe?g$/)
	})
})
