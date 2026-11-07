import { expect, Page, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator } from './helpers'

/** Comments: post with the tool, pin stays after reload, shape anchor, context menu, list, old canvas. */

const threads = (page: Page) =>
	page.evaluate(() => {
		const store = (window as any).editor.store
		return store.allRecords().filter((r: any) => r.typeName === 'comment-thread')
	})
const comments = (page: Page) =>
	page.evaluate(() => (window as any).editor.store.allRecords().filter((r: any) => r.typeName === 'comment'))

async function post(page: Page, text: string) {
	const composer = page.locator('.tlui-comment-composer [contenteditable="true"], [class*="composer"] [contenteditable="true"]').first()
	await composer.waitFor()
	await composer.click()
	await page.keyboard.type(text)
	await page.keyboard.press('Control+Enter')
}

async function clearComments(page: Page) {
	await page.evaluate(() => {
		const store = (window as any).editor.store
		store.remove(store.allRecords().filter((r: any) => /^comment/.test(r.typeName)).map((r: any) => r.id))
	})
}

test.describe('comments', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
		await clearComments(page)
	})

	test('C then click posts a comment, and it survives a reload', async ({ page }) => {
		await page.mouse.click(700, 400)
		await page.keyboard.press('c')
		expect(await page.evaluate(() => (window as any).editor.getCurrentToolId())).toBe('comment')
		await page.mouse.click(700, 400)
		await post(page, 'first note')
		await expect.poll(async () => (await comments(page)).length).toBe(1)
		expect((await threads(page))[0].anchor.type).toBe('point')

		await page.waitForTimeout(800) // the local store saves on a throttle
		await page.reload()
		await page.waitForFunction(() => Boolean((window as any).editor))
		await expect.poll(async () => (await comments(page)).length).toBe(1)
	})

	test('clicking a pin opens the thread, and a reply joins it', async ({ page }) => {
		await page.mouse.click(700, 400)
		await page.keyboard.press('c')
		await page.mouse.click(700, 400)
		await post(page, 'needs a reply')
		await expect.poll(async () => (await comments(page)).length).toBe(1)
		await page.keyboard.press('Escape')
		await page.evaluate(() => void (window as any).editor.setCurrentTool('select'))
		await page.mouse.click(1000, 700)
		await page.locator('.tlui-cmt-pin').first().click()
		await expect(page.getByText('needs a reply').first()).toBeVisible()
		await post(page, 'here it is')
		await expect.poll(async () => (await comments(page)).length).toBe(2)
		expect(new Set((await comments(page)).map((c: any) => c.threadId)).size).toBe(1)
	})

	test('a comment on a shape anchors to it', async ({ page }) => {
		await page.evaluate(() => {
			const e = (window as any).editor
			e.setCamera({ x: 0, y: 0, z: 1 })
			e.createShape({ id: 'shape:c1', type: 'geo', x: 600, y: 300, props: { w: 200, h: 150, fill: 'solid' } })
			e.selectNone()
		})
		const at = await page.evaluate(() => (window as any).editor.pageToScreen({ x: 700, y: 375 }))
		await page.keyboard.press('c')
		await page.mouse.click(at.x, at.y)
		await post(page, 'on the box')
		await expect.poll(async () => (await threads(page)).length).toBe(1)
		const anchor = (await threads(page))[0].anchor
		expect(anchor.type).toBe('shape')
		expect(anchor.shapeId).toBe('shape:c1')
	})

	test('a comment on a pipeline card anchors to it', async ({ page }) => {
		await page.evaluate(() => void (window as any).editor.setCamera({ x: 0, y: 0, z: 1 }))
		const id = await createNode(page, { type: 'number', value: 1 } as any, { x: 500, y: 250 })
		const box = (await nodeLocator(page, id).boundingBox())!
		await page.keyboard.press('c')
		await page.mouse.click(box.x + box.width / 2, box.y + 12)
		await post(page, 'on the card')
		await expect.poll(async () => (await threads(page)).length).toBe(1)
		const anchor = (await threads(page))[0].anchor
		expect(anchor.type).toBe('shape')
		expect(anchor.shapeId).toBe(id)
	})

	test('context menu item starts a comment; the main menu opens the list', async ({ page }) => {
		await page.mouse.click(700, 400, { button: 'right' })
		await page.getByRole('menuitem', { name: 'Comment', exact: true }).click()
		await post(page, 'from the menu')
		await expect.poll(async () => (await comments(page)).length).toBe(1)
		await page.keyboard.press('Escape')
		await page.evaluate(() => void (window as any).editor.setCurrentTool('select'))
		await page.getByTestId('main-menu.button').click()
		await page.getByRole('menuitemcheckbox', { name: 'Comments list' }).click()
		await expect(page.getByText('from the menu').first()).toBeVisible()
	})
})
