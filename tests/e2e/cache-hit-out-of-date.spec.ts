import { expect, test } from '@playwright/test'
import { apiImportImage, createDefaultNode, getNodeRun, gotoApp, nodeLocator, runNode, shapeProps, wire, zoomToFit } from './helpers'

/**
 * IMAGE-03: a cache-hit "Run" (nothing about the card's inputs/settings changed since its last
 * real run) never cleared `isOutOfDate` — only a real execution did. Anything gated on that flag
 * (an image card's own dimmed "loading" preview style, e.g. Adjust's `NodeImagePreview_loading`)
 * stayed in the "stale" look forever after the first cache hit.
 */
test.describe('a cache-hit run clears isOutOfDate, same as a real run', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('Adjust: isOutOfDate is false and the loading style is gone after a cache-hit re-run', async ({ page }) => {
		const src = await apiImportImage(page, '/examples/girl-base.jpg')
		const loadId = await createDefaultNode(page, 'load_image', { imageUrl: src, source: src }, { x: 0, y: 0 })
		const adjustId = await createDefaultNode(page, 'adjust', {}, { x: 460, y: 0 })
		await zoomToFit(page)
		await wire(page, loadId, 'output', adjustId, 'image')

		await runNode(page, adjustId)
		let props = await shapeProps<{ isOutOfDate: boolean }>(page, adjustId)
		expect(props.isOutOfDate).toBe(false)
		await expect(nodeLocator(page, adjustId).locator('.NodeImagePreview_loading')).toHaveCount(0)

		// Second Run with nothing changed: a cache hit (ExecutionGraph's "cached" branch), not a
		// real re-execution.
		await runNode(page, adjustId)
		const run = await getNodeRun(page, adjustId)
		expect(run?.message).toBe('cached')
		props = await shapeProps<{ isOutOfDate: boolean }>(page, adjustId)
		expect(props.isOutOfDate).toBe(false)
		await expect(nodeLocator(page, adjustId).locator('.NodeImagePreview_loading')).toHaveCount(0)
	})
})
