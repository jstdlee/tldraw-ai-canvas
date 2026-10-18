import { expect, test } from '@playwright/test'
import { createDefaultNode, gotoApp, nodeProps, selectShapes, wire, zoomToFit } from './helpers'

/**
 * FLOW-05: packing more than a trivial chain used to expose every member's every unconnected
 * settings field as a box port (9 inputs for two Text tools cards) — now only a card's dedicated
 * ports (wired or not) and field ports that are *already* wired from outside the group make the
 * cut (shared/groupPorts.ts). This is the review's exact repro: Prompt → Text tools (trim) →
 * Text tools (count).
 */
test.describe('group as box: field ports only join the box when wired from outside', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('two Text tools cards pack down from 9 inputs to the 3 that matter', async ({ page }) => {
		const promptId = await createDefaultNode(page, 'prompt', { text: 'hello world' }, { x: -400, y: 0 })
		const trimId = await createDefaultNode(page, 'text_tool', { op: 'trim' }, { x: 0, y: 0 })
		const countId = await createDefaultNode(page, 'text_tool', { op: 'count' }, { x: 500, y: 0 })
		await wire(page, promptId, 'output', trimId, 'input')
		await wire(page, trimId, 'output', countId, 'input')
		await zoomToFit(page)

		await selectShapes(page, [trimId, countId])
		await page.keyboard.press('Control+Shift+P')

		await page.waitForFunction(() => {
			const editor = (window as any).editor
			const s = editor.getOnlySelectedShape()
			return s?.type === 'node' && s.props.node?.type === 'subgraph'
		})
		const box = await nodeProps<{
			inputs: { nodeId: string; portId: string }[]
			outputs: { nodeId: string; portId: string }[]
		}>(page, (await page.evaluate(() => (window as any).editor.getOnlySelectedShape().id)) as string)

		expect(box.inputs).toHaveLength(3)
		expect(box.inputs.map((p) => p.portId).sort()).toEqual(['input', 'input2', 'input2'].sort())
		expect(box.inputs.some((p) => p.portId.startsWith('field:'))).toBe(false)
		expect(box.outputs).toHaveLength(1)
	})
})
