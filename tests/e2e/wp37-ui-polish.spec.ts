import { expect, Page, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator, zoomToFit } from './helpers'

/**
 * WP37 UI polish regression tests (docs/rework/WP37-ui-polish.md, docs/review/2026-10-18/ui.md).
 */

/** Create a card from its type's own `getDefault()`, the same way the review specs and the
 * on-canvas picker do — avoids hand-listing every field of a node type here. */
async function createDefault(page: Page, type: string, x = 0, y = 0): Promise<string> {
	return page.evaluate(
		async ({ type, x, y }) => {
			const editor = (window as any).editor
			// @ts-expect-error dynamic import of an app source file, only resolvable by the dev
			// server — same trick tests/e2e/helpers.ts uses elsewhere.
			const { getNodeDefinition } = await import('/client/pipeline/nodes/definitionStore.ts')
			const node = getNodeDefinition(editor, type).getDefault()
			const shapeId = `shape:${crypto.randomUUID()}`
			editor.createShape({ id: shapeId, type: 'node', x, y, props: { node, fontSize: 16 } })
			return shapeId
		},
		{ type, x, y }
	)
}

/** Every `.NodePortLabel` under a card, with enough layout info to tell a wrap from a clip. */
async function portLabels(page: Page, shapeId: string) {
	return page.evaluate((shapeId) => {
		const card = document.querySelector(`[data-shape-id="${shapeId}"]`)!
		return [...card.querySelectorAll<HTMLElement>('.NodePortLabel')].map((el) => ({
			text: el.textContent ?? '',
			scrollHeight: el.scrollHeight,
			clientHeight: el.clientHeight,
		}))
	}, shapeId)
}

test.describe('WP37 UI polish', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('UI-04: JEV and Generate image never truncate a short port label', async ({ page }) => {
		const jevId = await createDefault(page, 'jev')
		await zoomToFit(page)
		const jevLabels = await portLabels(page, jevId)
		// Context/Question/Input text: each <=12 chars, so none may be clipped — a clamp box's
		// scrollHeight exceeding its clientHeight means the line-clamp cut off real content.
		for (const label of jevLabels) {
			expect(label.scrollHeight, `JEV "${label.text}"`).toBeLessThanOrEqual(label.clientHeight + 1)
		}
		expect(jevLabels.map((l) => l.text)).toEqual(expect.arrayContaining(['Context', 'Question', 'Input text']))

		const imgGenId = await createDefault(page, 'image_gen', 600, 0)
		await zoomToFit(page)
		const imgGenLabels = await portLabels(page, imgGenId)
		const ref = imgGenLabels.find((l) => l.text === 'Ref.')
		expect(ref, 'Generate image "Ref." label').toBeTruthy()
		expect(ref!.scrollHeight).toBeLessThanOrEqual(ref!.clientHeight + 1)
		// The old bug clipped it to a single character ("R…") — confirm the full word is there,
		// not just that the clamp box isn't overflowing.
		expect(ref!.text).toBe('Ref.')

		// The reference-image URL input must still be usable next to the label (UI-04's root
		// cause was a nested row that squeezed both down to ~80px).
		const refInput = nodeLocator(page, imgGenId).getByPlaceholder('reference image URL (optional)')
		await expect(refInput).toBeVisible()
		const inputBox = await refInput.boundingBox()
		expect(inputBox!.width).toBeGreaterThan(80)
	})

	test('UI-08/AI-09: Build panel "Plan" button reads in full', async ({ page }) => {
		await page.keyboard.press('Control+Shift+K')
		const panel = page.locator('.BuildPanel-row')
		await expect(panel).toBeVisible()
		const button = panel.locator('.UiButton', { hasText: 'Plan' })
		await expect(button).toBeVisible()
		const label = button.locator('.tlui-button__label')
		const [scrollWidth, clientWidth] = await label.evaluate((el) => [el.scrollWidth, el.clientWidth])
		expect(scrollWidth, '"Plan" label must not be clipped').toBeLessThanOrEqual(clientWidth + 1)
		await expect(label).toHaveText('Plan')
	})

	test('UI-10: Camera card uses the house UiButton, not a bare tldraw button', async ({ page }) => {
		const camId = await createDefault(page, 'camera')
		await zoomToFit(page)
		const button = nodeLocator(page, camId).locator('.NodeRow button', { hasText: 'Start camera' })
		await expect(button).toBeVisible()
		await expect(button).toHaveClass(/UiButton/)
		// "low" variant: the same visible grey chrome as "Load"/"Browse" elsewhere in this card
		// family — UI-10's complaint was that it read as inert text, not a control.
		const bg = await button.evaluate((el) => getComputedStyle(el).backgroundColor)
		expect(bg, 'Start camera button must have a visible background, not transparent').not.toMatch(
			/^(rgba\(0, 0, 0, 0\)|transparent)$/
		)
	})

	test('UI-12: a persistent toast does not block a card\'s Run button', async ({ page }) => {
		const promptId = await createDefault(page, 'prompt')
		await zoomToFit(page)

		// Fire the same "N default models are not available" toast App.tsx's ModelHealthToasts
		// shows for a broken default model — deterministically, without a real network failure.
		await page.evaluate(async () => {
			// @ts-expect-error dynamic import of an app source file
			const mod = await import('/client/ai/modelHealth.ts')
			mod.$modelHealth.set({ chat: { ok: false, model: 'broken/test-model', error: 'WP37 test: simulated failure' } })
		})
		await expect(page.locator('.tlui-toast__container')).toBeVisible()

		// A real (non-forced) click exercises Playwright's own actionability check, which fails
		// if another element visually intercepts the point — exactly how the original bug
		// reproduced (a card's "More options" click retried against the toast's text node).
		const runButton = nodeLocator(page, promptId).locator('.NodeShape-footer > button').first()
		await runButton.click({ timeout: 3000 })

		// The toast now sits in the top-right corner (CSS, index.css `.tlui-toast__viewport`),
		// not over the bottom toolbar or this app's own bottom-right chat-float button.
		const toastBox = await page.locator('.tlui-toast__container').boundingBox()
		const viewport = page.viewportSize()!
		expect(toastBox!.y, 'toast should sit near the top, not the bottom toolbar').toBeLessThan(viewport.height / 2)
	})

	test('UI-13: the "…" menu offers an unambiguous delete-lock toggle', async ({ page }) => {
		const promptId = await createDefault(page, 'prompt')
		await zoomToFit(page)
		const card = nodeLocator(page, promptId)
		await card.hover()
		await card.locator('[title="More options"]').first().click()
		const item = page.locator('.tlui-dropdown-menu, [role="menu"]').getByText('Prevent deletion', { exact: true })
		await expect(item).toBeVisible()
		await item.click()
		await page.keyboard.press('Escape')

		await card.hover()
		await card.locator('[title="More options"]').first().click()
		await expect(page.getByText('Allow deletion', { exact: true })).toBeVisible()
		await page.keyboard.press('Escape')
	})

	test('UI-16: "No AI models yet" banner shows with zero models, hides once one exists', async ({ page }) => {
		const setConfig = (models: unknown[]) =>
			page.evaluate(async (models) => {
				// @ts-expect-error dynamic import of an app source file
				const mod = await import('/client/ai/aiConfig.tsx')
				mod.$aiConfig.set({
					providers: [{ id: 'ollama', name: 'Ollama', kind: 'openai-compatible', baseURL: 'http://127.0.0.1:11434/v1', enabled: true, hasApiKey: false }],
					models,
					defaults: {},
				})
			}, models)

		await setConfig([])
		await expect(page.locator('.app-banner')).toContainText('No AI models yet')

		await setConfig([{ key: 'ollama/llama3', providerId: 'ollama', model: 'llama3', capabilities: ['chat'] }])
		await expect(page.locator('.app-banner')).toHaveCount(0)
	})
})
