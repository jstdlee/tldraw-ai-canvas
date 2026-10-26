import { expect, Page, test } from '@playwright/test'
import { gotoApp, shapeProps, zoomToFit } from './helpers'

/**
 * List formats in rich-text shapes: typing shortcuts ("- ", "1. ", "[ ] "), the toolbar buttons,
 * ticking a checkbox without edit mode (one undo step), and the context menu List submenu.
 */

type Doc = { content: Array<{ type: string; content?: Array<{ attrs?: { checked?: boolean } }> }> }

async function newTextShape(page: Page, id: string, richText?: unknown): Promise<void> {
	await page.evaluate(
		({ id, richText }) => {
			const editor = (window as any).editor
			editor.createShape({
				id,
				type: 'text',
				x: 200,
				y: 200,
				props: { autoSize: false, w: 360, richText: richText ?? { type: 'doc', content: [{ type: 'paragraph' }] } },
			})
		},
		{ id, richText }
	)
	await zoomToFit(page)
}

async function editShape(page: Page, id: string): Promise<void> {
	await page.evaluate((id) => {
		const editor = (window as any).editor
		editor.select(id)
		editor.setEditingShape(id)
	}, id)
	await page.locator('.tl-rich-text [contenteditable="true"]').first().waitFor()
	await page.locator('.tl-rich-text [contenteditable="true"]').first().focus()
}

async function stopEditing(page: Page): Promise<void> {
	await page.keyboard.press('Escape')
	await page.evaluate(() => void (window as any).editor.complete())
}

const blockTypes = (doc: Doc) => doc.content.map((b) => b.type)

test.describe('text lists', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('typing "- ", "1. " and "[ ] " makes bullets, numbers and a checklist', async ({ page }) => {
		const id = 'shape:lists-typing'
		await newTextShape(page, id)
		await editShape(page, id)
		await page.keyboard.type('- apple')
		await page.keyboard.press('Enter')
		await page.keyboard.press('Enter') // leave the list
		await page.keyboard.type('1. first')
		await page.keyboard.press('Enter')
		await page.keyboard.press('Enter')
		await page.keyboard.type('[ ] todo')
		await page.keyboard.press('Enter')
		await page.keyboard.type('next')
		await stopEditing(page)
		const { richText } = await shapeProps<{ richText: Doc }>(page, id)
		expect(blockTypes(richText)).toEqual(['bulletList', 'orderedList', 'taskList'])
		expect(richText.content[2].content).toHaveLength(2)
	})

	test('toolbar has Numbered list and Checklist buttons that toggle the list', async ({ page }) => {
		const id = 'shape:lists-toolbar'
		await newTextShape(page, id, {
			type: 'doc',
			content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one line of text' }] }],
		})
		await editShape(page, id)
		// Entering edit mode moves the caret to the end a moment later; select after that.
		await page.waitForTimeout(300)
		await page.evaluate(() => void (window as any).editor.getRichTextEditor().chain().focus().selectAll().run())
		const checklist = page.getByTestId('rich-text.taskList')
		await expect(checklist).toBeVisible()
		await expect(page.getByTestId('rich-text.orderedList')).toBeVisible()
		await checklist.click()
		await expect(checklist).toHaveAttribute('aria-pressed', 'true')
		await page.getByTestId('rich-text.orderedList').click()
		await stopEditing(page)
		const { richText } = await shapeProps<{ richText: Doc }>(page, id)
		expect(blockTypes(richText)).toEqual(['orderedList'])
	})

	test('clicking a checkbox on the canvas ticks it without selecting; undo restores it', async ({ page }) => {
		const id = 'shape:lists-click'
		await newTextShape(page, id, {
			type: 'doc',
			content: [
				{
					type: 'taskList',
					content: [
						{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
						{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] },
					],
				},
			],
		})
		await page.evaluate(() => void (window as any).editor.selectNone())
		const boxes = page.locator(`[data-shape-id="${id}"] li[data-type="taskItem"] input[type="checkbox"]`)
		await expect(boxes).toHaveCount(2)
		await boxes.nth(1).click()
		const checked = async () =>
			((await shapeProps<{ richText: Doc }>(page, id)).richText.content[0].content ?? []).map((i) => !!i.attrs?.checked)
		await expect.poll(checked).toEqual([false, true])
		expect(await page.evaluate(() => (window as any).editor.getSelectedShapeIds())).toEqual([])
		await expect(boxes.nth(1)).toBeChecked()
		await page.evaluate(() => void (window as any).editor.undo())
		await expect.poll(checked).toEqual([false, false])
	})

	test('context menu List submenu turns lines into a checklist and back', async ({ page }) => {
		const id = 'shape:lists-menu'
		await newTextShape(page, id, {
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: 'milk' }] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'eggs' }] },
			],
		})
		await page.evaluate((id) => void (window as any).editor.select(id), id)
		const box = await page.locator(`[data-shape-id="${id}"]`).boundingBox()
		await page.mouse.click(box!.x + 20, box!.y + 10, { button: 'right' })
		await page.getByRole('menuitem', { name: 'List' }).click()
		await page.getByRole('menuitem', { name: 'Checklist' }).click()
		let { richText } = await shapeProps<{ richText: Doc }>(page, id)
		expect(blockTypes(richText)).toEqual(['taskList'])
		expect(richText.content[0].content).toHaveLength(2)

		await page.mouse.click(box!.x + 20, box!.y + 10, { button: 'right' })
		await page.getByRole('menuitem', { name: 'List' }).click()
		await page.getByRole('menuitem', { name: 'Plain paragraphs' }).click()
		;({ richText } = await shapeProps<{ richText: Doc }>(page, id))
		expect(blockTypes(richText)).toEqual(['paragraph', 'paragraph'])
	})
})
