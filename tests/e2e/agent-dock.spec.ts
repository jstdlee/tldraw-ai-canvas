import { expect, Page, test } from '@playwright/test'
import { clickEmptyCanvas, createNode, gotoApp, nodeLocator, nodeProps, runNode, selectShapes } from './helpers'

/**
 * WP44: one agent panel, docked on the right as a layout column. Every AI feature runs in it.
 * The model is always mocked (`/api/generate-text` and the agent's `/stream`): no test here may
 * call a real AI model or the network.
 */

async function mockGenerateText(page: Page, reply: string | ((body: any) => string)) {
	await page.route('**/api/generate-text', async (route) => {
		const body = route.request().postDataJSON()
		const text = typeof reply === 'function' ? reply(body) : reply
		await route.fulfill({ json: { text } })
	})
}

async function openDock(page: Page) {
	await page.locator('.agent-dock-button').click()
	const dock = page.locator('aside.agent-dock.is-open')
	await expect(dock).toBeVisible()
	return dock
}

async function createText(page: Page, text: string, x: number, y: number): Promise<string> {
	return page.evaluate(
		({ text, x, y }) => {
			const editor = (window as any).editor
			const id = `shape:${crypto.randomUUID()}`
			editor.createShape({
				id,
				type: 'text',
				x,
				y,
				props: { richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } },
			})
			return id
		},
		{ text, x, y }
	)
}

async function canvasWidth(page: Page) {
	return page.evaluate(() => ({
		canvas: document.querySelector('.app-canvas')!.getBoundingClientRect().width,
		viewport: (window as any).editor.getViewportScreenBounds().w as number,
	}))
}

test.describe('WP44: agent dock', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('the dock is a right column: the canvas narrows when it opens and widens when it closes; the width persists', async ({ page }) => {
		const before = await canvasWidth(page)
		const dock = await openDock(page)
		await page.waitForTimeout(300) // the 160 ms width transition

		const box = (await dock.boundingBox())!
		const viewportWidth = page.viewportSize()!.width
		expect(Math.round(box.x + box.width)).toBe(viewportWidth)
		expect(Math.round(box.width)).toBe(380)
		const open = await canvasWidth(page)
		expect(open.canvas).toBeLessThan(before.canvas - 300)
		await expect.poll(async () => (await canvasWidth(page)).viewport).toBeLessThan(before.viewport - 300)

		// Drag the left edge 100 px to the left: 480 px wide.
		const handle = page.locator('.agent-dock-resize')
		const hb = (await handle.boundingBox())!
		await page.mouse.move(hb.x + hb.width / 2, hb.y + 200)
		await page.mouse.down()
		await page.mouse.move(hb.x + hb.width / 2 - 50, hb.y + 200, { steps: 4 })
		await page.mouse.move(hb.x + hb.width / 2 - 100, hb.y + 200, { steps: 4 })
		await page.mouse.up()
		await expect.poll(async () => Math.round((await dock.boundingBox())!.width)).toBe(480)

		await page.reload()
		await page.waitForFunction(() => Boolean((window as any).editor))
		const reloaded = page.locator('aside.agent-dock.is-open')
		await expect(reloaded).toBeVisible()
		await expect.poll(async () => Math.round((await reloaded.boundingBox())!.width)).toBe(480)

		// Double-click the edge: back to 380.
		await page.locator('.agent-dock-resize').dblclick()
		await expect.poll(async () => Math.round((await reloaded.boundingBox())!.width)).toBe(380)

		// Close: the canvas gets its width back.
		await reloaded.getByTitle('Close').click()
		await expect(page.locator('.agent-dock-button')).toBeVisible()
		await expect.poll(async () => (await canvasWidth(page)).canvas).toBeGreaterThan(open.canvas + 300)
	})

	test('the scope chip follows the selection', async ({ page }) => {
		const dock = await openDock(page)
		const chip = dock.locator('.agent-scope-label')
		await expect(chip).toHaveText('Canvas')

		const cardId = await createNode(page, { type: 'prompt', text: 'hello' }, { x: 0, y: 0 })
		await selectShapes(page, [cardId])
		await expect(chip).toHaveText(/^Card: \S/)

		const a = await createText(page, 'first note', 0, 400)
		const b = await createText(page, 'second note', 0, 480)
		await selectShapes(page, [a, b])
		await expect(chip).toHaveText('2 texts')

		await dock.locator('.agent-scope-clear').click()
		await expect(chip).toHaveText('Canvas')
	})

	test('Summarize on two texts: a task message, and a text shape placed with a derived link', async ({ page }) => {
		await mockGenerateText(page, '# Notes\n- first\n- second')
		const a = await createText(page, 'first note', 0, 0)
		const b = await createText(page, 'second note', 0, 80)
		await selectShapes(page, [a, b])
		const dock = await openDock(page)

		await dock.locator('.agent-quick-action', { hasText: 'Summarize' }).click()
		const task = dock.locator('.chat-task[data-task-route="text-job"]')
		await expect(task).toHaveAttribute('data-task-status', 'done')
		await expect(task).toContainText('Notes')
		await expect(task.getByText('Show on canvas')).toBeVisible()

		const placed = await page.evaluate(() => {
			const editor = (window as any).editor
			const shapes = editor.getCurrentPageShapes()
			const md = shapes.find((s: any) => s.type === 'markdown')
			const arrows = shapes.filter((s: any) => s.type === 'arrow' && s.meta?.derived)
			const boundToMd = arrows.filter((arrow: any) => editor.getBindingsFromShape(arrow.id, 'arrow').some((b: any) => b.toId === md?.id))
			return { md: md?.props.md as string | undefined, links: boundToMd.length }
		})
		expect(placed.md).toContain('Notes')
		expect(placed.links).toBe(2)
	})

	test('free text with one card selected: assist change rows, Apply changes the card', async ({ page }) => {
		await mockGenerateText(page, JSON.stringify({ say: 'Updated the text.', props: { text: 'new text from AI' }, needs: [] }))
		const cardId = await createNode(page, { type: 'prompt', text: 'old text' }, { x: 0, y: 0 })
		await selectShapes(page, [cardId])
		const dock = await openDock(page)

		const input = dock.locator('textarea[name="input"]')
		await input.fill('make it say something new')
		await input.press('Enter')

		const task = dock.locator('.chat-task[data-task-route="node-assist"]')
		await expect(task).toHaveAttribute('data-task-status', 'done')
		await expect(task.locator('.chat-task-diffRow')).toContainText('new text from AI')
		await task.getByText('Apply', { exact: true }).click()
		await expect(task).toHaveAttribute('data-task-status', 'applied')
		expect((await nodeProps<{ text: string }>(page, cardId)).text).toBe('new text from AI')
	})

	test('free text with two cards: a plan message, Apply adds the planned cards', async ({ page }) => {
		const plan = {
			summary: 'Add a note card',
			add: [{ ref: 'n1', type: 'prompt', props: { text: 'hello from the plan' } }],
			update: [],
			wires: [],
			unwire: [],
			notes: [],
			arrange: 'tidy',
		}
		await mockGenerateText(page, JSON.stringify(plan))
		const a = await createNode(page, { type: 'prompt', text: 'one' }, { x: 0, y: 0 })
		const b = await createNode(page, { type: 'prompt', text: 'two' }, { x: 400, y: 0 })
		await selectShapes(page, [a, b])
		const dock = await openDock(page)
		await expect(dock.locator('.agent-scope-label')).toHaveText('2 cards')

		const input = dock.locator('textarea[name="input"]')
		await input.fill('wire these up')
		await input.press('Enter')

		const task = dock.locator('.chat-task[data-task-route="build"]')
		await expect(task).toHaveAttribute('data-task-status', 'done')
		await expect(task).toContainText('Add a note card')
		await expect(task.getByText('Arrange cards')).toBeVisible()
		await expect(task.getByText('Run after building')).toBeVisible()

		const countBefore = await page.evaluate(() => (window as any).editor.getCurrentPageShapes().filter((s: any) => s.type === 'node').length)
		await task.getByText('Apply', { exact: true }).click()
		await expect(task).toHaveAttribute('data-task-status', 'applied')
		const nodes = await page.evaluate(() =>
			(window as any).editor
				.getCurrentPageShapes()
				.filter((s: any) => s.type === 'node')
				.map((s: any) => s.props.node.text)
		)
		expect(nodes.length).toBe(countBefore + 1)
		expect(nodes).toContain('hello from the plan')
	})

	test('Rewrite (Alt+B) opens the sheet inside the dock and makes a variant', async ({ page }) => {
		await mockGenerateText(page, 'A shorter version.')
		const a = await createText(page, 'A long sentence that could be much shorter than it is now.', 0, 0)
		await selectShapes(page, [a])
		await clickEmptyCanvas(page, 900, 700)
		await selectShapes(page, [a])
		await page.keyboard.press('Alt+b')

		const sheet = page.locator('aside.agent-dock .agent-sheet-rewrite')
		await expect(sheet).toBeVisible()
		await sheet.locator('.UiChip', { hasText: 'Shorter' }).click()
		await sheet.locator('.agent-sheet-actions .UiButton', { hasText: /^Rewrite$/ }).click()
		await expect(sheet).toHaveCount(0)

		const task = page.locator('aside.agent-dock .chat-task[data-task-route="rewrite"]')
		await expect(task).toHaveAttribute('data-task-status', 'done')
		const variant = await page.evaluate((sourceId: string) => {
			const editor = (window as any).editor
			const v = editor.getCurrentPageShapes().find((s: any) => s.meta?.rewriteOf === sourceId)
			return v ? { label: v.meta.rewriteLabel } : null
		}, a)
		expect(variant).toEqual({ label: 'Shorter' })
		await expect(page.locator('.ai-dialog')).toHaveCount(0)
	})

	test('Fix with AI on a card error runs at once', async ({ page }) => {
		const prompts: string[] = []
		await mockGenerateText(page, (body) => {
			prompts.push(String(body.prompt ?? ''))
			return JSON.stringify({ say: 'Set a URL.', props: { url: 'https://example.com' }, needs: [] })
		})
		const id = await createNode(page, { type: 'url_in', url: '', fetchBody: false, lastText: null, error: null }, { x: 0, y: 0 })
		await runNode(page, id)
		const banner = nodeLocator(page, id).locator('.UiErrorBanner')
		await expect(banner).toBeVisible()
		await banner.getByTitle('Fix with AI').click()

		const dock = page.locator('aside.agent-dock.is-open')
		await expect(dock).toBeVisible()
		await expect(dock.locator('.agent-scope-label')).toHaveText(/^Card: /)
		const task = dock.locator('.chat-task[data-task-route="node-assist"]')
		await expect(task).toHaveAttribute('data-task-status', 'done')
		await expect(task).toContainText('Fix error')
		expect(prompts[0]).toMatch(/^Fix this error: /)
	})

	test('Ctrl+Shift+K opens the dock and focuses the input', async ({ page }) => {
		await expect(page.locator('aside.agent-dock.is-open')).toHaveCount(0)
		await clickEmptyCanvas(page)
		await page.keyboard.press('Control+Shift+K')
		const dock = page.locator('aside.agent-dock.is-open')
		await expect(dock).toBeVisible()
		await expect(dock.locator('textarea[name="input"]')).toBeFocused()
	})

	test('no floating chat, build or fill panel, and no AI dialog for these features', async ({ page }) => {
		await mockGenerateText(page, JSON.stringify({ say: 'ok', props: {}, needs: [] }))
		const cardId = await createNode(page, { type: 'prompt', text: 'hello' }, { x: 300, y: 200 })
		await page.locator('.agent-dock-button').click()
		await expect(page.locator('aside.agent-dock.is-open')).toBeVisible()

		// The ✦ button on a card: selects it and focuses the dock, no floating card panel.
		await nodeLocator(page, cardId).hover()
		await nodeLocator(page, cardId).locator('.NodeAiButton').click()
		await expect(page.locator('aside.agent-dock .agent-scope-label')).toHaveText(/^Card: /)
		await expect(page.locator('aside.agent-dock textarea[name="input"]')).toBeFocused()

		// Build with AI from the context menu: a pending action in the dock, not a panel.
		await selectShapes(page, [cardId])
		// Right-click the card's title row (its body holds a text field that keeps pointer events).
		const box = (await nodeLocator(page, cardId).boundingBox())!
		await page.mouse.click(box.x + 20, box.y + 10, { button: 'right' })
		await page.getByRole('menuitem', { name: 'AI', exact: true }).click()
		await page.getByRole('menuitem', { name: /Build with AI/ }).click()
		await expect(page.locator('aside.agent-dock .agent-pending-tag')).toHaveText(/Build a workflow/)
		await expect(page.locator('aside.agent-dock textarea[name="input"]')).toBeFocused()
		await expect(page.locator('.FloatingPanel')).toHaveCount(0)
		await expect(page.locator('[role="dialog"][aria-label="Agent chat"]')).toHaveCount(0)
		await expect(page.locator('.ai-dialog')).toHaveCount(0)
		await expect(page.locator('.chat-mode-chip')).toHaveCount(0)
	})
})
