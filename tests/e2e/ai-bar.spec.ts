import { expect, Page, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator, nodeProps, runNode, selectShapes } from './helpers'

/**
 * WP48: one AI bar on the selection, one agent, preview then Apply. Every model reply is
 * mocked (`/stream` for the agent, `/api/generate-text` for build plans and card fills): no
 * test here calls a real AI model or the network.
 */

function sse(events: Record<string, unknown>[]): string {
	return events.map((e) => `data: ${JSON.stringify('error' in e ? e : { ...e, complete: true, time: 20 })}\n\n`).join('')
}

/** Each /stream call gets the next reply in `replies` (the last one repeats). Returns the request bodies. */
async function mockStream(page: Page, replies: Record<string, unknown>[][]) {
	const bodies: any[] = []
	await page.route('**/stream', async (route) => {
		bodies.push(route.request().postDataJSON())
		const reply = replies[Math.min(bodies.length - 1, replies.length - 1)]
		await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(reply) })
	})
	return bodies
}

async function mockGenerateText(page: Page, reply: string) {
	await page.route('**/api/generate-text', (route) => route.fulfill({ json: { text: reply } }))
}

const bar = (page: Page) => page.locator('.ai-bar')
const barInput = (page: Page) => page.locator('.ai-bar textarea[name="ai-bar-input"]')
const dock = (page: Page) => page.locator('aside.agent-dock.is-open')

async function ask(page: Page, text: string) {
	// The bar opens only on request (card AI button, Ctrl+K, menus), never on selection alone.
	if (!(await bar(page).isVisible())) await page.keyboard.press('Control+k')
	await barInput(page).click()
	await barInput(page).fill(text)
	await barInput(page).press('Enter')
}

function nodeCount(page: Page) {
	return page.evaluate(() => (window as any).editor.getCurrentPageShapes().filter((s: any) => s.type === 'node').length)
}

function shapeSnapshot(page: Page) {
	return page.evaluate(() =>
		JSON.stringify(
			(window as any).editor
				.getCurrentPageShapes()
				.map((s: any) => ({ id: s.id, x: s.x, y: s.y, props: s.props }))
				.sort((a: any, b: any) => (a.id < b.id ? -1 : 1))
		)
	)
}

test.describe('WP48: AI bar', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('selecting does not open the bar; the card AI button opens it above the card, and it follows zoom', async ({ page }) => {
		const id = await createNode(page, { type: 'prompt', text: 'hello' }, { x: 200, y: 300 })
		await selectShapes(page, [id])
		await page.waitForTimeout(400)
		await expect(bar(page)).toHaveCount(0)
		await nodeLocator(page, id).locator('.NodeAiButton').click()
		await expect(bar(page)).toBeVisible()
		await expect(bar(page).locator('.ai-bar-scope')).toHaveText(/^Card: /)

		const above = async () => {
			const b = (await bar(page).boundingBox())!
			const c = (await nodeLocator(page, id).boundingBox())!
			return { barBottom: b.y + b.height, cardTop: c.y, barCenter: b.x + b.width / 2, cardCenter: c.x + c.width / 2, width: b.width }
		}
		const first = await above()
		expect(first.barBottom).toBeLessThan(first.cardTop)
		expect(Math.abs(first.barCenter - first.cardCenter)).toBeLessThan(4)
		expect(Math.round(first.width)).toBe(420)

		await page.evaluate(() => {
			const editor = (window as any).editor
			editor.setCamera({ ...editor.getCamera(), z: editor.getCamera().z * 0.6 })
		})
		await expect.poll(async () => (await above()).cardTop).not.toBe(first.cardTop)
		const zoomed = await above()
		expect(zoomed.barBottom).toBeLessThan(zoomed.cardTop)
		expect(Math.abs(zoomed.barCenter - zoomed.cardCenter)).toBeLessThan(4)
	})

	test('Ctrl+K opens the bar with nothing selected, at the canvas center; Escape closes it', async ({ page }) => {
		await page.evaluate(() => (window as any).editor.selectNone())
		await expect(bar(page)).toHaveCount(0)
		await page.mouse.click(700, 560)
		await page.keyboard.press('Control+k')
		await expect(bar(page)).toBeVisible()
		await expect(barInput(page)).toBeFocused()
		await expect(bar(page).locator('.ai-bar-scope')).toHaveText('Canvas')
		const box = (await bar(page).boundingBox())!
		const canvas = (await page.locator('.app-canvas').boundingBox())!
		expect(Math.abs(box.x + box.width / 2 - (canvas.x + canvas.width / 2))).toBeLessThan(4)
		await barInput(page).press('Escape')
		await expect(bar(page)).toHaveCount(0)
	})

	test('each card has one AI button; there is no round dock button', async ({ page }) => {
		const id = await createNode(page, { type: 'prompt', text: 'hello' }, { x: 200, y: 300 })
		await expect(nodeLocator(page, id).locator('.NodeAiButton')).toHaveCount(1)
		await expect(page.locator('.agent-dock-button')).toHaveCount(0)
		// The top-right "Agent" toggle still opens the dock.
		await page.locator('.app-panel-toggles').getByText('Agent', { exact: true }).click()
		await expect(dock(page)).toBeVisible()
	})

	test('Enter sends: the dock opens with the task; a drawing is a preview that Discard removes', async ({ page }) => {
		await mockStream(page, [
			[
				{
					_type: 'create',
					intent: 'Draw a box',
					shape: { _type: 'rectangle', shapeId: 'box1', x: 100, y: 100, w: 200, h: 100, color: 'black', fill: 'none', note: 'a box' },
				},
				{ _type: 'message', text: 'Drew a box.' },
			],
		])
		const before = await shapeSnapshot(page)
		await page.mouse.click(700, 560)
		await page.keyboard.press('Control+k')
		await ask(page, 'draw a box')
		await expect(dock(page)).toBeVisible()
		const task = dock(page).locator('.chat-task[data-task-route="agent"]')
		await expect(task).toHaveAttribute('data-task-status', 'preview')
		await expect(dock(page)).toContainText('draw a box')
		// The bar closes when the task reaches its preview.
		await expect(bar(page).locator('.ai-bar-progress')).toHaveCount(0)
		await expect(page.locator('style[data-ai-preview]')).toHaveCount(1)
		expect(await page.evaluate(() => (window as any).editor.getCurrentPageShapes().some((s: any) => s.type === 'geo'))).toBe(true)

		await task.getByText('Discard', { exact: true }).click()
		await expect(task).toHaveAttribute('data-task-status', 'discarded')
		expect(await shapeSnapshot(page)).toBe(before)
		await expect(page.locator('style[data-ai-preview]')).toHaveCount(0)
	})

	test('a vague request gets one ask-user question with chips; a chip continues', async ({ page }) => {
		const bodies = await mockStream(page, [
			[{ _type: 'ask-user', question: 'Make it better how?', options: ['Shorter', 'More formal'] }],
			[{ _type: 'message', text: 'OK, shorter it is.' }],
		])
		await page.mouse.click(700, 560)
		await page.keyboard.press('Control+k')
		await ask(page, 'make it better')

		const question = dock(page).locator('.chat-task[data-task-route="ask-user"]')
		await expect(question).toContainText('Make it better how?')
		await expect(question.locator('.UiChip')).toHaveCount(2)
		// The bar shows the question too, with the same answers.
		await expect(bar(page).locator('.ai-bar-question')).toContainText('Make it better how?')
		await bar(page).locator('.ai-bar-question .agent-quick-action', { hasText: 'Shorter' }).click()

		await expect.poll(() => bodies.length).toBe(2)
		expect(JSON.stringify(bodies[1])).toContain('Shorter')
		await expect(dock(page)).toContainText('OK, shorter it is.')
		await expect(question).toContainText('Answered: Shorter')
	})

	test('a build reply shows ghost cards; Discard removes them exactly; Apply keeps them; one Ctrl+Z undoes Apply', async ({ page }) => {
		const plan = {
			summary: 'Add two cards',
			add: [
				{ ref: 'n1', type: 'prompt', props: { text: 'from the plan' } },
				{ ref: 'n2', type: 'prompt', props: { text: 'second' } },
			],
			update: [],
			wires: [],
			unwire: [],
			notes: [],
			arrange: 'tidy',
		}
		await mockGenerateText(page, JSON.stringify(plan))
		await mockStream(page, [[{ _type: 'build-workflow', goal: 'two prompt cards' }]])
		const before = await shapeSnapshot(page)
		const count = await nodeCount(page)

		await page.mouse.click(700, 560)
		await page.keyboard.press('Control+k')
		await ask(page, 'add two prompt cards')
		const task = dock(page).locator('.chat-task[data-task-route="build"]').last()
		await expect(task).toHaveAttribute('data-task-status', 'preview')
		await expect(task).toContainText('Add two cards')
		expect(await nodeCount(page)).toBe(count + 2)
		const ghostIds: string[] = await page.evaluate(() =>
			(window as any).editor.getCurrentPageShapes().filter((s: any) => s.type === 'node').map((s: any) => s.id)
		)
		const css = await page.locator('style[data-ai-preview]').textContent()
		for (const id of ghostIds) expect(css).toContain(id)
		const opacity = await nodeLocator(page, ghostIds[0]).evaluate((el) => getComputedStyle(el.closest('.tl-shape')!).opacity)
		expect(Number(opacity)).toBeLessThan(0.9)

		await task.getByText('Discard', { exact: true }).click()
		await expect(task).toHaveAttribute('data-task-status', 'discarded')
		expect(await shapeSnapshot(page)).toBe(before)

		// Again, and Apply this time.
		await page.mouse.click(700, 560)
		await page.keyboard.press('Control+k')
		await ask(page, 'add two prompt cards')
		const second = dock(page).locator('.chat-task[data-task-route="build"]').last()
		await expect(second).toHaveAttribute('data-task-status', 'preview')
		await second.getByText('Apply', { exact: true }).click()
		await expect(second).toHaveAttribute('data-task-status', 'applied')
		await expect(page.locator('style[data-ai-preview]')).toHaveCount(0)
		expect(await nodeCount(page)).toBe(count + 2)
		// Plan rows keep card names after Apply (never raw ids).
		await expect(second).not.toContainText('shape:')

		await page.mouse.click(700, 560)
		await page.keyboard.press('Control+z')
		await expect.poll(() => nodeCount(page)).toBe(count)
		expect(await shapeSnapshot(page)).toBe(before)
	})

	test('a fill-card reply highlights the changed field', async ({ page }) => {
		const id = await createNode(page, { type: 'prompt', text: 'old text' }, { x: 200, y: 300 })
		const simple = id.replace(/^shape:/, '')
		await mockStream(page, [[{ _type: 'fill-card', cardId: simple, request: 'say hello' }]])
		await mockGenerateText(page, JSON.stringify({ say: 'Set the text.', props: { text: 'hello' }, needs: [] }))
		await selectShapes(page, [id])
		await ask(page, 'make this card say hello')

		const task = dock(page).locator('.chat-task[data-task-route="node-assist"]')
		await expect(task).toHaveAttribute('data-task-status', 'preview')
		await expect(task.locator('.chat-task-diffRow')).toContainText('hello')
		expect((await nodeProps<{ text: string }>(page, id)).text).toBe('hello')
		const row = nodeLocator(page, id).locator('[data-field-keys~="text"]')
		await expect(row).toHaveCount(1)
		const css = await page.locator('style[data-ai-preview]').textContent()
		expect(css).toContain(`[data-shape-id="${id}"] [data-field-keys~="text"]`)
		const bg = await row.evaluate((el) => getComputedStyle(el).backgroundColor)
		expect(bg).not.toBe('rgba(0, 0, 0, 0)')

		await task.getByText('Apply', { exact: true }).click()
		await expect(task).toHaveAttribute('data-task-status', 'applied')
		expect((await nodeProps<{ text: string }>(page, id)).text).toBe('hello')
	})

	test('a provider error is shown as readable text', async ({ page }) => {
		await page.route('**/stream', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'text/event-stream',
				body: `data: ${JSON.stringify({ error: { message: 'Rate limit reached for this model' } })}\n\n`,
			})
		)
		await page.mouse.click(700, 560)
		await page.keyboard.press('Control+k')
		await ask(page, 'hi')
		const error = dock(page).locator('.chat-history-error')
		await expect(error).toContainText('Rate limit reached for this model')
		await expect(error).not.toContainText('[object Object]')
	})

	test('Fix on a card error opens the bar prefilled', async ({ page }) => {
		const id = await createNode(page, { type: 'url_in', url: '', fetchBody: false, lastText: null, error: null }, { x: 200, y: 300 })
		await runNode(page, id)
		const banner = nodeLocator(page, id).locator('.UiErrorBanner')
		await expect(banner).toBeVisible()
		await banner.getByTitle('Fix with AI').click()
		await expect(bar(page)).toBeVisible()
		await expect(barInput(page)).toHaveValue(/^Fix this error: /)
		await expect(barInput(page)).toBeFocused()
		await expect(bar(page).locator('.ai-bar-scope')).toHaveText(/^Card: /)
	})
})
