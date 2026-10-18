import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator, nodeProps, runNode, wire, zoomToFit } from './helpers'

/**
 * WP34 — data and tables. Covers the review findings fixed in this work package:
 * GAPS-01 (no sample fallback on a wired table), DATA-01 (Chart's live preview after a late
 * mount), DATA-03 (PGlite's results grid), DATA-04/GAPS-10 (a one-column list is a real table),
 * GAPS-07 (nested JSON flattens to dotted columns), DATA-05 (thousands-separated sort),
 * DATA-07 (DataPipe's own port dot), DATA-08 (a stale op field resets), DATA-09 (no "no port
 * anchor" console warnings once wired/op-switched), GAPS-12 (built-in databases load rows), and
 * UI-05 (Database's Source picker fits the card).
 */

function tableNode(patch: Record<string, unknown>) {
	return {
		type: 'table',
		text: '',
		format: 'auto',
		op: 'select',
		columns: '',
		column: '',
		as: '',
		expr: '',
		sep: ' ',
		pattern: '',
		with: '',
		name: '',
		error: null,
		source: 'input',
		lastOutput: null,
		lastInfo: '',
		...patch,
	}
}

test.describe('WP34 data and tables', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('GAPS-01: a wired-but-empty table stops DataPipe with a named error, not the sample table', async ({ page }) => {
		const promptId = await createNode(page, { type: 'prompt', text: '' }, { x: 0, y: 0 })
		const dataPipeId = await createNode(page, tableNode({ op: 'sort', columns: 'name' }), { x: 600, y: 0 })
		await wire(page, promptId, 'output', dataPipeId, 'data')
		await zoomToFit(page)
		await runNode(page, dataPipeId)

		const props = await nodeProps<{ error: string | null; lastOutput: string | null }>(page, dataPipeId)
		expect(props.error).toMatch(/No table from Prompt/)
		// Never the built-in sample (Ada/Lin) the card used to fall back to.
		expect(props.lastOutput ?? '').not.toContain('Ada')
	})

	test('GAPS-01: a wired-but-empty table stops Chart and Table view with a named error too', async ({ page }) => {
		const promptId = await createNode(page, { type: 'prompt', text: '' }, { x: 0, y: 0 })
		const chartId = await createNode(
			page,
			{ type: 'chart', text: '', format: 'csv', kind: 'bar', xCol: '', yCol: '', dualScale: false, error: null },
			{ x: 600, y: 0 }
		)
		const viewId = await createNode(
			page,
			{ type: 'table_view', text: '', filterText: '', sortColumn: '', sortDir: 'asc', error: null, lastOutput: null, lastJson: null, lastInfo: '' },
			// Far enough below the Chart card that its (quite tall, with every field shown)
			// default body can never overlap Table view's own Run button.
			{ x: 600, y: 900 }
		)
		await wire(page, promptId, 'output', chartId, 'data')
		await wire(page, promptId, 'output', viewId, 'data')
		await zoomToFit(page)

		await runNode(page, chartId)
		expect((await nodeProps<{ error: string | null }>(page, chartId)).error).toMatch(/No table from Prompt/)

		await runNode(page, viewId)
		expect((await nodeProps<{ error: string | null }>(page, viewId)).error).toMatch(/No table from Prompt/)
	})

	test('DATA-01: Chart renders its live preview after wiring, even though it mounted before the data existed', async ({ page }) => {
		// Chart created first (mounts with no data at all) — the exact order that used to leave
		// the inline preview permanently blank.
		const chartId = await createNode(
			page,
			{ type: 'chart', text: '', format: 'csv', kind: 'bar', xCol: 'name', yCol: 'score', dualScale: false, error: null },
			{ x: 600, y: 0 }
		)
		const dataPipeId = await createNode(page, tableNode({ text: 'name,score\nAda,3\nLin,5', op: 'select', columns: 'name,score' }), { x: 0, y: 0 })
		await wire(page, dataPipeId, 'output', chartId, 'data')
		await zoomToFit(page)

		await runNode(page, dataPipeId)
		await runNode(page, chartId)

		const chartNode = nodeLocator(page, chartId)
		await expect.poll(() => chartNode.locator('.ChartNode-view').evaluate((el) => el.children.length)).toBeGreaterThan(0)
		const props = await nodeProps<{ imageUrl: string | null; error: string | null }>(page, chartId)
		expect(props.error).toBeNull()
		expect(props.imageUrl).toBeTruthy()
	})

	test('DATA-03: Built-in Postgres (PGlite) results show the sortable/filterable grid, not plain text', async ({ page }) => {
		const dbId = await createNode(
			page,
			{
				type: 'database',
				fileUrl: '', fileName: '', fileSize: 0,
				sql: "SELECT * FROM (VALUES ('Ada', 91), ('Lin', 77)) AS t(name, score)",
				tables: '', lastOutput: null, lastInfo: '', error: null, source: 'pglite',
			},
			{ x: 0, y: 0 }
		)
		await zoomToFit(page)
		await runNode(page, dbId, 20_000)

		const dbNode = nodeLocator(page, dbId)
		await expect(dbNode.locator('.NodeErrorBanner')).toHaveCount(0)
		await expect(dbNode.locator('.SortFilterTable-grid')).toBeVisible()
		await expect(dbNode.locator('.SortFilterTable-th', { hasText: 'name' })).toBeVisible()
		await expect(dbNode).toContainText('Ada')
	})

	test('DATA-04/GAPS-10: a one-column list becomes a real table, not "not a table"', async ({ page }) => {
		const promptId = await createNode(page, { type: 'prompt', text: 'tagline\nPlain one\nPlayful two' }, { x: 0, y: 0 })
		const viewId = await createNode(
			page,
			{ type: 'table_view', text: '', filterText: '', sortColumn: '', sortDir: 'asc', error: null, lastOutput: null, lastJson: null, lastInfo: '' },
			{ x: 600, y: 0 }
		)
		await wire(page, promptId, 'output', viewId, 'data')
		await zoomToFit(page)
		await runNode(page, viewId)

		const viewNode = nodeLocator(page, viewId)
		await expect(viewNode.locator('.NodeErrorBanner')).toHaveCount(0)
		await expect(viewNode.locator('.SortFilterTable-th', { hasText: 'tagline' })).toBeVisible()
		await expect(viewNode.locator('.SortFilterTable-grid tbody tr')).toHaveCount(2)
		await expect(viewNode).toContainText('Plain one')
	})

	test('GAPS-07: nested JSON objects flatten to dotted columns, so DataPipe can group by customer.country', async ({ page }) => {
		const json = JSON.stringify([
			{ id: 1, customer: { name: 'Ada', country: 'FR' }, total: 10 },
			{ id: 2, customer: { name: 'Lin', country: 'FR' }, total: 5 },
			{ id: 3, customer: { name: 'Bea', country: 'US' }, total: 7 },
		])
		const promptId = await createNode(page, { type: 'prompt', text: json }, { x: 0, y: 0 })
		const dataPipeId = await createNode(page, tableNode({ op: 'groupby', column: 'customer.country', columns: 'total:sum' }), { x: 600, y: 0 })
		await wire(page, promptId, 'output', dataPipeId, 'data')
		await zoomToFit(page)
		await runNode(page, dataPipeId)

		const props = await nodeProps<{ error: string | null; lastOutput: string | null }>(page, dataPipeId)
		expect(props.error).toBeNull()
		expect(props.lastOutput).toBe('customer.country,sum_total\nFR,15\nUS,7')
	})

	test('DATA-05: Table view sorts a thousands-separated numeric column numerically', async ({ page }) => {
		const id = await createNode(
			page,
			{
				type: 'table_view',
				text: 'amount\n"1,000"\n250\n"999,000"\n"9,500"\n80',
				filterText: '', sortColumn: '', sortDir: 'asc', error: null, lastOutput: null, lastJson: null, lastInfo: '',
			},
			{ x: 0, y: 0 }
		)
		await zoomToFit(page)
		const node = nodeLocator(page, id)
		await node.locator('.SortFilterTable-th', { hasText: 'amount' }).click()
		const rows = node.locator('.SortFilterTable-grid tbody tr')
		await expect(rows.first()).toContainText('80')
		await expect(rows.last()).toContainText('999,000')
	})

	test('DATA-07: DataPipe shows a port dot for "Table" before anything is wired', async ({ page }) => {
		const id = await createNode(page, tableNode({ text: 'name,score\nAda,3' }), { x: 0, y: 0 })
		await zoomToFit(page)
		const tableRow = nodeLocator(page, id).locator('.NodeRow', { hasText: 'Table' }).first()
		await expect(tableRow.locator('.Port')).toHaveCount(1)
	})

	test('DATA-08: switching DataPipe\'s Operation resets the stale "as" field (Condition no longer shows "number")', async ({ page }) => {
		const id = await createNode(page, tableNode({ text: 'name,score\nAda,3\nLin,5', op: 'select', columns: 'name,score', as: 'number' }), { x: 0, y: 0 })
		await zoomToFit(page)
		const node = nodeLocator(page, id)

		await node.locator('.UiField', { hasText: 'Operation' }).locator('.UiSelect-trigger').click()
		await page.locator('.UiSelect-item', { hasText: 'Filter rows' }).first().click()

		await node.locator('.NodeRow', { hasText: 'Column' }).first().locator('.UiSelect-trigger').first().click()
		await page.locator('.UiSelect-item', { hasText: 'score' }).first().click()

		const conditionRow = node.locator('.NodeRow', { hasText: 'Condition' }).first()
		const shownValue = (await conditionRow.locator('.UiSelect-label').innerText()).trim()
		expect(shownValue).not.toBe('number')

		await runNode(page, id)
		const props = await nodeProps<{ error: string | null }>(page, id)
		expect(props.error).toBeNull()
	})

	test('GAPS-12: Built-in Postgres loads wired rows into a target table', async ({ page }) => {
		const rowsId = await createNode(page, tableNode({ text: 'region,amount\nNorth,120\nSouth,90', op: 'select', columns: 'region,amount' }), { x: 0, y: 0 })
		const dbId = await createNode(
			page,
			{
				type: 'database',
				fileUrl: '', fileName: '', fileSize: 0,
				sql: 'select region, amount from sales order by amount desc',
				tables: '', lastOutput: null, lastInfo: '', error: null,
				source: 'pglite', targetTable: 'sales', loadMode: 'replace',
			},
			{ x: 600, y: 0 }
		)
		await wire(page, rowsId, 'output', dbId, 'rows')
		await zoomToFit(page)
		await runNode(page, dbId, 20_000)

		const props = await nodeProps<{ error: string | null; lastOutput: string | null; lastInfo: string }>(page, dbId)
		expect(props.error).toBeNull()
		expect(props.lastInfo).toContain('Loaded 2 row')
		expect(props.lastOutput).toBe('region,amount\nNorth,120\nSouth,90')
	})

	test('GAPS-12: SQLite loads wired rows with no file uploaded yet', async ({ page }) => {
		const rowsId = await createNode(page, tableNode({ text: 'name,score\nAda,91\nLin,77', op: 'select', columns: 'name,score' }), { x: 0, y: 0 })
		const dbId = await createNode(
			page,
			{
				type: 'database',
				fileUrl: '', fileName: '', fileSize: 0,
				sql: 'select name, score from people order by score desc',
				tables: '', lastOutput: null, lastInfo: '', error: null,
				source: 'sqlite', targetTable: 'people', loadMode: 'replace',
			},
			{ x: 600, y: 0 }
		)
		await wire(page, rowsId, 'output', dbId, 'rows')
		await zoomToFit(page)
		await runNode(page, dbId, 20_000)

		const props = await nodeProps<{ error: string | null; lastOutput: string | null; fileUrl: string }>(page, dbId)
		expect(props.error).toBeNull()
		expect(props.lastOutput).toBe('name,score\nAda,91\nLin,77')
		expect(props.fileUrl).toBeTruthy() // a fresh .sqlite file was created and stored
	})

	test('UI-05: Database\'s Source picker stays inside the card (no overflow)', async ({ page }) => {
		const id = await createNode(
			page,
			{ type: 'database', fileUrl: '', fileName: '', fileSize: 0, sql: '', tables: '', lastOutput: null, lastInfo: '', error: null, source: 'sqlite' },
			{ x: 0, y: 0 }
		)
		await zoomToFit(page)
		const node = nodeLocator(page, id)
		const cardBox = (await node.boundingBox())!
		const segmented = node.locator('.UiSegmented').first()
		const segBox = (await segmented.boundingBox())!
		expect(segBox.x).toBeGreaterThanOrEqual(cardBox.x - 1)
		expect(segBox.x + segBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1)
		// WP39: all four options (SQLite, Built-in PG, Postgres, DuckDB) must fit, not just the
		// first three — a 4-item regression previously clipped the last item ("DuckDB" -> "Duc")
		// because only the longest-label item was ever checked here.
		const items = segmented.locator('.UiSegmented-item')
		const itemCount = await items.count()
		expect(itemCount).toBe(4)
		for (let i = 0; i < itemCount; i++) {
			const item = items.nth(i)
			const itemBox = (await item.boundingBox())!
			expect(itemBox.x).toBeGreaterThanOrEqual(cardBox.x - 1)
			expect(itemBox.x + itemBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1)
			// None of the four labels should need to truncate at the card's default width.
			const label = item.locator('.tlui-button__label')
			const overflowing = await label.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
			expect(overflowing).toBe(false)
		}
	})

	test('DATA-09: wiring data into Profile/Table view, or switching DataPipe\'s op, logs no "no port anchor" warnings', async ({ page }) => {
		const warnings: string[] = []
		page.on('console', (msg) => {
			const text = msg.text()
			if (/\[WP(17|21)\]/.test(text) && (text.includes('no port anchor') || text.includes('no field-port anchor'))) {
				warnings.push(text)
			}
		})

		const promptId = await createNode(page, { type: 'prompt', text: 'name,score\nAda,3' }, { x: 0, y: 0 })
		const profileId = await createNode(page, { type: 'profile', text: '', format: 'auto', error: null, lastOutput: null }, { x: 600, y: 0 })
		const viewId = await createNode(
			page,
			{ type: 'table_view', text: '', filterText: '', sortColumn: '', sortDir: 'asc', error: null, lastOutput: null, lastJson: null, lastInfo: '' },
			{ x: 600, y: 900 }
		)
		const dataPipeId = await createNode(page, tableNode({ text: 'name,score\nAda,3' }), { x: 600, y: 1800 })
		await zoomToFit(page)
		// Let each card's own (unwired) anchors register for real before wiring — matches the
		// real UI flow (create both cards, then drag a wire), not an instant create-then-wire
		// that can race the anchor-registration effect and schedule a stale warning.
		await page.waitForTimeout(300)
		await wire(page, promptId, 'output', profileId, 'data')
		await wire(page, promptId, 'output', viewId, 'data')
		await zoomToFit(page)

		// Switch the DataPipe's op away from the default (select has only "columns"; sort has a
		// different param set) — the live anchor check runs continuously, not just on Run.
		await nodeLocator(page, dataPipeId).locator('.UiField', { hasText: 'Operation' }).locator('.UiSelect-trigger').click()
		await page.locator('.UiSelect-item', { hasText: 'Sort' }).first().click()

		await page.waitForTimeout(2300) // the dev-warning setTimeout (2000ms) plus slack
		expect(warnings).toEqual([])
	})
})
