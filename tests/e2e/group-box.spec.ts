import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeProps, selectedShapeId, selectShapes, shapeMeta, wire, zoomToFit } from './helpers'

test.describe('group box (Ctrl/Cmd+Shift+P)', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('packs two chained cards into a box, opens to a group, and closes back to the box', async ({ page }) => {
		// The box thumbnail renders the member cards through editor.toImage, outside tldraw's UI
		// tooltip provider. A TldrawUiTooltip in a card (UiSegmented used one) threw there, so the
		// card came out blank in the thumbnail; the crash only showed as this console error.
		const tooltipErrors: string[] = []
		page.on('console', (msg) => {
			if (msg.type() === 'error' && msg.text().includes('must be used within `TooltipProvider`')) {
				tooltipErrors.push(msg.text())
			}
		})
		// Prompt (outside) -> DataPipe (member, field:with wired) -> Group (member) -> Chart (outside).
		const promptId = await createNode(page, { type: 'prompt', text: 'hello' }, { x: -400, y: 0 })
		const dataPipeId = await createNode(
			page,
			{
				type: 'table',
				text: 'name,city\nSam,Paris\nLin,Oslo\n',
				format: 'auto',
				op: 'filter',
				columns: '',
				column: 'name',
				as: 'starts',
				expr: '',
				sep: ' ',
				pattern: '',
				with: 'S',
				name: '',
				error: null,
				source: 'inline',
			},
			{ x: 0, y: 0 }
		)
		const groupId = await createNode(
			page,
			{
				type: 'table',
				text: '',
				format: 'auto',
				op: 'groupby',
				columns: '*:count',
				column: 'city',
				as: '',
				expr: '',
				sep: ' ',
				pattern: '',
				with: '',
				name: '',
				error: null,
				source: 'input',
			},
			{ x: 500, y: 0 }
		)
		const chartId = await createNode(
			page,
			{ type: 'chart', text: '', format: 'csv', kind: 'bar', xCol: 'city', yCol: 'count', dualScale: false, error: null },
			{ x: 1000, y: 0 }
		)
		await wire(page, promptId, 'output', dataPipeId, 'field:with')
		await wire(page, dataPipeId, 'output', groupId, 'data')
		await wire(page, groupId, 'output', chartId, 'data')
		await zoomToFit(page)

		await selectShapes(page, [dataPipeId, groupId])
		await page.keyboard.press('Control+Shift+P')

		await page.waitForFunction(() => {
			const editor = (window as any).editor
			const s = editor.getOnlySelectedShape()
			return s?.type === 'node' && s.props.node?.type === 'subgraph'
		})
		const boxId = (await selectedShapeId(page))!
		const box = await nodeProps<{
			inputs: { nodeId: string; portId: string }[]
			outputs: { nodeId: string; portId: string }[]
			innerIds: string[]
		}>(page, boxId)
		expect(box.innerIds.sort()).toEqual([dataPipeId, groupId].sort())
		// Every exposed port (WP4's "group as box" rule: any member input not fed by another
		// member becomes a box port) must include the two that actually matter here: the
		// boundary wire in from Prompt, and the boundary wire out to Chart.
		expect(box.inputs.some((p) => p.nodeId === dataPipeId && p.portId === 'field:with')).toBe(true)
		expect(box.outputs.some((p) => p.nodeId === groupId && p.portId === 'output')).toBe(true)
		expect(await shapeMeta(page, dataPipeId)).toMatchObject({ packedIn: boxId })
		expect(await shapeMeta(page, groupId)).toMatchObject({ packedIn: boxId })

		// Expand: members become visible inside a native tldraw group.
		await page.locator(`[data-shape-id="${boxId}"] button`, { hasText: 'Expand' }).click()
		await expect
			.poll(async () => (await shapeMeta(page, dataPipeId)).packedIn)
			.toBe(null)
		expect((await shapeMeta(page, groupId)).packedIn).toBe(null)
		const boxMetaOpen = await shapeMeta(page, boxId)
		expect(typeof boxMetaOpen.boxOpen).toBe('string')

		// Collapse to card: right-click a member (findOpenBoxGroup walks up to its group parent),
		// then the context menu's "Collapse to card" item (was "Close to box").
		await page.locator(`[data-shape-id="${dataPipeId}"]`).click({ button: 'right' })
		await page.getByRole('menuitem', { name: 'Collapse to card' }).click()

		await expect.poll(async () => (await shapeMeta(page, dataPipeId)).packedIn).toBe(boxId)
		expect((await shapeMeta(page, groupId)).packedIn).toBe(boxId)
		const boxMetaClosed = await shapeMeta(page, boxId)
		expect(boxMetaClosed.boxOpen).toBeFalsy()

		expect(tooltipErrors).toEqual([])
	})
})
