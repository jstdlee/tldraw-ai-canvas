import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

async function dropWireFromPrompt(page: import('@playwright/test').Page) {
	const id = await page.evaluate(async () => {
		const editor = (window as any).editor
		const { getNodeDefinition } = await import('/client/pipeline/nodes/definitionStore.ts' as string)
		const node = getNodeDefinition(editor, 'prompt').getDefault()
		const shapeId = `shape:${crypto.randomUUID()}`
		editor.createShape({ id: shapeId, type: 'node', x: 100, y: 100, props: { node, fontSize: 16 } })
		editor.setCamera({ x: 0, y: 0, z: 1 })
		return shapeId
	})
	const port = page.locator(`[data-shape-id="${id}"] .Port_start`).first()
	const box = (await port.boundingBox())!
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.mouse.down()
	await page.mouse.move(box.x + 300, box.y + 150, { steps: 10 })
	await page.mouse.up()
	await expect(page.locator('.NodeSearchPicker input').first()).toBeVisible()
	return id
}

const state = (page: import('@playwright/test').Page, sourceId: string) =>
	page.evaluate((sourceId) => {
		const editor = (window as any).editor
		const nodes = editor.getCurrentPageShapes().filter((s: any) => s.type === 'node' && s.id !== sourceId)
		const bound = nodes.filter((n: any) =>
			editor.getBindingsToShape(n.id, 'connection').some((b: any) => b.props.terminal === 'end')
		)
		return { types: nodes.map((n: any) => n.props.node.type), wired: bound.length }
	}, sourceId)

test.describe('wire-drop picker: picking a card places it', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('Enter on a search result creates and wires the card', async ({ page }) => {
		const src = await dropWireFromPrompt(page)
		await page.keyboard.type('text tools')
		await page.keyboard.press('Enter')
		await expect.poll(async () => (await state(page, src)).types.length).toBe(1)
		expect((await state(page, src)).wired).toBe(1)
	})

	test('clicking a result row creates and wires the card', async ({ page }) => {
		const src = await dropWireFromPrompt(page)
		await page.keyboard.type('ai text')
		// WP37/UI-09: "AI text" (type `text_ai`) was renamed "Edit text (AI)" so it reads
		// distinctly from "Generate text" — this still searches the same card's keywords.
		await page.locator('.NodeSearchPicker').getByText('Edit text (AI)', { exact: false }).first().click()
		await expect.poll(async () => (await state(page, src)).types.length).toBe(1)
		expect((await state(page, src)).wired).toBe(1)
	})
})
