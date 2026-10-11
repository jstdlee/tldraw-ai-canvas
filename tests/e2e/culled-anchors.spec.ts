import { expect, test } from '@playwright/test'
import { createNode, gotoApp, wire, zoomToFit } from './helpers'

/**
 * WP25: an off-screen (culled) card renders a placeholder body, which unmounts its field rows.
 * Its field-port anchors must survive that, so a wire into a field port keeps its row while
 * the card is off-screen and after it scrolls back.
 */
test.describe('culled cards keep their field-port anchors', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('a wire into a field port keeps its end point while the card is off-screen', async ({ page }) => {
		const promptId = await createNode(page, { type: 'prompt', text: 'S' }, { x: 0, y: 300 })
		const dataPipeId = await createNode(
			page,
			{
				type: 'table', text: 'name\nSam\n', format: 'auto', op: 'filter', columns: '', column: 'name', as: 'starts',
				expr: '', sep: ' ', pattern: '', with: 'L', name: '', error: null, source: 'inline',
			},
			{ x: 500, y: 0 }
		)
		const connectionId = await wire(page, promptId, 'output', dataPipeId, 'field:with')
		await zoomToFit(page)
		await page.waitForTimeout(300)

		const wireBounds = () =>
			page.evaluate((id) => {
				const editor = (window as any).editor
				const b = editor.getShapePageBounds(id)
				return { y: Math.round(b.y), h: Math.round(b.h) }
			}, connectionId)
		const isCulled = (id: string) => page.evaluate((id) => (window as any).editor.getCulledShapes().has(id) as boolean, id)

		const before = await wireBounds()

		// Move the camera far away: both cards are culled.
		await page.evaluate(() => {
			;(window as any).editor.setCamera({ x: -50_000, y: -50_000, z: 1 })
		})
		await expect.poll(() => isCulled(dataPipeId)).toBe(true)
		await page.waitForTimeout(300)
		expect(await wireBounds()).toEqual(before)

		await zoomToFit(page)
		await expect.poll(() => isCulled(dataPipeId)).toBe(false)
		await page.waitForTimeout(300)
		expect(await wireBounds()).toEqual(before)
	})
})
