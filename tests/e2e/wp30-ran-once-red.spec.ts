import { expect, test } from '@playwright/test'
import { createNode, gotoApp, getNodeRun, nodeLocator, nodeProps, runNode, shapeProps, unwire, wire, zoomToFit } from './helpers'

/**
 * WP30: a Network tools (net_tool) card that runs fine once must not turn red on a second
 * run, wired or not — and wiring a card's output into another card's *field port* (e.g.
 * Output's "Show as" selector) must show a normal, recoverable run error, not crash the
 * downstream card's whole component (see nodeTypes.tsx's `getNodeOutputInfo`).
 */

test.describe('WP30: ran once then red', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('net_tool subnet runs twice, unwired: no error state both times', async ({ page }) => {
		const netId = await createNode(
			page,
			{ type: 'net_tool', tool: 'subnet', target: '192.168.1.10/24', option: '', lastOutput: null, lastMs: null, error: null },
			{ x: 0, y: 0 }
		)
		await zoomToFit(page)

		await runNode(page, netId)
		let net = await nodeProps<{ error: string | null; lastOutput: string | null }>(page, netId)
		let run = await getNodeRun(page, netId)
		expect(net.error).toBeNull()
		expect(run?.status).toBe('ok')
		expect(net.lastOutput).toMatch(/Network/)
		expect(net.lastOutput).toMatch(/Broadcast/)
		expect(net.lastOutput).toMatch(/Hosts/)

		// Second run (cache hit): still fine.
		await runNode(page, netId)
		net = await nodeProps<{ error: string | null; lastOutput: string | null }>(page, netId)
		run = await getNodeRun(page, netId)
		expect(net.error).toBeNull()
		expect(run?.status).toBe('ok')
	})

	test('net_tool wired to an Output card: both stay green across two runs', async ({ page }) => {
		const netId = await createNode(
			page,
			{ type: 'net_tool', tool: 'subnet', target: '192.168.1.10/24', option: '', lastOutput: null, lastMs: null, error: null },
			{ x: 0, y: 0 }
		)
		const outputId = await createNode(page, { type: 'output', kind: 'auto', lastValue: null }, { x: 500, y: 0 })
		await wire(page, netId, 'output', outputId, 'input')
		await zoomToFit(page)

		await runNode(page, netId)
		await runNode(page, netId)

		const netRun = await getNodeRun(page, netId)
		const outRun = await getNodeRun(page, outputId)
		expect(netRun?.status).toBe('ok')
		expect(outRun?.status).toBe('ok')

		const out = await nodeProps<{ lastValue: string | null }>(page, outputId)
		expect(out.lastValue).toMatch(/Network/)
	})

	test('wiring a value into a card\'s enum field port shows a recoverable run error, not a crash', async ({ page }) => {
		const netId = await createNode(
			page,
			{ type: 'net_tool', tool: 'subnet', target: '192.168.1.10/24', option: '', lastOutput: null, lastMs: null, error: null },
			{ x: 0, y: 0 }
		)
		const outputId = await createNode(page, { type: 'output', kind: 'auto', lastValue: null }, { x: 500, y: 0 })
		// Wired to the "Show as" field port (an enum), not the "Value" input port — e.g. a
		// misaimed drag between the two closely-spaced ports on the Output card.
		const connectionId = await wire(page, netId, 'output', outputId, 'field:kind')
		await zoomToFit(page)

		await runNode(page, netId)
		// WP27: net_tool's card can grow after running (and its Target field now wraps/grows
		// too), so the one-time zoomToFit above can go stale — re-fit before this plain
		// assertion (runNode's own re-fit only covers its own click, not this check).
		await zoomToFit(page)

		// The Output card's own component must not have crashed: its Run button still exists.
		const runButton = page.locator(`[data-shape-id="${outputId}"] .NodeShape-footer > button`).first()
		await expect(runButton).toBeVisible()

		await runNode(page, outputId)
		const outRun = await getNodeRun(page, outputId)
		expect(outRun?.status).toBe('error')
		expect(outRun?.message ?? '').toMatch(/Show as/)

		// Removing the bad wire recovers the card completely.
		await unwire(page, connectionId)
		await runNode(page, outputId)
		const recoveredRun = await getNodeRun(page, outputId)
		expect(recoveredRun?.status).toBe('ok')
	})

	test('switching Tool via the real select and typing a new Target keeps the Output card fresh', async ({ page }) => {
		// Mirrors the "This machine" example (shared/examples.ts net-probe): net_tool starts as
		// my_ips with an empty target, wired to an Output card. A real user switches the Tool
		// select and types a target with the keyboard — not a scripted editor.updateShape that
		// skips the isOutOfDate flag every real field editor sets.
		const netId = await createNode(
			page,
			{ type: 'net_tool', tool: 'my_ips', target: '', option: '', lastOutput: null, lastMs: null, error: null },
			{ x: 0, y: 0 }
		)
		const outputId = await createNode(page, { type: 'output', kind: 'auto', lastValue: null }, { x: 500, y: 0 })
		await wire(page, netId, 'output', outputId, 'input')
		await zoomToFit(page)

		await runNode(page, netId)
		const afterMyIps = await nodeProps<{ lastOutput: string | null }>(page, netId)
		expect(afterMyIps.lastOutput).toMatch(/Host name/)

		// Real click on the Tool select, real click on "Subnet calculator".
		const netCard = nodeLocator(page, netId)
		await netCard.locator('.UiSelect-trigger').first().click()
		await page.locator('.UiSelect-item', { hasText: 'Subnet calculator' }).click()

		// Real keyboard input into the now-visible Target field. WP27 Part B: Network target
		// wraps/grows (a UiGrowingInput textarea, not a plain <input>) so long values don't
		// just cut off — same placeholder, different tag.
		const targetInput = netCard.locator('textarea[placeholder="192.168.1.10/24"]')
		await targetInput.click()
		await targetInput.fill('192.168.1.10/24')

		await runNode(page, netId)
		const net = await nodeProps<{ tool: string; target: string; lastOutput: string | null }>(page, netId)
		expect(net.tool).toBe('subnet')
		expect(net.lastOutput).toMatch(/Broadcast/)
		expect(net.lastOutput).not.toMatch(/Host name/)

		const out = await nodeProps<{ lastValue: string | null }>(page, outputId)
		expect(out.lastValue).toMatch(/Broadcast/)
		expect(out.lastValue).not.toMatch(/Host name/)
		expect(await getNodeRun(page, netId)).toMatchObject({ status: 'ok' })
		expect(await getNodeRun(page, outputId)).toMatchObject({ status: 'ok' })

		// Running both again (cache hit) must not revert to the stale my_ips value.
		await runNode(page, netId)
		await runNode(page, outputId)
		const net2 = await nodeProps<{ lastOutput: string | null }>(page, netId)
		const out2 = await nodeProps<{ lastValue: string | null }>(page, outputId)
		expect(net2.lastOutput).toMatch(/Broadcast/)
		expect(out2.lastValue).toMatch(/Broadcast/)
	})

	test('an unwired card\'s spilled output label lands in free space, not on a neighbouring card', async ({ page }) => {
		const netId = await createNode(
			page,
			{ type: 'net_tool', tool: 'subnet', target: '192.168.1.10/24', option: '', lastOutput: null, lastMs: null, error: null },
			{ x: 0, y: 0 }
		)
		// A Prompt card sitting right where the naive fixed-offset label used to land.
		const promptId = await createNode(page, { type: 'prompt', text: 'a photo of a cat' }, { x: 400, y: 10 })
		await zoomToFit(page)

		await runNode(page, netId)

		const net = await shapeProps<{ spillIds?: string[] }>(page, netId)
		const spillId = net.spillIds?.[0]
		expect(spillId).toBeTruthy()

		const [labelBounds, promptBounds] = await Promise.all([
			page.evaluate((id) => (window as any).editor.getShapePageBounds(id), spillId),
			page.evaluate((id) => (window as any).editor.getShapePageBounds(id), promptId),
		])
		expect(labelBounds).toBeTruthy()
		expect(promptBounds).toBeTruthy()
		const overlaps =
			labelBounds.minX < promptBounds.maxX &&
			labelBounds.maxX > promptBounds.minX &&
			labelBounds.minY < promptBounds.maxY &&
			labelBounds.maxY > promptBounds.minY
		expect(overlaps).toBe(false)
	})

	test('other source cards (no upstream input) run twice, unwired, without error', async ({ page }) => {
		const cards: { node: Record<string, unknown>; errorKey?: string }[] = [
			{ node: { type: 'number', value: 50 } },
			{ node: { type: 'random', mode: 'number', a: '1', b: '100', list: 'red\ngreen\nblue', lastValue: null } },
			{ node: { type: 'prompt', text: 'a photo of a cat sitting on a windowsill' } },
		]
		for (const { node } of cards) {
			const id = await createNode(page, node, { x: 0, y: 0 })
			await zoomToFit(page)
			await runNode(page, id)
			let run = await getNodeRun(page, id)
			expect(run?.status, `${node.type} first run`).not.toBe('error')
			await runNode(page, id)
			run = await getNodeRun(page, id)
			expect(run?.status, `${node.type} second run`).not.toBe('error')
		}
	})
})
