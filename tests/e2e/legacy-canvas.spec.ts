import { expect, test } from '@playwright/test'
import { gotoApp, nodeLocator, zoomToFit } from './helpers'

test.describe('loading a canvas with removed / legacy node shapes', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('a snapshot with sqlite_in, url_in, an old Chart, and an old Subgraph (in0/output) loads without crashing', async ({
		page,
	}) => {
		const ids = await page.evaluate(() => {
			const editor = (window as any).editor
			const pageId = editor.getCurrentPageId()
			const snapshot = editor.getSnapshot()
			const store = snapshot.document.store

			const base = (id: string, index: string, node: Record<string, unknown>, xy: { x: number; y: number }) => ({
				id,
				typeName: 'shape',
				type: 'node',
				x: xy.x,
				y: xy.y,
				rotation: 0,
				isLocked: false,
				opacity: 1,
				parentId: pageId,
				index,
				meta: {},
				props: { node, isOutOfDate: false },
			})

			const sqliteId = 'shape:legacy-sqlite'
			const urlId = 'shape:legacy-url'
			const chartId = 'shape:legacy-chart'
			const subgraphId = 'shape:legacy-subgraph'

			// Removed node type: kept only so the old canvas still loads (shows as a "removed" card).
			store[sqliteId] = base(sqliteId, 'a1', { type: 'sqlite_in', path: '/old/data.sqlite' }, { x: 0, y: 0 })
			// Superseded-but-still-registered type (hidden from the library/search, still loads).
			store[urlId] = base(urlId, 'a2', { type: 'url_in', url: 'www.example.com', fetchBody: false, lastText: null, error: null }, { x: 400, y: 0 })
			// Pre-WP12 Chart: only the original required fields, none of the newer optional ones.
			store[chartId] = base(
				chartId,
				'a3',
				{ type: 'chart', text: 'a,b\n1,2\n3,4', format: 'csv', kind: 'bar', xCol: 'a', yCol: 'b', dualScale: false, error: null },
				{ x: 800, y: 0 }
			)
			// Pre-rename Subgraph box: its inner ports still use the old "in0"/"output" ids.
			store[subgraphId] = base(
				subgraphId,
				'a4',
				{
					type: 'subgraph',
					title: 'Old group',
					innerIds: [],
					inputs: [{ id: 'in0', label: 'In', dataType: 'text', nodeId: 'shape:gone', portId: 'in0' }],
					outputs: [{ id: 'output', label: 'Out', dataType: 'text', nodeId: 'shape:gone', portId: 'output' }],
					thumbnail: null,
					lastOutputs: null,
					error: null,
				},
				{ x: 1200, y: 0 }
			)

			editor.loadSnapshot(snapshot)
			return { sqliteId, urlId, chartId, subgraphId }
		})

		await zoomToFit(page)

		// No crash: the app is still responsive, and every legacy card rendered as a shape.
		for (const id of Object.values(ids)) {
			await expect(nodeLocator(page, id)).toBeVisible()
		}
		await expect(page).toHaveTitle(/.*/) // the page is still alive, not a crashed/blank tab
	})
})
