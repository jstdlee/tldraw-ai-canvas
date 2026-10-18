import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeProps, runNode, wire, zoomToFit } from './helpers'

/**
 * WP35 AI-04/AI-07: Decision switch's Auto mode resolving to Score (not just Choice/Yes-No),
 * and threshold/margin keeping a field-port anchor outside Yes/No mode.
 */
test.describe('AI-04: Decision switch Auto resolves to Score', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('a JEV-shaped score decision (tagged __kind) auto-resolves to Score, not Choice', async ({ page }) => {
		// Stands in for a real JEV score card (no model call needed): the exact JSON shape
		// JevNodeDefinition.execute now emits on its `probs` output — `{...probabilities,
		// __kind: node.kind}` — tagged 'score'.
		const probs = await createNode(page, { type: 'prompt', text: '{"low":0.05,"mid":0.05,"high":0.9,"__kind":"score"}' }, { x: 0, y: 0 })
		const sw = await createNode(
			page,
			{
				type: 'decision_switch',
				mode: 'auto',
				threshold: 0.5,
				margin: 0,
				options: '',
				bands: 'low: 0.33\nmid: 0.66\nhigh',
				lastDecisionJson: null,
				lastOptions: null,
				error: null,
			},
			{ x: 460, y: 0 }
		)
		await wire(page, probs, 'output', sw, 'decision')
		await zoomToFit(page)

		await runNode(page, sw)
		const node = await nodeProps<{ lastDecisionJson: string }>(page, sw)
		const decision = JSON.parse(node.lastDecisionJson)
		expect(decision.resolvedMode).toBe('score')
		expect(decision.chosen).toBe('band:high')
	})
})

test.describe('AI-07: threshold/margin keep a field-port anchor outside Yes/No mode', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('no "[WP17] no field-port anchor" warning for threshold/margin in choice or score mode', async ({ page }) => {
		const warnings: string[] = []
		page.on('console', (msg) => {
			const text = msg.text()
			if (/\[WP17\]/.test(text) && text.includes('no field-port anchor') && /threshold|margin/.test(text)) {
				warnings.push(text)
			}
		})

		for (const mode of ['choice', 'score']) {
			const id = await createNode(
				page,
				{
					type: 'decision_switch',
					mode,
					threshold: 0.5,
					margin: 0,
					options: 'a\nb',
					bands: 'low: 0.33\nmid: 0.66\nhigh',
					lastDecisionJson: null,
					lastOptions: null,
					error: null,
				},
				{ x: 0, y: 0 }
			)
			await zoomToFit(page)
			// The dev warning's own setTimeout is 2000ms (nodeTypes.tsx); give it room to fire
			// either way before moving on.
			await page.waitForTimeout(2200)
			// `editor.deleteShape` returns the editor itself (for chaining) — evaluate's arrow
			// body would otherwise implicitly return it, and Playwright then tries to serialize
			// the whole editor object graph back to Node.
			await page.evaluate((id) => {
				(window as any).editor.deleteShape(id)
			}, id)
		}

		expect(warnings, warnings.join('\n')).toEqual([])
	})
})
