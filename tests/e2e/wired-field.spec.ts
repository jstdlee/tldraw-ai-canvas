import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeProps, runNode, wire, unwire, zoomToFit } from './helpers'

const CSV = 'name,city\nSam,Paris\nLin,Oslo\n'

test.describe('wired field: DataPipe filter "with" from a Prompt', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('wiring a field overrides it; removing the wire falls back to the stored value', async ({ page }) => {
		const promptId = await createNode(page, { type: 'prompt', text: 'S' }, { x: 0, y: 200 })
		const dataPipeId = await createNode(
			page,
			{
				type: 'table',
				text: CSV,
				format: 'auto',
				op: 'filter',
				columns: '',
				column: 'name',
				as: 'starts',
				expr: '',
				sep: ' ',
				pattern: '',
				with: 'L', // stored fallback value, used once the wire is removed
				name: '',
				error: null,
				source: 'inline',
			},
			{ x: 500, y: 0 }
		)

		const connectionId = await wire(page, promptId, 'output', dataPipeId, 'field:with')
		await zoomToFit(page)
		await runNode(page, dataPipeId)

		const wired = await nodeProps<{ lastOutput: string | null }>(page, dataPipeId)
		const wiredRows = wired.lastOutput!.trim().split('\n')
		expect(wiredRows).toContain('Sam,Paris')
		expect(wiredRows).not.toContain('Lin,Oslo')

		await unwire(page, connectionId)
		await runNode(page, dataPipeId)

		const unwired = await nodeProps<{ lastOutput: string | null }>(page, dataPipeId)
		const unwiredRows = unwired.lastOutput!.trim().split('\n')
		expect(unwiredRows).toContain('Lin,Oslo')
		expect(unwiredRows).not.toContain('Sam,Paris')
	})
})
