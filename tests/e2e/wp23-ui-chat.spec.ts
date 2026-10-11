import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator, runNode, selectShapes } from './helpers'

test.describe('WP23: long menus', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('the DataPipe operation menu scrolls and filters by typing', async ({ page }) => {
		const id = await page.evaluate(async () => {
			const editor = (window as any).editor
			const { getNodeDefinition } = await import('/client/pipeline/nodes/definitionStore.ts' as string)
			const node = getNodeDefinition(editor, 'table').getDefault()
			const shapeId = `shape:${crypto.randomUUID()}`
			editor.createShape({ id: shapeId, type: 'node', x: 100, y: 100, props: { node, fontSize: 16 } })
			editor.setCamera({ x: 0, y: 0, z: 1 })
			return shapeId
		})

		const card = nodeLocator(page, id)
		const trigger = card.getByTitle('Add next step…')
		await trigger.click()

		// More than 10 options: a search box, autofocused, sits above the (capped, scrolling) list.
		const search = page.locator('.UiSelect-searchInput')
		await expect(search).toBeVisible()
		await expect(search).toBeFocused()

		const menu = page.locator('.tlui-menu').last()
		const menuBox = (await menu.boundingBox())!
		expect(menuBox.height).toBeLessThanOrEqual(421)
		const scrollHeight = await menu.evaluate((el) => el.scrollHeight)
		expect(scrollHeight).toBeGreaterThan(menuBox.height)

		await search.fill('pivot')
		await expect(page.locator('.UiSelect-item', { hasText: 'Pivot' })).toBeVisible()
		await expect(page.locator('.UiSelect-item', { hasText: 'Filter rows' })).toHaveCount(0)
	})
})

test.describe('WP23: error banner', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('is expanded by default, folds on the chevron, and uses icon buttons', async ({ page }) => {
		const id = await createNode(
			page,
			{ type: 'url_in', url: '', fetchBody: false, lastText: null, error: null },
			{ x: 0, y: 0 }
		)
		await runNode(page, id)

		const banner = nodeLocator(page, id).locator('.UiErrorBanner')
		await expect(banner).toBeVisible()
		await expect(banner.locator('.UiErrorBanner-message')).toBeVisible()
		// Copy / Fix with AI / Close are icon-only buttons: no text labels in the banner.
		await expect(banner.locator('.tlui-button__label')).toHaveCount(0)

		await banner.locator('.UiErrorBanner-title').click()
		await expect(banner.locator('.UiErrorBanner-message')).toBeHidden()
	})
})

test.describe('WP23: one output label', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('running a spilling card twice leaves exactly one output label on the canvas', async ({ page }) => {
		const id = await createNode(page, { type: 'prompt', text: 'hello' }, { x: 0, y: 0 })
		await runNode(page, id)
		const firstCount = await page.evaluate(() => (window as any).editor.getCurrentPageShapes().filter((s: any) => s.type === 'text').length)
		expect(firstCount).toBe(1)

		await page.evaluate((shapeId: string) => {
			const editor = (window as any).editor
			const shape = editor.getShape(shapeId)
			editor.updateShape({ id: shapeId, type: 'node', props: { node: { ...shape.props.node, text: 'hello again' }, isOutOfDate: true } })
		}, id)
		await runNode(page, id)

		const secondCount = await page.evaluate(() => (window as any).editor.getCurrentPageShapes().filter((s: any) => s.type === 'text').length)
		expect(secondCount).toBe(1)
	})
})

test.describe('WP23: agent chat builds with selected cards', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('sending the chat with a card selected shows a plan message instead of drawing', async ({ page }) => {
		const planJson = {
			summary: 'Add a note card',
			add: [{ ref: 'n1', type: 'prompt', props: { text: 'hello from the plan' } }],
			update: [],
			wires: [],
			unwire: [],
			notes: [],
			arrange: 'tidy',
		}
		await page.route('/api/generate-text', (route) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: JSON.stringify(planJson) }) })
		)

		const cardId = await createNode(page, { type: 'prompt', text: 'existing card' }, { x: 0, y: 0 })
		await selectShapes(page, [cardId])

		await page.locator('.chat-float-button').click()
		const panel = page.locator('[role="dialog"][aria-label="Agent chat"]')
		await expect(panel).toBeVisible()

		const chip = panel.locator('.chat-mode-chip')
		await expect(chip).toContainText('Building with 1 card')

		const input = panel.locator('textarea[name="input"]')
		await input.fill('wire these up')
		await input.press('Enter')

		const message = panel.locator('.ChatPlanMessage')
		await expect(message).toBeVisible()
		await expect(message).toContainText('Add a note card')
		await expect(message.getByText('Apply', { exact: true })).toBeVisible()
		await expect(message.getByText('Open in Build panel', { exact: true })).toBeVisible()
		await expect(message.getByText('Revise', { exact: true })).toBeVisible()
	})
})
