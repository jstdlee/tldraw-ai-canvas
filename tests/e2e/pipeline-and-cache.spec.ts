import { expect, Page, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator, nodeProps, runNode, setNodeProps, wire, zoomToFit } from './helpers'

const CSV = 'region,amount\nEast,10\nEast,5\nWest,7\n'

/** DataPipe (inline CSV, passthrough) -> Group (region, sum amount as "total") -> Chart (bar). */
async function buildPipeline(page: Page) {
	const dataPipeId = await createNode(
		page,
		{
			type: 'table',
			text: CSV,
			format: 'auto',
			op: 'select',
			columns: 'region,amount',
			column: '',
			as: '',
			expr: '',
			sep: ' ',
			pattern: '',
			with: '',
			name: '',
			error: null,
			source: 'inline',
		},
		{ x: 0, y: 0 }
	)
	const groupId = await createNode(
		page,
		{
			type: 'table',
			text: '',
			format: 'auto',
			op: 'groupby',
			columns: 'amount:sum:total',
			column: 'region',
			as: '',
			expr: '',
			sep: ' ',
			pattern: '',
			with: '',
			name: '',
			error: null,
			source: 'input',
		},
		{ x: 500, y: 0 }
	)
	const chartId = await createNode(
		page,
		{
			type: 'chart',
			text: '',
			format: 'csv',
			kind: 'bar',
			xCol: 'region',
			yCol: 'total',
			dualScale: false,
			error: null,
		},
		{ x: 1000, y: 0 }
	)
	await wire(page, dataPipeId, 'output', groupId, 'data')
	await wire(page, groupId, 'output', chartId, 'data')
	await zoomToFit(page)
	return { dataPipeId, groupId, chartId }
}

test.describe('pipeline: DataPipe -> Group -> Chart', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('running the Chart runs its upstream DataPipe and Group, with the right sums', async ({ page }) => {
		const { groupId, chartId } = await buildPipeline(page)

		await runNode(page, chartId)

		const group = await nodeProps<{ lastOutput: string | null }>(page, groupId)
		expect(group.lastOutput).toBeTruthy()
		const rows = group.lastOutput!.trim().split('\n')
		expect(rows[0]).toBe('region,total')
		expect(rows).toContain('East,15')
		expect(rows).toContain('West,7')

		const chart = await nodeProps<{ imageUrl: string | null; error: string | null }>(page, chartId)
		expect(chart.error).toBeNull()
		expect(chart.imageUrl).toMatch(/^\/api\/images\//)
	})

	test('running again is cached; changing the group op makes that card re-run', async ({ page }) => {
		const { groupId, chartId } = await buildPipeline(page)

		await runNode(page, chartId)
		const firstGroup = await nodeProps<{ lastOutput: string | null }>(page, groupId)
		expect(firstGroup.lastOutput).toContain('East,15')

		// Second run, nothing changed anywhere: only the pressed Chart card is revisited (its
		// upstream isn't stale), and its own footer reports "cached".
		await runNode(page, chartId)
		await expect(nodeLocator(page, chartId).locator('.NodeLlmStatus')).toHaveText('cached')

		// Change the Group's own op param (sum -> average): that marks it out of date (the same
		// way the app's own field editors do), so the next Run must visit and recompute it
		// instead of serving the old cached sum.
		await setNodeProps(page, groupId, { columns: 'amount:avg:total' })
		await runNode(page, chartId)
		const secondGroup = await nodeProps<{ lastOutput: string | null }>(page, groupId)
		expect(secondGroup.lastOutput).toContain('East,7.5')
		expect(secondGroup.lastOutput).not.toContain('East,15')
	})
})
