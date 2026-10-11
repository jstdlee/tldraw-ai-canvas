import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

test.describe('expand (max) dialog', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('has a solid background, drags by its title bar, and scrolls its text', async ({ page }) => {
		const id = await page.evaluate(async () => {
			const editor = (window as any).editor
			const { getNodeDefinition } = await import('/client/pipeline/nodes/definitionStore.ts' as string)
			const node = { ...getNodeDefinition(editor, 'prompt').getDefault(), text: Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n') }
			const shapeId = `shape:${crypto.randomUUID()}`
			editor.createShape({ id: shapeId, type: 'node', x: 100, y: 100, props: { node, fontSize: 16 } })
			editor.setCamera({ x: 0, y: 0, z: 1 })
			return shapeId
		})
		const card = page.locator(`[data-shape-id="${id}"]`)
		await card.hover()
		await card.locator('.FieldMax').first().click({ force: true })
		const dialog = page.locator('.LargeEditor').first()
		await expect(dialog).toBeVisible()

		const bg = await dialog.evaluate((el) => getComputedStyle(el).backgroundColor)
		expect(bg).not.toBe('rgba(0, 0, 0, 0)')
		expect(bg).not.toBe('transparent')

		const before = (await dialog.boundingBox())!
		const bar = page.locator('.LargeEditor-bar').first()
		const barBox = (await bar.boundingBox())!
		await page.mouse.move(barBox.x + 40, barBox.y + barBox.height / 2)
		await page.mouse.down()
		await page.mouse.move(barBox.x + 160, barBox.y + barBox.height / 2 + 60, { steps: 8 })
		await page.mouse.up()
		const after = (await dialog.boundingBox())!
		expect(after.x - before.x).toBeGreaterThan(100)
		expect(after.y - before.y).toBeGreaterThan(40)

		const area = dialog.locator("textarea").first()
		const box = (await area.boundingBox())!
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
		await page.mouse.wheel(0, 600)
		await expect.poll(() => area.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
	})
})
