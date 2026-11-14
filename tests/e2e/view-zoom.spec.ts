import { expect, Page, test } from '@playwright/test'
import { clickEmptyCanvas, createNode, gotoApp, insertFromPalette, selectedShapeId, selectShapes, shapeProps } from './helpers'

/**
 * WP46: auto center on load and on resize, fit rules (Shift+1 / Shift+2), zoom steps, pan after a
 * big insert, default font sizes. Reduced motion is on, so camera moves are instant.
 */
test.use({ reducedMotion: 'reduce' })

const ZOOMS_IN = [1.25, 1.5, 2, 3, 4, 8, 8]

/** The part of the canvas no UI covers: below the top menus, above the bottom toolbar. */
async function freeArea(page: Page) {
	return page.evaluate(() => {
		const canvas = document.querySelector('.app-canvas')!.getBoundingClientRect()
		const top = Math.max(
			...[...document.querySelectorAll('.tlui-menu-zone, .app-panel-toggles')].map((e) => e.getBoundingClientRect().bottom)
		)
		const bottom = document.querySelector('.tlui-layout__bottom')!.getBoundingClientRect().top
		return { left: canvas.left, right: canvas.right, top, bottom }
	})
}

/** Screen rectangles (client px) of shapes, from the editor's page bounds and camera. */
async function screenRects(page: Page, ids: string[]) {
	return page.evaluate((ids: string[]) => {
		const editor = (window as any).editor
		return ids.map((id) => {
			const b = editor.getShapePageBounds(id)
			const tl = editor.pageToScreen({ x: b.minX, y: b.minY })
			const br = editor.pageToScreen({ x: b.maxX, y: b.maxY })
			return { left: tl.x, top: tl.y, right: br.x, bottom: br.y }
		})
	}, ids)
}

async function expectInside(page: Page, ids: string[]) {
	const area = await freeArea(page)
	for (const r of await screenRects(page, ids)) {
		expect(r.left).toBeGreaterThanOrEqual(area.left - 1)
		expect(r.right).toBeLessThanOrEqual(area.right + 1)
		expect(r.top).toBeGreaterThanOrEqual(area.top - 1)
		expect(r.bottom).toBeLessThanOrEqual(area.bottom + 1)
	}
}

const zoom = (page: Page) => page.evaluate(() => (window as any).editor.getZoomLevel() as number)
const viewCenter = (page: Page) =>
	page.evaluate(() => {
		const c = (window as any).editor.getViewportPageBounds().center
		return { x: c.x as number, y: c.y as number }
	})

/** Wait until the canvas is saved in the browser, reload, and wait for the editor. */
async function reload(page: Page) {
	await page.waitForTimeout(1500)
	await page.reload()
	await page.waitForFunction(() => Boolean((window as any).editor))
	await page.waitForTimeout(300)
}

test.describe('WP46: view, zoom and fonts', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('on load all content is in view, at most 100 %, clear of the toolbar and menus', async ({ page }) => {
		const ids = [
			await createNode(page, { type: 'prompt', text: 'far left' }, { x: -2600, y: -900 }),
			await createNode(page, { type: 'prompt', text: 'far right' }, { x: 3200, y: 1400 }),
		]
		await reload(page)
		expect(await zoom(page)).toBeLessThan(1)
		await expectInside(page, ids)
	})

	test('on load a small canvas stays at 100 % (no jump to 800 %)', async ({ page }) => {
		const id = await createNode(page, { type: 'prompt', text: 'small' }, { x: 4000, y: 4000 })
		await reload(page)
		expect(await zoom(page)).toBeCloseTo(1, 5)
		await expectInside(page, [id])
	})

	test('opening the agent dock and the node library keeps the center point', async ({ page }) => {
		await createNode(page, { type: 'prompt', text: 'center' }, { x: 0, y: 0 })
		const before = await viewCenter(page)
		await page.locator('.agent-dock-button').click()
		await expect(page.locator('aside.agent-dock.is-open')).toBeVisible()
		await page.waitForTimeout(500) // the dock's width transition + tldraw's throttled resize
		const withDock = await viewCenter(page)
		expect(Math.abs(withDock.x - before.x)).toBeLessThan(2)
		expect(Math.abs(withDock.y - before.y)).toBeLessThan(2)

		await clickEmptyCanvas(page, 420, 620)
		await page.keyboard.press('Shift+N') // hide the node library
		await page.waitForTimeout(500)
		await expect(page.locator('.app-layout.is-library-hidden')).toHaveCount(1)
		const noLibrary = await viewCenter(page)
		expect(Math.abs(noLibrary.x - before.x)).toBeLessThan(2)
		expect(Math.abs(noLibrary.y - before.y)).toBeLessThan(2)
	})

	test('Ctrl+= and Ctrl+- step through the zoom steps; the zoom menu lists 100 %, Fit all, Fit selection', async ({ page }) => {
		await clickEmptyCanvas(page)
		await page.evaluate(() => (window as any).editor.setCamera({ x: 0, y: 0, z: 1 }))
		for (const expected of ZOOMS_IN) {
			await page.keyboard.press('Control+Equal')
			await expect.poll(() => zoom(page)).toBeCloseTo(expected, 5)
		}
		for (const expected of [4, 3, 2, 1.5, 1.25, 1, 0.75, 0.5, 0.25, 0.1, 0.05, 0.05]) {
			await page.keyboard.press('Control+Minus')
			await expect.poll(() => zoom(page)).toBeCloseTo(expected, 5)
		}

		await page.getByTestId('minimap.zoom-menu-button').click()
		const menu = page.locator('.tlui-menu')
		await expect(menu.getByText('Zoom to 100%')).toBeVisible()
		await expect(menu.getByText('Fit all')).toBeVisible()
		await expect(menu.getByText('Fit selection')).toBeVisible()
	})

	test('keyboard zoom zooms toward the pointer when it is over the canvas', async ({ page }) => {
		await clickEmptyCanvas(page, 500, 300)
		await page.evaluate(() => (window as any).editor.setCamera({ x: 0, y: 0, z: 1 }))
		await page.mouse.move(500, 300)
		const pagePoint = () =>
			page.evaluate(() => {
				const p = (window as any).editor.screenToPage({ x: 500, y: 300 })
				return { x: p.x as number, y: p.y as number }
			})
		const before = await pagePoint()
		await page.keyboard.press('Control+Equal')
		await expect.poll(() => zoom(page)).toBeCloseTo(1.25, 5)
		const after = await pagePoint()
		expect(Math.abs(after.x - before.x)).toBeLessThan(1)
		expect(Math.abs(after.y - before.y)).toBeLessThan(1)
	})

	test('Shift+double-click on empty canvas zooms in one step at that point', async ({ page }) => {
		await clickEmptyCanvas(page, 600, 400)
		await page.evaluate(() => (window as any).editor.setCamera({ x: 0, y: 0, z: 1 }))
		const count = await page.evaluate(() => (window as any).editor.getCurrentPageShapeIds().size)
		await page.keyboard.down('Shift')
		await page.mouse.dblclick(600, 400)
		await page.keyboard.up('Shift')
		await expect.poll(() => zoom(page)).toBeCloseTo(1.25, 5)
		// No text shape is created by the double-click.
		expect(await page.evaluate(() => (window as any).editor.getCurrentPageShapeIds().size)).toBe(count)
	})

	test('Shift+2 fits the selection and Shift+1 fits all, with the padding rules', async ({ page }) => {
		const a = await createNode(page, { type: 'prompt', text: 'a' }, { x: -3000, y: -2000 })
		const b = await createNode(page, { type: 'prompt', text: 'b' }, { x: 2500, y: 1800 })
		await clickEmptyCanvas(page)
		await selectShapes(page, [b])
		await page.keyboard.press('Shift+2')
		await expectInside(page, [b])
		expect(await zoom(page)).toBeLessThanOrEqual(1)
		const [rb] = await screenRects(page, [b])
		const area = await freeArea(page)
		expect(Math.abs((rb.left + rb.right) / 2 - (area.left + area.right) / 2)).toBeLessThan(3)

		await page.keyboard.press('Shift+1')
		await expectInside(page, [a, b])
	})

	test('a new text shape and a new card get the default font sizes', async ({ page }) => {
		await clickEmptyCanvas(page)
		await page.keyboard.press('/')
		await insertFromPalette(page, 'pivt')
		const cardId = (await selectedShapeId(page))!
		expect((await shapeProps<{ fontSize: number }>(page, cardId)).fontSize).toBe(16)
		const cardFont = await page.evaluate((id: string) => {
			const el = document.querySelector(`[data-shape-id="${id}"] .NodeShape`)!
			return getComputedStyle(el).fontSize
		}, cardId)
		expect(cardFont).toBe('16px')

		await page.evaluate(() => (window as any).editor.selectNone())
		await page.keyboard.press('t')
		await page.mouse.click(400, 250)
		await page.keyboard.type('Hello')
		await page.keyboard.press('Escape')
		const textId = await page.evaluate(() => {
			const editor = (window as any).editor
			return [...editor.getCurrentPageShapeIds()].find((id: string) => editor.getShape(id).type === 'text') as string
		})
		expect(textId).toBeTruthy()
		expect((await shapeProps<{ size: string }>(page, textId)).size).toBe('s')
		const textFont = await page.evaluate((id: string) => {
			const el = document.querySelector(`[data-shape-id="${id}"] .tl-rich-text`)!
			return getComputedStyle(el).fontSize
		}, textId)
		expect(textFont).toBe('18px')
	})

	test('inserting an example far away pans it into view without zooming', async ({ page }) => {
		await page.evaluate(() => (window as any).editor.setCamera({ x: 0, y: 0, z: 0.75 }))
		await page.waitForFunction(() => Boolean((window as any).loadExample && (window as any).canvasExamples))
		const ids: string[] = await page.evaluate(() => {
			const editor = (window as any).editor
			const before = new Set(editor.getCurrentPageShapeIds())
			;(window as any).loadExample(editor, (window as any).canvasExamples[0], { x: 9000, y: 7000 })
			return [...editor.getCurrentPageShapeIds()].filter(
				(id) => !before.has(id) && editor.getShape(id).type === 'node'
			) as string[]
		})
		expect(ids.length).toBeGreaterThan(0)
		expect(await zoom(page)).toBeCloseTo(0.75, 5)
		// The example's top-left card is in view (an example larger than the view shows its start).
		const area = await freeArea(page)
		const rects = await screenRects(page, ids)
		const left = Math.min(...rects.map((r) => r.left))
		const top = Math.min(...rects.map((r) => r.top))
		expect(left).toBeGreaterThanOrEqual(area.left - 1)
		expect(left).toBeLessThan(area.right)
		expect(top).toBeGreaterThanOrEqual(area.top - 1)
		expect(top).toBeLessThan(area.bottom)
	})
})
