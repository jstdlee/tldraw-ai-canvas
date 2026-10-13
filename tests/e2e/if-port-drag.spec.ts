import { expect, test } from '@playwright/test'
import { createNode, gotoApp, zoomToFit } from './helpers'

/**
 * WP21 Part A ("every output port is a visible, draggable dot"): the If card's `then`/`else`
 * outputs were defined in `getPorts` but never had a `<Port>` rendered, so they had no visible,
 * draggable dot. Same shape of test as `wire-drop-picker.spec.ts`: drag from the port to empty
 * canvas and expect the wire-drop picker to open.
 */
test.describe('If output port drag', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('dragging from the "then" output opens the picker', async ({ page }) => {
		const errors: string[] = []
		page.on('pageerror', (error) => errors.push(error.message))

		const id = await createNode(
			page,
			{ type: 'if', condition: 'contains', operand: 'yes', lastResult: null, lastValue: null },
			{ x: 100, y: 100 }
		)
		await zoomToFit(page)

		// The "then" row's port is a Port_start (output) inside the card; it must be visible
		// and have a real bounding box (i.e. an anchor was registered for it).
		const port = page.locator(`[data-shape-id="${id}"] .Port_start`).first()
		await expect(port).toBeVisible()
		const box = (await port.boundingBox())!
		expect(box.width).toBeGreaterThan(0)

		// `port.hover()` (not a raw page.mouse.move to a pre-read coordinate) — Playwright's own
		// actionability wait settles the real pointer-target tracking a plain coordinate jump
		// doesn't; a bare page.mouse.move here is flaky for any body-row port (reproduces even
		// on unrelated, unchanged node types), not something specific to this card.
		await port.hover()
		await page.mouse.down()
		await page.mouse.move(box.x + 250, box.y + 200, { steps: 10 })
		await page.mouse.up()

		await expect(page.locator('.NodeSearchPicker input').first()).toBeVisible()
		expect(errors).toEqual([])
	})
})
