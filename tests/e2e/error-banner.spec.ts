import { expect, test } from '@playwright/test'
import { createDefaultNode, createNode, gotoApp, nodeLocator, runNode, zoomToFit } from './helpers'

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

	// DATA-02: the banner used to render as a sibling placed below the card's own declared box
	// (NodeShapeUtil.tsx's getNodeOuterHeightPx now reserves room for it), so after a normal
	// zoomToFit it commonly rendered right under tldraw's fixed bottom toolbar — visible to
	// Playwright, invisible to a real user. Confirm the banner now stays within the shape's own
	// bounding box.
	test('a failed run (DataPipe) keeps its banner inside the card after zoomToFit', async ({ page }) => {
		// An empty "Keep columns" table (the default's own `text` is empty, `source: 'inline'`)
		// fails with "The table is empty" — the same DataPipe repro the review used.
		const id = await createDefaultNode(page, 'table', { text: '' }, { x: 0, y: 0 })
		await zoomToFit(page)
		await runNode(page, id).catch(() => {})

		const banner = nodeLocator(page, id).locator('.NodeErrorBanner')
		await expect(banner).toBeVisible()
		const bannerBox = await banner.boundingBox()
		const shapeBox = await nodeLocator(page, id).boundingBox()
		expect(bannerBox).not.toBeNull()
		expect(shapeBox).not.toBeNull()
		// The banner's bottom edge must sit at or above the shape's own declared bottom edge: it
		// renders INSIDE the card's box now, not past it.
		expect(bannerBox!.y + bannerBox!.height).toBeLessThanOrEqual(shapeBox!.y + shapeBox!.height + 1)
		expect(bannerBox!.y).toBeGreaterThanOrEqual(shapeBox!.y)
	})
})
