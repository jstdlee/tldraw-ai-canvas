import { expect, test } from '@playwright/test'
import { createDefaultNode, gotoApp, nodeLocator, wire, zoomToFit } from './helpers'

/**
 * FLOW-06: clicking Run on a card that's part of the run but waiting on an upstream card (not
 * yet executing itself) showed no feedback at all — its own footer button reverted to the idle
 * "Run" label almost immediately. The button's busy state now also covers "waiting in the
 * current run" (NodeShapeUtil.tsx's `isPendingInRun`/`isBusy`), not just "currently executing".
 */
test.describe('a card waiting on upstream work shows a busy state on its own button', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('clicking Run on the downstream Sleep shows "Stop"/busy while the upstream one runs', async ({ page }) => {
		const firstId = await createDefaultNode(page, 'sleep', { ms: 1500 }, { x: 0, y: 0 })
		const secondId = await createDefaultNode(page, 'sleep', { ms: 200 }, { x: 460, y: 0 })
		await zoomToFit(page)
		await wire(page, firstId, 'output', secondId, 'input')

		const secondButton = nodeLocator(page, secondId).locator('.NodeShape-footer > button').first()
		await secondButton.click() // the second Sleep is stale (never run) so the first runs first

		// While the first Sleep is still running (well inside its 1500ms), the SECOND card's own
		// button — the one actually clicked — must show the busy class, not "Run".
		await expect(secondButton).toHaveClass(/NodeRunButton_busy/)
		await expect(secondButton).toContainText('Stop')
	})
})
