import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator, nodeProps, runNode, wire, zoomToFit } from './helpers'

/**
 * WP26: the one table-text contract (shared/tableText.ts) across the whole chain — a value with
 * a comma, a quote, and a NULL survives Database (built-in Postgres / PGlite) -> DataPipe filter
 * -> Profile / Chart / Table view, with no "select a format" error anywhere (the per-card Format
 * picker is gone; every table is auto-detected).
 */

const SQL = `SELECT * FROM (VALUES ('North','Jan',10.5),('South','Feb, "late"',7),('East','Mar',NULL)) AS t(region,month,amount)`

test.describe('WP26 table-text contract', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('comma, quote and NULL survive Database -> DataPipe -> Profile/Chart/Table view', async ({ page }) => {
		test.setTimeout(60_000)

		const dbId = await createNode(
			page,
			{
				type: 'database',
				fileUrl: '',
				fileName: '',
				fileSize: 0,
				sql: SQL,
				tables: '',
				lastOutput: null,
				lastInfo: '',
				error: null,
				source: 'pglite',
			},
			{ x: 0, y: 0 }
		)

		const pipeId = await createNode(
			page,
			{
				type: 'table',
				text: '',
				format: 'auto',
				op: 'filter',
				columns: '',
				column: 'region',
				as: 'notempty',
				expr: '',
				sep: ' ',
				pattern: '',
				with: '',
				name: '',
				error: null,
			},
			{ x: 600, y: 0 }
		)
		const profileId = await createNode(page, { type: 'profile', text: '', format: 'auto', error: null }, { x: 1200, y: 0 })
		const chartId = await createNode(
			page,
			{ type: 'chart', text: '', format: 'auto', kind: 'bar', xCol: 'region', yCol: 'amount', dualScale: false, error: null },
			{ x: 1900, y: 0 }
		)
		const viewId = await createNode(
			page,
			{
				type: 'table_view',
				text: '',
				filterText: '',
				sortColumn: '',
				sortDir: 'asc',
				error: null,
				lastOutput: null,
				lastJson: null,
				lastInfo: '',
			},
			{ x: 2600, y: 0 }
		)

		await wire(page, dbId, 'output', pipeId, 'data')
		await wire(page, pipeId, 'output', profileId, 'data')
		await wire(page, pipeId, 'output', chartId, 'data')
		await wire(page, pipeId, 'output', viewId, 'data')
		await zoomToFit(page)

		// Database (PGlite): a value with a comma and an embedded quote, and a NULL.
		await runNode(page, dbId)
		await expect(nodeLocator(page, dbId).locator('.NodeErrorBanner')).toHaveCount(0)
		const dbOutput = (await nodeProps<{ lastOutput: string | null }>(page, dbId)).lastOutput
		expect(dbOutput).toContain('"Feb, ""late"""')
		expect(dbOutput).not.toContain('null') // NULL -> empty cell, not the word "null"
		expect(dbOutput).not.toContain('\t') // RFC 4180 CSV, not pg.ts's old TSV+JSON-quoted format

		// DataPipe: filter rows where region is not empty (keeps all three, including the
		// comma/quote/NULL row), reading the Database output through parseTableText.
		await runNode(page, pipeId)
		await expect(nodeLocator(page, pipeId).locator('.NodeErrorBanner')).toHaveCount(0)
		const pipeOutput = (await nodeProps<{ lastOutput: string | null }>(page, pipeId)).lastOutput
		expect(pipeOutput).toContain('East')
		expect(pipeOutput).toContain('South')
		await expect(nodeLocator(page, pipeId)).toContainText('Feb, "late"')

		// Profile: no format picker any more (the WP26 fix for "Profile errors when I select a
		// format" removes the whole interaction, not just the symptom), and no error.
		await runNode(page, profileId)
		const profileNode = nodeLocator(page, profileId)
		await expect(profileNode.locator('.NodeErrorBanner')).toHaveCount(0)
		await expect(profileNode).not.toContainText('Format')
		await expect(profileNode.locator('.NodeField-select', { hasText: 'Auto' })).toHaveCount(0)
		await expect(profileNode).toContainText('month')
		await expect(profileNode).toContainText('amount')

		// Chart: runs and renders without error from the same (quoted, NULL-bearing) table.
		await runNode(page, chartId)
		await expect(nodeLocator(page, chartId).locator('.NodeErrorBanner')).toHaveCount(0)
		const chartImage = (await nodeProps<{ imageUrl: string | null }>(page, chartId)).imageUrl
		expect(chartImage).toBeTruthy()

		// Table view: the grid shows the comma/quote value intact, and the output port is clean
		// RFC 4180 CSV (toCsv), not the old TSV/JSON-quoted/"null" text.
		await runNode(page, viewId)
		const viewNode = nodeLocator(page, viewId)
		await expect(viewNode.locator('.NodeErrorBanner')).toHaveCount(0)
		await expect(viewNode).toContainText('Feb, "late"')
		await expect(viewNode).toContainText('3 of 3 row')
		const viewProps = await nodeProps<{ lastOutput: string | null; lastJson: string | null }>(page, viewId)
		expect(viewProps.lastOutput).toContain('"Feb, ""late"""')
		expect(viewProps.lastOutput).not.toContain('\t')
		const json = JSON.parse(viewProps.lastJson ?? '[]') as Record<string, string>[]
		expect(json).toHaveLength(3)
		expect(json.find((row) => row.region === 'South')?.month).toBe('Feb, "late"')
		expect(json.find((row) => row.region === 'East')?.amount).toBe('')
	})

	test('Table view sorts by clicking a header, and filters via the filter box', async ({ page }) => {
		const id = await createNode(
			page,
			{
				type: 'table_view',
				text: 'name,score\nLin,5\nAda,9\nBea,3',
				filterText: '',
				sortColumn: '',
				sortDir: 'asc',
				error: null,
				lastOutput: null,
				lastJson: null,
				lastInfo: '',
			},
			{ x: 0, y: 0 }
		)
		await zoomToFit(page)
		const node = nodeLocator(page, id)

		// Click the "name" header: rows sort ascending by name.
		await node.locator('.SortFilterTable-th', { hasText: 'name' }).click()
		const rowsAfterSort = node.locator('.SortFilterTable-grid tbody tr')
		await expect(rowsAfterSort.first()).toContainText('Ada')

		// Filter box: only rows containing "in" (Lin) remain.
		await node.locator('.SortFilterTable-toolbar input').fill('in')
		await expect(node.locator('.SortFilterTable-grid tbody tr')).toHaveCount(1)
		await expect(node.locator('.SortFilterTable-grid tbody tr').first()).toContainText('Lin')
	})
})
