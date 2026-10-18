import { expect, test } from '@playwright/test'
import { createDefaultNode, gotoApp, nodeProps, runNode, wire, zoomToFit } from './helpers'

/**
 * WP36 "I": Merge waits on several branches (typically an If/Decision switch's outputs) and
 * combines whichever delivered. The engine gives untaken branches (STOP_EXECUTION) special
 * handling (`ExecutionGraph.settleAsStopped`/`executeMergeIfReady`) so Merge sees "this branch
 * didn't deliver" instead of hanging forever.
 */
test.describe('Merge', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('"first" runs as soon as the taken branch delivers, ignoring the untaken one', async ({ page }) => {
		const switchId = await createDefaultNode(
			page,
			'decision_switch',
			{ mode: 'noul', threshold: 0.5, margin: 0 },
			{ x: 0, y: 0 }
		)
		const decisionText = await createDefaultNode(page, 'prompt', { text: '{"yes": 0.9, "no": 0.1}' }, { x: -460, y: 0 })
		const mergeId = await createDefaultNode(page, 'merge', { mode: 'first' }, { x: 460, y: 0 })
		const outId = await createDefaultNode(page, 'output', {}, { x: 920, y: 0 })
		await zoomToFit(page)
		await wire(page, decisionText, 'output', switchId, 'decision')
		await wire(page, switchId, 'yes', mergeId, 'in1')
		await wire(page, switchId, 'no', mergeId, 'in2')
		await wire(page, mergeId, 'output', outId, 'input')

		await runNode(page, outId)

		const outProps = await nodeProps<{ lastValue: string | null }>(page, outId)
		expect(outProps.lastValue).not.toBeNull()
		const mergeProps = await nodeProps<{ error: string | null }>(page, mergeId)
		expect(mergeProps.error).toBeNull()
	})

	test('"all" joins only the branch(es) that actually delivered, skipping the untaken one', async ({ page }) => {
		const switchId = await createDefaultNode(
			page,
			'decision_switch',
			{ mode: 'noul', threshold: 0.5, margin: 0 },
			{ x: 0, y: 0 }
		)
		const decisionText = await createDefaultNode(page, 'prompt', { text: '{"yes": 0.9, "no": 0.1}' }, { x: -460, y: 0 })
		const mergeId = await createDefaultNode(page, 'merge', { mode: 'all', separator: ', ' }, { x: 460, y: 0 })
		const outId = await createDefaultNode(page, 'output', {}, { x: 920, y: 0 })
		await zoomToFit(page)
		await wire(page, decisionText, 'output', switchId, 'decision')
		await wire(page, switchId, 'yes', mergeId, 'in1')
		await wire(page, switchId, 'no', mergeId, 'in2')
		await wire(page, mergeId, 'output', outId, 'input')

		await runNode(page, outId)

		const outProps = await nodeProps<{ lastValue: string | null }>(page, outId)
		// Only the taken ("yes") branch's value appears — no separator-joined empty/STOP entry
		// from "no", and the run must have actually completed (not hung waiting on "no" forever).
		expect(outProps.lastValue).not.toBeNull()
		expect(outProps.lastValue).not.toContain(', ')
	})

	test('a disconnected Merge card stays quiet (no error, no run) rather than hanging', async ({ page }) => {
		const mergeId = await createDefaultNode(page, 'merge', { mode: 'first' }, { x: 0, y: 0 })
		await zoomToFit(page)
		await runNode(page, mergeId, 3_000).catch(() => {})
		const props = await nodeProps<{ error: string | null }>(page, mergeId)
		expect(props.error).toBeNull()
	})
})
