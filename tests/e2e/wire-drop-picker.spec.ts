import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

test.describe('wire-drop picker', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('dragging an output to empty canvas opens the picker without errors', async ({ page }) => {
		const errors: string[] = []
		page.on('pageerror', (error) => errors.push(error.message))

		// A DataPipe output: its getPorts asks about wires, which once crashed the picker.
		const id = await page.evaluate(async () => {
			const editor = (window as any).editor
			const { getNodeDefinition } = await import('/client/pipeline/nodes/definitionStore.ts' as string)
			const node = getNodeDefinition(editor, 'table').getDefault()
			const shapeId = `shape:${crypto.randomUUID()}`
			editor.createShape({ id: shapeId, type: 'node', x: 100, y: 100, props: { node, fontSize: 16 } })
			editor.setCamera({ x: 0, y: 0, z: 1 })
			return shapeId
		})

		const port = page.locator(`[data-shape-id="${id}"] .Port_start`).first()
		await expect(port).toBeVisible()
		const box = (await port.boundingBox())!
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
		await page.mouse.down()
		await page.mouse.move(box.x + 250, box.y + 200, { steps: 10 })
		await page.mouse.up()

		await expect(page.locator('.NodeSearchPicker input').first()).toBeVisible()
		// The text output can feed an Output card: it must be offered.
		await page.keyboard.type('output')
		await expect(page.locator('.NodeSearchPicker').getByText('Output', { exact: false }).first()).toBeVisible()
		expect(errors).toEqual([])
	})
})
