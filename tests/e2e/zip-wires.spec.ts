import { expect, Page, test } from '@playwright/test'
import { createDefaultNode, gotoApp, shapeMeta, wire, zoomToFit } from './helpers'

/**
 * WP43: Zip wires pulls the middles of a messy set of wires / arrows into parallel lanes
 * (10 px apart, no crossings). One Ctrl+Z undoes it; Unzip clears it; wires stay zipped when a
 * card moves (the bundle centre is computed live).
 */

/** Wait until the zip animation has finished (no animated wires, no slider pill). */
async function waitZipIdle(page: Page) {
	const deadline = Date.now() + 5_000
	for (;;) {
		const idle = await page.evaluate(async () => {
			// @ts-expect-error dynamic import of an app source file, only resolvable by the dev server
			const mod = await import('/client/pipeline/connection/zipWires.ts')
			return Object.keys(mod.$zipAnim.get()).length === 0 && mod.$zipSliders.get().length === 0
		})
		if (idle) return
		if (Date.now() > deadline) throw new Error('zip animation did not finish')
		await page.waitForTimeout(50)
	}
}

/** For each wire: its middle (the + handle point) and its zip offset, projected on the live bundle normal. */
async function wireMiddles(page: Page, ids: string[]) {
	return page.evaluate(async (ids: string[]) => {
		const editor = (window as any).editor
		// @ts-expect-error dynamic import of an app source file, only resolvable by the dev server
		const zip = await import('/client/pipeline/connection/zipWires.ts')
		// @ts-expect-error dynamic import of an app source file, only resolvable by the dev server
		const util = await import('/client/pipeline/connection/ConnectionShapeUtil.tsx')
		// @ts-expect-error dynamic import of an app source file, only resolvable by the dev server
		const shared = await import('/shared/zipWires.ts')
		const shapes = ids.map((id) => editor.getShape(id))
		const frame = shared.zipBundleFrame(shapes.map((s: any) => zip.getConnectionPageTerminals(editor, s)))
		return shapes.map((s: any) => {
			const middle = util.getConnectionPageCenter(editor, s)
			return {
				id: s.id as string,
				offset: (s.meta?.zip?.offset ?? null) as number | null,
				side: middle.x * frame.normal.x + middle.y * frame.normal.y,
			}
		})
	}, ids)
}

function expectZipped(middles: { offset: number | null; side: number }[]) {
	expect(middles.every((m) => typeof m.offset === 'number')).toBe(true)
	const byLane = [...middles].sort((a, b) => a.offset! - b.offset!)
	expect(byLane.map((m) => m.offset)).toEqual([-10, 0, 10])
	// The middles' order along the normal matches the lane order (no crossing in the middle),
	// and neighbours are 10 ± 1 px apart.
	for (let i = 1; i < byLane.length; i++) {
		const gap = byLane[i].side - byLane[i - 1].side
		expect(gap).toBeGreaterThan(9)
		expect(gap).toBeLessThan(11)
	}
}

test.describe('zip wires', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('zips crossing wires into lanes, undo, unzip, and follows a card move', async ({ page }) => {
		const left = [
			await createDefaultNode(page, 'prompt', { text: 'a' }, { x: 0, y: 0 }),
			await createDefaultNode(page, 'prompt', { text: 'b' }, { x: 0, y: 260 }),
			await createDefaultNode(page, 'prompt', { text: 'c' }, { x: 0, y: 520 }),
		]
		const right = [
			await createDefaultNode(page, 'if', { condition: 'truthy', operand: '' }, { x: 1700, y: 0 }),
			await createDefaultNode(page, 'if', { condition: 'truthy', operand: '' }, { x: 1700, y: 260 }),
			await createDefaultNode(page, 'if', { condition: 'truthy', operand: '' }, { x: 1700, y: 520 }),
		]
		// Crossing wires: a → 2nd, b → 3rd, c → 1st.
		const wires = [
			await wire(page, left[0], 'output', right[1], 'input'),
			await wire(page, left[1], 'output', right[2], 'input'),
			await wire(page, left[2], 'output', right[0], 'input'),
		]
		await zoomToFit(page)

		await page.evaluate(() => {
			const editor = (window as any).editor
			editor.focus()
			editor.selectAll()
		})
		await page.keyboard.press('Alt+z')
		await waitZipIdle(page)
		expectZipped(await wireMiddles(page, wires))

		// One Ctrl+Z undoes the whole zip.
		await page.keyboard.press('Control+z')
		for (const id of wires) expect((await shapeMeta(page, id)).zip ?? null).toBeNull()

		// Redo, then Unzip from the context menu (right-click inside the selection, on empty canvas).
		await page.keyboard.press('Control+Shift+z')
		for (const id of wires) expect((await shapeMeta(page, id)).zip).toBeTruthy()
		const spot = await page.evaluate(() => {
			const editor = (window as any).editor
			const bounds = editor.getSelectionPageBounds()
			return editor.pageToViewport({ x: bounds.center.x, y: bounds.minY + 10 })
		})
		const canvas = await page.locator('.tl-canvas').boundingBox()
		await page.mouse.click(canvas!.x + spot.x, canvas!.y + spot.y, { button: 'right' })
		await expect(page.getByTestId('context-menu.zip-wires')).toBeVisible()
		await page.getByTestId('context-menu.unzip-wires').click()
		await waitZipIdle(page)
		for (const id of wires) expect((await shapeMeta(page, id)).zip ?? null).toBeNull()

		// Zip again, then move a card: the lanes are recomputed and stay together.
		await page.evaluate(() => {
			const editor = (window as any).editor
			editor.focus()
			editor.selectAll()
		})
		await page.keyboard.press('Alt+z')
		await waitZipIdle(page)
		await page.evaluate((id: string) => {
			const editor = (window as any).editor
			const shape = editor.getShape(id)
			editor.updateShape({ id, type: 'node', y: shape.y + 80 })
		}, left[0])
		expectZipped(await wireMiddles(page, wires))
	})

	test('zips two crossing arc arrows: middles land on their lane points', async ({ page }) => {
		// a crosses b. Their middles are 30 px apart sideways, so each needs a bend of about 10:
		// tldraw draws |bend| < 8 as a straight arrow.
		const ids = await page.evaluate(() => {
			const editor = (window as any).editor
			const a = `shape:${crypto.randomUUID()}`
			const b = `shape:${crypto.randomUUID()}`
			editor.createShape({ id: a, type: 'arrow', x: 100, y: 100, props: { start: { x: 0, y: 0 }, end: { x: 600, y: 140 } } })
			editor.createShape({ id: b, type: 'arrow', x: 100, y: 100, props: { start: { x: 0, y: 40 }, end: { x: 600, y: 40 } } })
			editor.focus()
			editor.select(a, b)
			return [a, b]
		})
		await zoomToFit(page)
		await page.keyboard.press('Alt+z')
		await waitZipIdle(page)

		const result = await page.evaluate(async (ids: string[]) => {
			const editor = (window as any).editor
			// @ts-expect-error dynamic import of an app source file, only resolvable by the dev server
			const zip = await import('/client/pipeline/connection/zipWires.ts')
			// @ts-expect-error dynamic import of an app source file, only resolvable by the dev server
			const shared = await import('/shared/zipWires.ts')
			const lines = ids.map((id) => {
				const s = editor.getShape(id)
				return { id, start: { x: s.x + s.props.start.x, y: s.y + s.props.start.y }, end: { x: s.x + s.props.end.x, y: s.y + s.props.end.y } }
			})
			const [bundle] = shared.computeZipBundles(lines)
			return lines.map((line) => {
				const s = editor.getShape(line.id)
				const lane = shared.zipLanePoint(line, bundle.centre, bundle.axis, bundle.lanes[line.id])
				const middle = zip.arrowMiddlePage(editor, line.id)
				return {
					zip: s.meta.zip,
					bend: s.props.bend,
					expectedOffset: bundle.lanes[line.id],
					distance: Math.hypot(middle.x - lane.x, middle.y - lane.y),
					// How far the middle is off the lane line, sideways.
					sideways: Math.abs((middle.x - lane.x) * bundle.normal.x + (middle.y - lane.y) * bundle.normal.y),
				}
			})
		}, ids)
		for (const r of result) {
			expect(r.zip.offset).toBe(r.expectedOffset)
			expect(r.zip.bend).toBe(0)
			expect(r.bend).not.toBe(0)
			expect(r.distance).toBeLessThan(2)
			expect(r.sideways).toBeLessThan(0.5)
		}

		const bends = () =>
			page.evaluate((ids: string[]) => ids.map((id) => (window as any).editor.getShape(id).props.bend), ids)
		// One Ctrl+Z restores the old bend.
		await page.keyboard.press('Control+z')
		expect(await bends()).toEqual([0, 0])
		// Redo, then Unzip restores it too and clears meta.zip.
		await page.keyboard.press('Control+Shift+z')
		expect((await bends()).every((b) => b !== 0)).toBe(true)
		await page.evaluate(async () => {
			// @ts-expect-error dynamic import of an app source file, only resolvable by the dev server
			const zip = await import('/client/pipeline/connection/zipWires.ts')
			zip.unzipWires((window as any).editor, () => {})
		})
		await waitZipIdle(page)
		expect(await bends()).toEqual([0, 0])
		for (const id of ids) expect((await shapeMeta(page, id)).zip ?? null).toBeNull()
	})
})
