import { expect, test } from '@playwright/test'
import { createDefaultNode, gotoApp, wire, zoomToFit } from './helpers'

/**
 * GAPS-13: an untaken If/Decision switch branch delivers `STOP_EXECUTION` to whatever it feeds.
 * A hand-rolled "connected value" row that used a bare `String(value)` showed the raw
 * "Symbol(STOP_EXECUTION)" instead of nothing — reproduced here exactly as the review did it
 * (Prompt → If "contains zzz" → then (untaken) → Generate text's input row).
 */
test.describe('an untaken branch never shows "Symbol(STOP_EXECUTION)"', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test("Generate text's Input row", async ({ page }) => {
		const promptId = await createDefaultNode(page, 'prompt', { text: 'hello' }, { x: 0, y: 0 })
		const ifId = await createDefaultNode(page, 'if', { condition: 'contains', operand: 'zzz' }, { x: 460, y: 0 })
		const genId = await createDefaultNode(page, 'generate_text', {}, { x: 920, y: 0 })
		await zoomToFit(page)
		await wire(page, promptId, 'output', ifId, 'input')
		await wire(page, ifId, 'then', genId, 'input')

		// preview() renders an untaken branch as empty text (same convention as every PortRow),
		// which legitimately collapses to a zero-size span — not a visibility bug, so this
		// checks content, not toBeVisible().
		const row = page.locator(`[data-shape-id="${genId}"] .NodeRow-connected-value`).first()
		await expect(row).toHaveCount(1)
		await expect(row).not.toContainText('Symbol')
		await expect(row).not.toContainText('STOP_EXECUTION')
	})

	test("Chat's Attach row", async ({ page }) => {
		const promptId = await createDefaultNode(page, 'prompt', { text: 'a sketch' }, { x: 0, y: 0 })
		const ifId = await createDefaultNode(page, 'if', { condition: 'contains', operand: 'zzz' }, { x: 460, y: 0 })
		const chatId = await createDefaultNode(page, 'chat', {}, { x: 920, y: 0 })
		await zoomToFit(page)
		await wire(page, promptId, 'output', ifId, 'input')
		await wire(page, ifId, 'then', chatId, 'attach')

		const attachRow = page.locator(`[data-shape-id="${chatId}"] .NodeRow-connected-value`).first()
		await expect(attachRow).toHaveCount(1)
		await expect(attachRow).not.toContainText('Symbol')
		await expect(attachRow).not.toContainText('STOP_EXECUTION')
	})
})
