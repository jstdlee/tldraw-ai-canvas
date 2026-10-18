import { expect, test } from '@playwright/test'
import { createDefaultNode, gotoApp, nodeProps, runNode, wire, zoomToFit } from './helpers'

/**
 * FLOW-02: `toImageUrl()` only accepted a data URL, `/api/images/…`, or an absolute http(s) URL —
 * a same-origin relative path (exactly what the 4 bundled image examples set directly on
 * `load_image`'s own `imageUrl` field, e.g. `/examples/girl-base.jpg`) fell through to "Paste an
 * image, upload one, or use an image URL." This reproduces the "Filter look" example's own shape
 * (load_image → image_filter) directly, without going through the examples menu.
 */
test.describe('a same-origin relative image URL loads into a downstream image card', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('load_image with a relative imageUrl feeds image_filter successfully', async ({ page }) => {
		const loadId = await createDefaultNode(
			page,
			'load_image',
			{ imageUrl: '/examples/girl-base.jpg', source: '' },
			{ x: 0, y: 0 }
		)
		const filterId = await createDefaultNode(page, 'image_filter', {}, { x: 460, y: 0 })
		await zoomToFit(page)
		await wire(page, loadId, 'output', filterId, 'image')

		await runNode(page, filterId)

		const props = await nodeProps<{ lastResultUrl: string | null; error: string | null }>(page, filterId)
		expect(props.error).toBeNull()
		expect(props.lastResultUrl).toMatch(/^\/api\/images\//)
	})
})
