import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator, nodeProps, runNode, setNodeProps, wire, zoomToFit } from './helpers'

/** For each "number range": loops over whole numbers From..To by Step, with no list wired. */
test.describe('For each number range', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('runs the body once per number and shows From / To / Step rows', async ({ page }) => {
		const forEachId = await createNode(
			page,
			{
				type: 'for_each',
				split: 'range',
				separator: ',',
				joiner: ',',
				noResult: 'keep',
				rangeFrom: 2,
				rangeTo: 10,
				rangeStep: 4,
				progress: null,
				lastResults: null,
				error: null,
			},
			{ x: 0, y: 0 }
		)
		const ifId = await createNode(
			page,
			{ type: 'if', condition: 'gt', operand: '5', lastResult: null, lastValue: null },
			{ x: 360, y: 0 }
		)
		await zoomToFit(page)
		await wire(page, forEachId, 'item', ifId, 'input')
		await wire(page, ifId, 'then', forEachId, 'result')

		const card = nodeLocator(page, forEachId)
		for (const label of ['From', 'To', 'Step']) await expect(card.getByText(label, { exact: true })).toBeVisible()
		await expect(card.getByText('Separator', { exact: true })).toHaveCount(0)

		await runNode(page, forEachId)
		const first = await nodeProps<{ lastResults: string | null; error: string | null }>(page, forEachId)
		expect(first.error).toBeNull()
		expect(first.lastResults).toBe('2,6,10')

		await setNodeProps(page, forEachId, { rangeStep: 0 })
		await runNode(page, forEachId)
		const bad = await nodeProps<{ error: string | null }>(page, forEachId)
		expect(bad.error).toMatch(/step/)
	})
})
