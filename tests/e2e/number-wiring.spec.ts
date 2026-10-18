import { expect, test } from '@playwright/test'
import { createDefaultNode, getNodeRun, gotoApp, nodeProps, runNode, wire, zoomToFit } from './helpers'

/**
 * GAPS-11: no visible card could feed a number field — only the hidden legacy Number card or an
 * `any` output could. Text → number is now an allowed wire (`portCompatibility.ts`), coerced at
 * run (`shared/fieldCoerce.ts`, already in place for every `WireField` with `dataType="number"`).
 */
test.describe('text can wire into a number field', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('a Prompt wired into For each "To" drives the loop, not the stored default', async ({ page }) => {
		const forEachId = await createDefaultNode(
			page,
			'for_each',
			{ split: 'range', rangeFrom: 1, rangeStep: 1, rangeTo: 99 }, // 99 is deliberately wrong
			{ x: 460, y: 0 }
		)
		const countId = await createDefaultNode(page, 'prompt', { text: '6' }, { x: 0, y: 0 })
		const bodyId = await createDefaultNode(page, 'if', { condition: 'truthy', operand: '' }, { x: 920, y: 0 })
		await zoomToFit(page)
		await wire(page, countId, 'output', forEachId, 'field:rangeTo')
		await wire(page, forEachId, 'item', bodyId, 'input')
		await wire(page, bodyId, 'then', forEachId, 'result')

		await runNode(page, forEachId)

		const props = await nodeProps<{ progress: string | null; error: string | null }>(page, forEachId)
		expect(props.error).toBeNull()
		expect(props.progress).toBe('6 done')
	})

	test('a non-numeric wired value fails clearly instead of silently running', async ({ page }) => {
		const forEachId = await createDefaultNode(
			page,
			'for_each',
			{ split: 'range', rangeFrom: 1, rangeStep: 1, rangeTo: 10 },
			{ x: 460, y: 0 }
		)
		const textId = await createDefaultNode(page, 'prompt', { text: 'abc' }, { x: 0, y: 0 })
		await zoomToFit(page)
		await wire(page, textId, 'output', forEachId, 'field:rangeTo')

		await runNode(page, forEachId).catch(() => {})

		// The bad value is coerced while applying the wired field override, before the card's
		// own execute() (and so its own node.error) ever runs — the failure surfaces as this
		// run's status/message instead (shared/fieldCoerce.ts's FieldCoerceError).
		const run = await getNodeRun(page, forEachId)
		expect(run?.status).toBe('error')
		expect(run?.message).toMatch(/number/i)
	})
})
