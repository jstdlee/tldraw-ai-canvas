import { expect, test } from '@playwright/test'
import { createDefaultNode, getNodeRun, gotoApp, nodeLocator, wire, zoomToFit } from './helpers'

/**
 * FLOW-04: Stop didn't interrupt an in-flight Sleep — it ran to completion and reported "ok" as
 * if nothing happened. `sleep()` now takes the run's AbortSignal (client/pipeline/utils/sleep.ts),
 * and SleepNodeDefinition.execute passes it through.
 */
test.describe('Stop interrupts an in-flight Sleep', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('clicking Stop during a 2s sleep aborts it well before the timeout, status "stopped"', async ({ page }) => {
		const sleepId = await createDefaultNode(page, 'sleep', { ms: 2000 }, { x: 0, y: 0 })
		await zoomToFit(page)

		const button = nodeLocator(page, sleepId).locator('.NodeShape-footer > button').first()
		const started = Date.now()
		await button.click() // starts the run

		// Wait until this card's own run has actually started (status 'running'), then Stop.
		await expect.poll(async () => (await getNodeRun(page, sleepId))?.status).toBe('running')
		await button.click() // Stop (same button, now showing "Stop" per FLOW-06's fix)

		await expect.poll(async () => (await getNodeRun(page, sleepId))?.status, { timeout: 5_000 }).toBe('stopped')
		const elapsed = Date.now() - started
		// Well short of the full 2000ms sleep — this is the whole point of the fix.
		expect(elapsed).toBeLessThan(1500)
	})
})
