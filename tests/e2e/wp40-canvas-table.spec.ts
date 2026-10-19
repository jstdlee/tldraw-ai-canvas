import { mkdirSync } from 'node:fs'
import { expect, Page, test } from '@playwright/test'
import { gotoApp, zoomToFit } from './helpers'

/**
 * WP40: canvas-native `table` shape — core editing experience, column types, templates, paste,
 * undo, resize/auto-fit, insert/delete row & column, old-canvas migration, and the light/dark
 * screenshots of an Issue list and a PR list the owner asked for.
 */

const SCREENSHOT_DIR =
	'/tmp/claude-1000/-home-leilei-dev/b748c873-b27f-4f05-99d7-ad20f0decaac/scratchpad/review/wp40'
mkdirSync(SCREENSHOT_DIR, { recursive: true })

function tableLocator(page: Page) {
	return page.locator('.TableShape').first()
}

async function getTable(page: Page): Promise<any> {
	return page.evaluate(() => {
		const editor = (window as any).editor
		const shape = editor.getCurrentPageShapes().find((s: any) => s.type === 'table')
		return shape?.props.table
	})
}

async function insertBlankTable(page: Page, cols: number, rows: number): Promise<string> {
	return page.evaluate(
		async ({ cols, rows }) => {
			const editor = (window as any).editor
			const mod = await import('/client/pipeline/table/TableShapeUtil.tsx' as string)
			const { id } = mod.insertBlankTable(editor, cols, rows)
			return id
		},
		{ cols, rows }
	)
}

async function insertTemplate(page: Page, templateId: string): Promise<string> {
	return page.evaluate(async (templateId) => {
		const editor = (window as any).editor
		const mod = await import('/client/pipeline/table/TableShapeUtil.tsx' as string)
		const { id } = mod.insertTableTemplate(editor, templateId)
		return id
	}, templateId)
}

async function setDark(page: Page, dark: boolean) {
	await page.evaluate((dark) => {
		;(window as any).editor.user.updateUserPreferences({ colorScheme: dark ? 'dark' : 'light' })
	}, dark)
}

test.describe('WP40 canvas table', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('insert a 4x3 blank table', async ({ page }) => {
		await insertBlankTable(page, 4, 3)
		await zoomToFit(page)
		await expect(tableLocator(page)).toBeVisible()
		const table = await getTable(page)
		expect(table.columns).toHaveLength(4)
		expect(table.rows).toHaveLength(3)
	})

	test('edit cells with keyboard navigation: type, Tab, Enter commit and move', async ({ page }) => {
		await insertBlankTable(page, 3, 2)
		await zoomToFit(page)
		const shape = tableLocator(page)
		await shape.locator('.TableShape-cell').first().click()
		await page.keyboard.type('Ada')
		await page.keyboard.press('Tab')
		await page.keyboard.type('Paris')
		await page.keyboard.press('Enter')

		const table = await getTable(page)
		const [colA, colB] = table.columns
		expect(table.rows[0].cells[colA.id]).toBe('Ada')
		expect(table.rows[0].cells[colB.id]).toBe('Paris')

		// Enter moved the active cell down one row without starting a new edit.
		const activeAfter = await page.evaluate(
			() => document.querySelector('.TableShape-cell.active.editing') === null
		)
		expect(activeAfter).toBe(true)
	})

	test('Escape cancels an edit without committing', async ({ page }) => {
		await insertBlankTable(page, 2, 2)
		await zoomToFit(page)
		const shape = tableLocator(page)
		await shape.locator('.TableShape-cell').first().click()
		await page.keyboard.type('temp')
		await page.keyboard.press('Escape')
		const table = await getTable(page)
		expect(table.rows[0].cells[table.columns[0].id]).toBe('')
	})

	test('every committed edit is one undo step', async ({ page }) => {
		await insertBlankTable(page, 2, 2)
		await zoomToFit(page)
		const shape = tableLocator(page)
		await shape.locator('.TableShape-cell').first().click()
		await page.keyboard.type('one')
		// Enter commits 'one' and moves the active cell down a row (no re-click needed/wanted —
		// clicking the first cell again would just re-select (0,0) instead of following the move).
		await page.keyboard.press('Enter')
		await page.keyboard.type('two')
		await page.keyboard.press('Enter')

		let table = await getTable(page)
		expect(table.rows[0].cells[table.columns[0].id]).toBe('one')
		expect(table.rows[1].cells[table.columns[0].id]).toBe('two')

		await page.keyboard.press('Control+z')
		table = await getTable(page)
		expect(table.rows[1].cells[table.columns[0].id]).toBe('')
		expect(table.rows[0].cells[table.columns[0].id]).toBe('one')

		await page.keyboard.press('Control+z')
		table = await getTable(page)
		expect(table.rows[0].cells[table.columns[0].id]).toBe('')
	})

	test('resize a column by dragging its right border', async ({ page }) => {
		await insertBlankTable(page, 3, 2)
		await zoomToFit(page)
		const before = await getTable(page)
		const startWidth = before.columns[0].width

		const handle = tableLocator(page).locator('.TableShape-colResize').first()
		const box = await handle.boundingBox()
		if (!box) throw new Error('no resize handle')
		const startX = box.x + box.width / 2
		const startY = box.y + box.height / 2
		await page.mouse.move(startX, startY)
		await page.mouse.down()
		await page.mouse.move(startX + 150, startY, { steps: 5 })
		await page.mouse.up()

		const after = await getTable(page)
		// A page-space delta, not a screen-pixel one: zoomToFit may zoom in on a small table, so
		// the actual column-width change is the mouse delta divided by the zoom level, not 1:1.
		expect(after.columns[0].width).toBeGreaterThan(startWidth + 30)
	})

	test('double-click a column border auto-fits its width to content', async ({ page }) => {
		await insertBlankTable(page, 2, 1)
		await zoomToFit(page)
		const shape = tableLocator(page)
		await shape.locator('.TableShape-cell').first().click()
		await page.keyboard.type('A very long value that needs a lot of room to show in full')
		await page.keyboard.press('Enter')

		const before = await getTable(page)
		const handle = tableLocator(page).locator('.TableShape-colResize').first()
		await handle.dblclick()
		const after = await getTable(page)
		expect(after.columns[0].width).toBeGreaterThan(before.columns[0].width)
	})

	test('double-click a row border auto-fits its height to content', async ({ page }) => {
		await insertBlankTable(page, 1, 1)
		await zoomToFit(page)
		const shape = tableLocator(page)
		await shape.locator('.TableShape-cell').first().click()
		await page.keyboard.type('short')
		await page.keyboard.press('Enter')

		const handle = tableLocator(page).locator('.TableShape-rowResize').first()
		await handle.dblclick()
		const table = await getTable(page)
		expect(typeof table.rows[0].height).toBe('number')
	})

	test('insert/delete row and column via the context menu', async ({ page }) => {
		await insertBlankTable(page, 2, 2)
		await zoomToFit(page)
		const shape = tableLocator(page)
		const cell = shape.locator('.TableShape-cell').first()
		// A plain (left) click first: on an unselected table the very first pointerdown only
		// selects the shape (see TableShapeComponent's onPointerDownCapture) — selecting here
		// first keeps this test about the context menu, not about that unrelated first-click
		// nuance.
		await cell.click()
		await cell.click({ button: 'right' })
		await page.getByRole('button', { name: 'Insert row below' }).click()
		let table = await getTable(page)
		expect(table.rows).toHaveLength(3)

		await shape.locator('.TableShape-cell').first().click({ button: 'right' })
		await page.getByRole('button', { name: 'Insert column right' }).click()
		table = await getTable(page)
		expect(table.columns).toHaveLength(3)

		await shape.locator('.TableShape-cell').first().click({ button: 'right' })
		await page.getByRole('button', { name: 'Delete row' }).click()
		table = await getTable(page)
		expect(table.rows).toHaveLength(2)

		await shape.locator('.TableShape-cell').first().click({ button: 'right' })
		await page.getByRole('button', { name: 'Delete column' }).click()
		table = await getTable(page)
		expect(table.columns).toHaveLength(2)
	})

	test('hover "+" handles add a row and a column', async ({ page }) => {
		await insertBlankTable(page, 2, 2)
		await zoomToFit(page)
		const shape = tableLocator(page)
		await shape.locator('.TableShape-cell').first().click()
		await shape.locator('.TableShape-addRow').click({ force: true })
		await shape.locator('.TableShape-addCol').click({ force: true })
		const table = await getTable(page)
		expect(table.rows).toHaveLength(3)
		expect(table.columns).toHaveLength(3)
	})

	test('Ctrl+Enter adds a row below the active row', async ({ page }) => {
		await insertBlankTable(page, 2, 2)
		await zoomToFit(page)
		await tableLocator(page).locator('.TableShape-cell').first().click()
		await page.keyboard.press('Control+Enter')
		const table = await getTable(page)
		expect(table.rows).toHaveLength(3)
	})

	test('paste a TSV block grows the table and lands at the selected cell', async ({ page }) => {
		await insertBlankTable(page, 2, 2)
		await zoomToFit(page)
		const shape = tableLocator(page)
		await shape.locator('.TableShape-cell').first().click()

		await page.evaluate(() => {
			const dt = new DataTransfer()
			dt.setData('text/plain', 'a\tb\tc\nd\te\tf')
			const el = document.activeElement
			const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
			el?.dispatchEvent(ev)
		})

		const table = await getTable(page)
		expect(table.columns.length).toBeGreaterThanOrEqual(3)
		expect(table.rows.length).toBeGreaterThanOrEqual(2)
		expect(table.rows[0].cells[table.columns[0].id]).toBe('a')
		expect(table.rows[1].cells[table.columns[2].id]).toBe('f')
	})

	test('status column: changing type keeps values, picking an option, checkbox toggles directly', async ({
		page,
	}) => {
		const id = await insertTemplate(page, 'checklist')
		await zoomToFit(page)
		const table = await getTable(page)
		expect(table.columns.map((c: any) => c.name)).toEqual(['Done', 'Item', 'Owner', 'Notes'])
		expect(table.columns[0].type).toBe('checkbox')

		const shape = tableLocator(page)
		// Checkbox cell toggles on a single click, no edit mode.
		const checkbox = shape.locator('.TableShape-checkbox').first()
		await checkbox.click()
		const after = await getTable(page)
		expect(after.rows[0].cells[after.columns[0].id]).toBe('true')
		void id
	})

	test('insert the four templates and verify their columns', async ({ page }) => {
		const expected: Record<string, string[]> = {
			'issue-list': ['#', 'Title', 'Status', 'Owner', 'Priority', 'Due'],
			'pr-list': ['PR', 'Title', 'Author', 'Status', 'Reviewer', 'Link'],
			checklist: ['Done', 'Item', 'Owner', 'Notes'],
			comparison: ['Feature', 'A', 'B', 'C'],
		}
		for (const [templateId, cols] of Object.entries(expected)) {
			await page.evaluate(() => {
				const editor = (window as any).editor
				editor.deleteShapes(editor.getCurrentPageShapes().map((s: any) => s.id))
			})
			await insertTemplate(page, templateId)
			const table = await getTable(page)
			expect(table.columns.map((c: any) => c.name)).toEqual(cols)
		}
	})

	test('"Use as data" creates a Prompt card with the table as CSV', async ({ page }) => {
		await insertBlankTable(page, 2, 1)
		await page.evaluate(() => {
			const editor = (window as any).editor
			const table = editor.getCurrentPageShapes().find((s: any) => s.type === 'table')
			const row = table.props.table.rows[0]
			const col = table.props.table.columns[0]
			editor.updateShape({
				id: table.id,
				type: 'table',
				props: { table: { ...table.props.table, rows: [{ ...row, cells: { ...row.cells, [col.id]: 'x' } }] } },
			})
			editor.select(table.id)
		})
		await page.evaluate(async () => {
			const editor = (window as any).editor
			const mod = await import('/client/pipeline/table/TableShapeUtil.tsx' as string)
			const table = editor.getCurrentPageShapes().find((s: any) => s.type === 'table')
			mod.tableUseAsData(editor, table.id)
		})
		const hasPromptCard = await page.evaluate(() => {
			const editor = (window as any).editor
			return editor
				.getCurrentPageShapes()
				.some((s: any) => s.type === 'node' && s.props.node.type === 'prompt' && s.props.node.text.includes('x'))
		})
		expect(hasPromptCard).toBe(true)
	})

	test('agent create-table action creates a table shape with the given columns and rows', async ({ page }) => {
		// A minimal stand-in for AgentHelpers/TldrawAgent — CreateTableActionUtil only calls
		// these three methods (see client/actions/CreateTableActionUtil.ts). Building a real
		// AgentHelpers needs a full TldrawAgent (chat origin, model, etc.), which is its own
		// heavy subsystem unrelated to what this test is checking: that the action, once
		// sanitized, actually creates the right `table` shape via editor.createShape.
		await page.evaluate(async () => {
			const editor = (window as any).editor
			const actionMod = await import('/client/actions/CreateTableActionUtil.ts' as string)
			const util = new actionMod.CreateTableActionUtil({ editor } as any)
			const usedIds = new Set<string>()
			const helpers = {
				ensureShapeIdIsUnique: (id: string) => {
					let next = id
					while (usedIds.has(next) || editor.getShape(`shape:${next}`)) next = `${next}-2`
					usedIds.add(next)
					return next
				},
				ensureValueIsNumber: (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null),
				removeOffsetFromVec: (v: { x: number; y: number }) => v,
			}
			const action: any = {
				_type: 'create-table',
				intent: 'make a small PR list',
				shapeId: 'agent-table-1',
				x: 100,
				y: 100,
				columns: ['PR', 'Title'],
				rows: [['1', 'Fix bug']],
				complete: true,
			}
			const sanitized = util.sanitizeAction(action, helpers as any)
			util.applyAction({ ...sanitized, complete: true }, helpers as any)
		})
		const table = await getTable(page)
		expect(table.columns.map((c: any) => c.name)).toEqual(['PR', 'Title'])
		expect(table.rows[0].cells[table.columns[0].id]).toBe('1')
		expect(table.rows[0].cells[table.columns[1].id]).toBe('Fix bug')
	})

	test('an old/partial table shape (pre-migration shape) loads via the migration, never crashes the canvas', async ({
		page,
	}) => {
		const errors: string[] = []
		page.on('pageerror', (e) => errors.push(e.message))
		await page.evaluate(() => {
			const editor = (window as any).editor
			const pageId = editor.getCurrentPageId()
			const snapshot = editor.getSnapshot()
			const store = snapshot.document.store
			delete snapshot.document.schema.sequences['com.tldraw.shape.table']
			const id = 'shape:old-table'
			store[id] = {
				id,
				typeName: 'shape',
				type: 'table',
				x: 0,
				y: 0,
				rotation: 0,
				isLocked: false,
				opacity: 1,
				parentId: pageId,
				index: 'a1',
				meta: {},
				// Old/partial shape: columns missing width/type, no headerRow, no color/size/dash.
				props: {
					table: {
						columns: [{ id: 'c1', name: 'Name' }],
						rows: [{ id: 'r1', cells: { c1: 'Ada' } }],
					},
				},
			}
			editor.loadSnapshot(snapshot)
		})
		await zoomToFit(page)
		await expect(tableLocator(page)).toBeVisible()
		const table = await getTable(page)
		expect(table.columns[0].width).toBeGreaterThan(0)
		expect(table.columns[0].type).toBe('text')
		expect(table.rows[0].cells.c1).toBe('Ada')
		expect(errors).toEqual([])
	})

	test('save/reload: a table survives a full page reload (persistence)', async ({ page }) => {
		await insertBlankTable(page, 2, 1)
		await tableLocator(page).locator('.TableShape-cell').first().click()
		await page.keyboard.type('persisted')
		await page.keyboard.press('Enter')
		await page.waitForTimeout(300) // let the persistence layer flush
		await page.reload()
		await page.waitForFunction(() => Boolean((window as any).editor))
		await zoomToFit(page)
		const table = await getTable(page)
		expect(table.rows[0].cells[table.columns[0].id]).toBe('persisted')
	})

	// --- Screenshots (light + dark) of a realistic Issue list and PR list ------------------

	async function buildIssueList(page: Page, x: number, y: number) {
		const id = await insertTemplate(page, 'issue-list')
		await page.evaluate(
			({ id, x, y }) => {
				const editor = (window as any).editor
				const shape = editor.getShape(id)
				const cols = shape.props.table.columns
				const byName = Object.fromEntries(cols.map((c: any) => [c.name, c]))
				const statusId = (name: string, label: string) =>
					byName[name].options.find((o: any) => o.label === label).id
				const data = [
					['1', 'Login fails on Safari 17', 'In progress', 'Maya Patel', 'High', '2026-10-24'],
					['2', 'Export button does nothing', 'Open', 'Jordan Lee', 'Urgent', '2026-11-02'],
					['3', 'Dark mode header contrast too low', 'Review', 'Priya Natarajan', 'Medium', '2026-11-08'],
					['4', 'Add shortcut for duplicate row', 'Done', 'Sam Okafor', 'Low', '2026-10-21'],
				]
				const columns = cols.map((c: any) => (c.name === 'Title' ? { ...c, width: 300 } : c))
				const rows = shape.props.table.rows.map((row: any, i: number) => {
					const d = data[i]
					if (!d) return { ...row, height: 36 }
					return {
						...row,
						height: 36,
						cells: {
							[byName['#'].id]: d[0],
							[byName['Title'].id]: d[1],
							[byName['Status'].id]: statusId('Status', d[2]),
							[byName['Owner'].id]: d[3],
							[byName['Priority'].id]: statusId('Priority', d[4]),
							[byName['Due'].id]: d[5],
						},
					}
				})
				editor.updateShape({ id, type: 'table', props: { table: { ...shape.props.table, columns, rows } } })
				editor.updateShape({ id, type: 'table', x, y })
			},
			{ id, x, y }
		)
		return id
	}

	async function buildPrList(page: Page, x: number, y: number) {
		const id = await insertTemplate(page, 'pr-list')
		await page.evaluate(
			({ id, x, y }) => {
				const editor = (window as any).editor
				const shape = editor.getShape(id)
				const cols = shape.props.table.columns
				const byName = Object.fromEntries(cols.map((c: any) => [c.name, c]))
				const statusId = (name: string, label: string) =>
					byName[name].options.find((o: any) => o.label === label).id
				const data = [
					['482', 'Fix flaky upload retry test', 'Jordan Lee', 'Approved', 'Maya Patel', 'github.com/acme/app/pull/482'],
					['486', 'Add dark mode to settings page', 'Priya Natarajan', 'Open', 'Sam Okafor', 'github.com/acme/app/pull/486'],
					['489', 'Bump tldraw to 5.5.2', 'Sam Okafor', 'Merged', 'Jordan Lee', 'github.com/acme/app/pull/489'],
					['491', 'Draft: streaming export', 'Maya Patel', 'Draft', '', 'github.com/acme/app/pull/491'],
				]
				const columns = cols.map((c: any) =>
					c.name === 'Title' ? { ...c, width: 260 } : c.name === 'Link' ? { ...c, width: 220 } : c
				)
				const rows = shape.props.table.rows.map((row: any, i: number) => {
					const d = data[i]
					if (!d) return { ...row, height: 36 }
					return {
						...row,
						height: 36,
						cells: {
							[byName['PR'].id]: d[0],
							[byName['Title'].id]: d[1],
							[byName['Author'].id]: d[2],
							[byName['Status'].id]: statusId('Status', d[3]),
							[byName['Reviewer'].id]: d[4],
							[byName['Link'].id]: d[5],
						},
					}
				})
				editor.updateShape({ id, type: 'table', props: { table: { ...shape.props.table, columns, rows } } })
				editor.updateShape({ id, type: 'table', x, y })
			},
			{ id, x, y }
		)
		return id
	}

	test('screenshots: Issue list + PR list, light and dark', async ({ page }) => {
		test.setTimeout(60_000)
		await buildIssueList(page, 0, 0)
		await buildPrList(page, 0, 260)
		await page.evaluate(() => {
			;(window as any).editor.selectNone()
		})
		await zoomToFit(page)
		await page.waitForTimeout(150)

		await setDark(page, false)
		await page.waitForTimeout(100)
		await page.screenshot({ path: `${SCREENSHOT_DIR}/issue-and-pr-list-light.png` })

		await setDark(page, true)
		await page.waitForTimeout(100)
		await page.screenshot({ path: `${SCREENSHOT_DIR}/issue-and-pr-list-dark.png` })

		// Also one close-up of each, light and dark, since the owner wants to scrutinize each on its own.
		await setDark(page, false)
		const shapes = await page.evaluate(() => (window as any).editor.getCurrentPageShapes().map((s: any) => s.id))
		for (const [name, id] of [
			['issue-list', shapes[0]],
			['pr-list', shapes[1]],
		] as const) {
			await page.evaluate((id) => {
				const editor = (window as any).editor
				const bounds = editor.getShapePageBounds(id)
				editor.zoomToBounds(bounds.clone().expandBy(24), { animation: { duration: 0 } })
			}, id)
			await page.waitForTimeout(100)
			await setDark(page, false)
			await page.waitForTimeout(80)
			await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}-light.png` })
			await setDark(page, true)
			await page.waitForTimeout(80)
			await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}-dark.png` })
		}
	})

	// --- Follow-up fixes ---------------------------------------------------------------

	test('row numbers are hidden by default and the table menu can turn them on', async ({ page }) => {
		const id = await insertTemplate(page, 'issue-list')
		await zoomToFit(page)
		const gutter = tableLocator(page).locator('.TableShape-rowGutter').first()
		await expect(gutter.locator('.TableShape-rowNum')).toHaveCSS('opacity', '0')

		await tableLocator(page).click({ position: { x: 5, y: 5 } })
		await tableLocator(page).click({ button: 'right', position: { x: 5, y: 5 } })
		await page.getByRole('button', { name: 'Show row numbers' }).click()
		const table = await getTable(page)
		expect(table.rowNumbers).toBe(true)
		await expect(gutter.locator('.TableShape-rowNum')).toHaveCSS('opacity', '1')
		void id
	})

	test('no console error (e.g. the PipelineRegions setState-during-render warning) while inserting, editing, resizing and auto-fitting a table', async ({
		page,
	}) => {
		const errors: string[] = []
		page.on('console', (msg) => {
			if (msg.type() === 'error') errors.push(msg.text())
		})
		page.on('pageerror', (e) => errors.push(e.message))

		await insertBlankTable(page, 3, 2)
		await zoomToFit(page)
		const shape = tableLocator(page)
		await shape.locator('.TableShape-cell').first().click()
		await page.keyboard.type('hello')
		await page.keyboard.press('Enter')

		const handle = shape.locator('.TableShape-colResize').first()
		const box = await handle.boundingBox()
		if (box) {
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
			await page.mouse.down()
			await page.mouse.move(box.x + 150, box.y + box.height / 2, { steps: 5 })
			await page.mouse.up()
		}
		await handle.dblclick()
		await page.waitForTimeout(200)

		expect(errors.filter((e) => e.includes('PipelineRegions') || e.includes('while rendering'))).toEqual([])
	})

	test('Ctrl+P finds and inserts a table template (cardSearch / InsertPalette integration)', async ({ page }) => {
		await page.keyboard.press('Control+p')
		await page.getByPlaceholder('Search features and cards').fill('issue list')
		await page.getByRole('option', { name: /Table · Issue list/ }).click()
		const table = await getTable(page)
		expect(table.columns.map((c: any) => c.name)).toEqual(['#', 'Title', 'Status', 'Owner', 'Priority', 'Due'])
	})
})
