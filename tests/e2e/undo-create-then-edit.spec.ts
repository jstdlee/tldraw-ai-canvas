import { expect, test } from '@playwright/test'
import { clickEmptyCanvas, gotoApp, insertFromPalette, nodeLocator, nodeProps, selectedShapeId, shapeExists, zoomToFit } from './helpers'

/**
 * FLOW-08: a freshly placed card's first edit used to fuse with its own creation into one undo
 * step — one Ctrl+Z removed the whole card, not just the edit. `createNodeAt` (the insert
 * palette, the wire-drop picker, the library sidebar) and the toolbar's own `createNodeShape`
 * now both mark a history stopping point right after creation, so a user's very first edit is
 * its own step. Uses the real insert palette + a real textarea edit, not a scripted shape patch.
 */
test.describe('a just-placed card\'s first edit is its own undo step', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('Ctrl+Z after editing a freshly inserted Prompt reverts only the edit', async ({ page }) => {
		await clickEmptyCanvas(page)
		await page.keyboard.press('/')
		await expect(page.getByPlaceholder('Insert card…')).toBeVisible()
		await insertFromPalette(page, 'Prompt')
		await expect(page.getByPlaceholder('Insert card…')).toBeHidden()

		const id = (await selectedShapeId(page))!
		expect(id).toBeTruthy()
		await zoomToFit(page)

		const textarea = nodeLocator(page, id).locator('textarea').first()
		await textarea.click()
		await textarea.selectText()
		await textarea.fill('my edited text')
		await textarea.blur()
		await expect.poll(async () => (await nodeProps<{ text: string }>(page, id)).text).toBe('my edited text')

		await page.keyboard.press('Control+z')

		// Expected: the card still exists, with its text reverted to the default — not removed.
		expect(await shapeExists(page, id)).toBe(true)
		const props = await nodeProps<{ text: string }>(page, id)
		expect(props.text).not.toBe('my edited text')

		// A second undo then removes the card entirely (the creation, as its own step).
		await page.keyboard.press('Control+z')
		await expect.poll(() => shapeExists(page, id)).toBe(false)
	})
})
