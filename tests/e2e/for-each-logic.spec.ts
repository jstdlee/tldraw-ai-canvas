import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeProps, runNode, setNodeProps, wire, zoomToFit } from './helpers'

/**
 * WP21 Part B ("logic inside For each"): the loop body can contain a logic card (If) whose
 * branch sometimes never reaches "result" — here, `item > 2`'s "else" branch is left
 * unwired. With the default noResult ("skip") those items are left out of the output list;
 * with noResult: "keep" they fall back to the original item.
 */
test.describe('For each with an If inside the loop body', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('If (item > 2) then -> Result: skip drops non-matching items, keep keeps them', async ({ page }) => {
		const listId = await createNode(page, { type: 'prompt', text: '1,2,3,4' }, { x: 0, y: 0 })
		const forEachId = await createNode(
			page,
			{
				type: 'for_each',
				split: 'separator',
				separator: ',',
				joiner: ',',
				noResult: 'skip',
				progress: null,
				lastResults: null,
				error: null,
			},
			{ x: 300, y: 0 }
		)
		const ifId = await createNode(
			page,
			{ type: 'if', condition: 'gt', operand: '2', lastResult: null, lastValue: null },
			{ x: 600, y: 0 }
		)
		await zoomToFit(page)

		await wire(page, listId, 'output', forEachId, 'list')
		await wire(page, forEachId, 'item', ifId, 'input')
		await wire(page, ifId, 'then', forEachId, 'result')

		await runNode(page, forEachId)
		const skipped = await nodeProps<{ lastResults: string | null; error: string | null }>(page, forEachId)
		expect(skipped.error).toBeNull()
		expect(skipped.lastResults).toBe('3,4')

		await setNodeProps(page, forEachId, { noResult: 'keep' })
		await runNode(page, forEachId)
		const kept = await nodeProps<{ lastResults: string | null; error: string | null }>(page, forEachId)
		expect(kept.error).toBeNull()
		expect(kept.lastResults).toBe('1,2,3,4')
	})

	test('noResult: "error" stops the loop with a message', async ({ page }) => {
		const listId = await createNode(page, { type: 'prompt', text: '1,2,3,4' }, { x: 0, y: 0 })
		const forEachId = await createNode(
			page,
			{
				type: 'for_each',
				split: 'separator',
				separator: ',',
				joiner: ',',
				noResult: 'error',
				progress: null,
				lastResults: null,
				error: null,
			},
			{ x: 300, y: 0 }
		)
		const ifId = await createNode(
			page,
			{ type: 'if', condition: 'gt', operand: '2', lastResult: null, lastValue: null },
			{ x: 600, y: 0 }
		)
		await zoomToFit(page)

		await wire(page, listId, 'output', forEachId, 'list')
		await wire(page, forEachId, 'item', ifId, 'input')
		await wire(page, ifId, 'then', forEachId, 'result')

		await runNode(page, forEachId)
		const result = await nodeProps<{ error: string | null }>(page, forEachId)
		expect(result.error).toContain('1')
	})
})
