import { expect, test } from '@playwright/test'
import { NODE_SPECS } from '../../shared/nodeSpecs'
import { gotoApp, nodeLocator, nodeProps, zoomToFit } from './helpers'

/**
 * A canvas saved by an older version (v0.2.0) can miss node fields that are now required.
 * Before the node shape migration, tldraw refused the whole canvas on start-up
 * ("props.node(type = chart).dualScale: Expected boolean, got undefined").
 */
test.describe('old canvas migration', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	/** Put node shapes into a snapshot that claims the pre-migration node schema, then load it. */
	async function loadOldSnapshot(page: import('@playwright/test').Page, nodes: Record<string, unknown>[]) {
		return page.evaluate((nodes) => {
			const editor = (window as any).editor
			const pageId = editor.getCurrentPageId()
			const snapshot = editor.getSnapshot()
			const store = snapshot.document.store
			// The node shape had no props migrations before this fix.
			delete snapshot.document.schema.sequences['com.tldraw.shape.node']
			const ids: string[] = []
			const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
			// Valid tldraw index keys: "b" + two base-62 digits (an integer part), one per shape.
			const indexKey = (i: number) => `b${digits[Math.floor((i + 1) / 62)]}${digits[(i + 1) % 62]}`
			nodes.forEach((node, i) => {
				const id = `shape:old-${i}`
				ids.push(id)
				store[id] = {
					id, typeName: 'shape', type: 'node', x: (i % 8) * 420, y: Math.floor(i / 8) * 600, rotation: 0,
					isLocked: false, opacity: 1, parentId: pageId, index: indexKey(i), meta: {},
					props: { node, isOutOfDate: false },
				}
			})
			editor.loadSnapshot(snapshot)
			return ids
		}, nodes)
	}

	test('a v0.2.0 Chart (no dualScale) loads and gets the default', async ({ page }) => {
		const errors: string[] = []
		page.on('pageerror', (e) => errors.push(e.message))
		const [chartId] = await loadOldSnapshot(page, [
			{ type: 'chart', text: 'name,score\nA,1\nB,2', format: 'csv', kind: 'bar', xCol: 'name', yCol: 'score', error: null },
		])
		await zoomToFit(page)
		await expect(nodeLocator(page, chartId)).toBeVisible()
		expect((await nodeProps<{ dualScale: boolean }>(page, chartId)).dualScale).toBe(false)
		expect(errors.filter((m) => m.includes('ValidationError'))).toEqual([])
	})

	test('every card type saved with only its type loads', async ({ page }) => {
		const errors: string[] = []
		page.on('pageerror', (e) => errors.push(e.message))
		const types = Object.keys(NODE_SPECS)
		const ids = await loadOldSnapshot(page, types.map((type) => ({ type })))
		const count = await page.evaluate(
			(ids) => ids.filter((id: string) => (window as any).editor.getShape(id)).length,
			ids
		)
		expect(errors.filter((m) => m.includes('ValidationError'))).toEqual([])
		expect(count).toBe(types.length)
	})
})
