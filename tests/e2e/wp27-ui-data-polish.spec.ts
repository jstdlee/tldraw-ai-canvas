import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator, nodeProps, runNode, wire, zoomToFit } from './helpers'

/**
 * WP27 — UI/data polish. One spec file per part, grouped here since each is a small check:
 *  A) a long UiSelect shows the down arrow, scrolling reveals the up arrow too
 *  B) a card row's label ellipsises with a title tooltip, and its port dot stays on the row
 *  D) the If card highlights the branch it took, with the value shown
 *  E) Summarize no longer appears in the insert palette search, but an old canvas with one loads
 */

test.describe('WP27 Part A: long menu scroll arrows', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('the If condition select shows a down arrow, scrolling reveals the up arrow', async ({ page }) => {
		const id = await createNode(
			page,
			{ type: 'if', condition: 'contains', operand: 'yes', lastResult: null, lastValue: null },
			{ x: 100, y: 100 }
		)
		await zoomToFit(page)

		// Open the condition UiSelect (15 operators — more than fit in the 420px menu cap).
		await nodeLocator(page, id).locator('.UiSelect-trigger').first().click()
		const menu = page.locator('.tlui-menu, .UiMenu').first()
		await expect(menu).toBeVisible()

		const downArrow = menu.locator('.MenuScrollArrow_down')
		const upArrow = menu.locator('.MenuScrollArrow_up')
		await expect(downArrow).toBeVisible()
		await expect(upArrow).toHaveCount(0)

		await downArrow.click()
		await expect(upArrow).toBeVisible()
	})

	test("tldraw's own right-click Insert submenu shows a down arrow, scrolling reveals the up arrow", async ({ page }) => {
		// A short viewport caps the native `.tlui-menu` well below its item count (60vh = 300px
		// at this height; the "Sources" group alone has 9 rows).
		await page.setViewportSize({ width: 1000, height: 500 })
		await page.mouse.click(500, 250, { button: 'right' })
		await expect(page.getByRole('menuitem', { name: 'Sources' })).toBeVisible()
		await page.getByRole('menuitem', { name: 'Sources' }).hover()

		const submenu = page.locator('.tlui-menu').filter({ has: page.getByRole('menuitem').first() }).last()
		const downArrow = submenu.locator('.MenuScrollArrow_down')
		const upArrow = submenu.locator('.MenuScrollArrow_up')
		await expect(downArrow).toBeVisible()
		await expect(upArrow).toHaveCount(0)

		await downArrow.click()
		await expect(upArrow).toBeVisible()
	})
})

test.describe('WP27 Part B: long row labels', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('a port label wraps to two lines before it is cut, keeps its full text as a title, and the port dot stays on its row', async ({ page }) => {
		const id = await createNode(
			page,
			{ type: 'if', condition: 'contains', operand: 'yes', lastResult: null, lastValue: null },
			{ x: 100, y: 100 }
		)
		await zoomToFit(page)

		const label = nodeLocator(page, id).locator('.NodePortLabel').first()
		await expect(label).toHaveAttribute('title', await label.innerText())
		// WP37 UI-04: a long label wraps to a second line, then the line clamp cuts it.
		const clamp = await label.evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-line-clamp'))
		expect(clamp).toBe('2')

		// The "then" output port dot sits vertically inside its own row's bounding box.
		const row = nodeLocator(page, id).locator('.NodeRow-right').first()
		const port = row.locator('.Port_start').first()
		const rowBox = (await row.boundingBox())!
		const portBox = (await port.boundingBox())!
		expect(portBox.y).toBeGreaterThanOrEqual(rowBox.y - 2)
		expect(portBox.y + portBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 2)
	})

	test('a growing card field wraps long text, keeps the port on its row as it grows, and keeps the value single-line', async ({ page }) => {
		const id = await createNode(
			page,
			{
				type: 'http',
				method: 'GET',
				url: '',
				query: '',
				headers: '',
				body: '',
				auth: '',
				authValue: '',
				extractText: false,
				lastStatus: null,
				lastText: null,
				lastImageUrl: null,
				lastHeaders: null,
				lastMs: null,
				error: null,
			},
			{ x: 100, y: 100 }
		)
		await zoomToFit(page)

		const row = nodeLocator(page, id).locator('.WireField_grow, .NodeRow:has(.UiGrowingInput)').first()
		const input = row.locator('.UiGrowingInput')
		const port = row.locator('.Port_end, .Port').first()
		const shortHeight = (await input.boundingBox())!.height

		const longUrl = 'https://example.com/a/very/long/path?' + 'x=1&'.repeat(40)
		await input.click()
		await input.pressSequentially(longUrl, { delay: 0 })

		await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThan(shortHeight)
		const rowBox = (await row.boundingBox())!
		const portBox = (await port.boundingBox())!
		// The port dot stays vertically inside its (now taller) row's bounding box.
		expect(portBox.y).toBeGreaterThanOrEqual(rowBox.y - 2)
		expect(portBox.y + portBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 2)

		// Enter keeps its usual meaning (commit/blur) and never inserts a newline — the stored
		// value is still a single line.
		await input.press('Enter')
		const url = (await nodeProps<{ url: string }>(page, id)).url
		expect(url).toBe(longUrl)
		expect(url).not.toContain('\n')
	})
})

test.describe('WP27 Part D: If branch highlight', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('after a run, the taken branch is highlighted with its value shown', async ({ page }) => {
		const promptId = await createNode(page, { type: 'prompt', text: 'hello yes world' }, { x: 0, y: 0 })
		const ifId = await createNode(
			page,
			{ type: 'if', condition: 'contains', operand: 'yes', lastResult: null, lastValue: null },
			{ x: 400, y: 0 }
		)
		await zoomToFit(page)
		await wire(page, promptId, 'output', ifId, 'input')
		await runNode(page, ifId)

		const thenBranch = nodeLocator(page, ifId).locator('.NodeBranch').first()
		await expect(thenBranch).toHaveClass(/is-active/)
		await expect(thenBranch).toContainText('hello yes world')
		const elseBranch = nodeLocator(page, ifId).locator('.NodeBranch').nth(1)
		await expect(elseBranch).not.toHaveClass(/is-active/)
	})
})

test.describe('WP27 Part E: Summarize removed', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('Summarize is not in the insert palette search', async ({ page }) => {
		await page.keyboard.press('/')
		await page.keyboard.type('summarize')
		await expect(page.locator('.Palette-insert .NodeSearchPicker-row').first()).toBeVisible()
		// Matches are still allowed to mention "summarize" in a description/keyword (e.g. AI
		// text) — the removed card's own title ("Summarize") must not be one of them.
		const titles = await page.locator('.Palette-insert .NodeSearchPicker-row-title').allInnerTexts()
		expect(titles.some((t) => t.trim().startsWith('Summarize'))).toBe(false)
		await page.keyboard.press('Escape')
	})

	test('an old canvas with a saved Summarize card still loads, as a removed card', async ({ page }) => {
		const id = await page.evaluate(() => {
			const editor = (window as any).editor
			const pageId = editor.getCurrentPageId()
			const snapshot = editor.getSnapshot()
			const store = snapshot.document.store
			const id = 'shape:legacy-summarize'
			store[id] = {
				id,
				typeName: 'shape',
				type: 'node',
				x: 0,
				y: 0,
				rotation: 0,
				isLocked: false,
				opacity: 1,
				parentId: pageId,
				index: 'a1',
				meta: {},
				props: {
					isOutOfDate: false,
					node: {
						type: 'summarize',
						length: 'long',
						format: 'bullets',
						language: 'French',
						focus: 'pricing and deadlines',
						model: 'gpt-4o',
						lastResultText: 'a previously generated summary, cached on the card',
						lastKind: 'web page',
						error: null,
					},
				},
			}
			editor.loadSnapshot(snapshot)
			return id
		})
		await zoomToFit(page)
		await expect(nodeLocator(page, id)).toBeVisible()
		await expect(nodeLocator(page, id)).toContainText('removed')

		// The card's stored settings are kept, not dropped — removedNodeDefinition's validator
		// (.allowUnknownProperties()) passes the whole saved object through unchanged; only the
		// UI stops reading it (shows "removed" instead of the old Summarize controls).
		const node = (await nodeProps<Record<string, unknown>>(page, id))
		expect(node.length).toBe('long')
		expect(node.language).toBe('French')
		expect(node.focus).toBe('pricing and deadlines')
		expect(node.model).toBe('gpt-4o')
		expect(node.lastResultText).toBe('a previously generated summary, cached on the card')
		expect(node.lastKind).toBe('web page')
	})
})
