import { expect, test } from '@playwright/test'
import { clickEmptyCanvas, gotoApp, insertFromPalette, selectedShapeId, shapeProps } from './helpers'

test.describe('insert palette', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('"/", type "pivt", Enter inserts a DataPipe · Pivot card at fontSize 16', async ({ page }) => {
		await clickEmptyCanvas(page)
		await page.keyboard.press('/')
		await expect(page.getByPlaceholder('Insert card…')).toBeVisible()

		await insertFromPalette(page, 'pivt')
		await expect(page.getByPlaceholder('Insert card…')).toBeHidden()

		const id = await selectedShapeId(page)
		expect(id).toBeTruthy()
		const props = await shapeProps<{ fontSize: number; node: { type: string; op: string } }>(page, id!)
		expect(props.node.type).toBe('table')
		expect(props.node.op).toBe('pivot')
		expect(props.fontSize).toBe(16)
	})
})
