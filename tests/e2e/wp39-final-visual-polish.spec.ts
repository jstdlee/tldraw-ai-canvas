import { expect, Page, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator, setNodeProps, wire, zoomToFit } from './helpers'

/**
 * WP39 final visual polish regression tests (docs/rework/WP39-final-visual-polish.md,
 * evidence screenshots under .../review/final-cards and .../review/final-sheets).
 */

/** Create a card from its type's own `getDefault()` plus overrides — mirrors `createDefaultNode`
 * in helpers.ts but kept local so this file states exactly which fields it cares about. */
async function createDefault(
	page: Page,
	type: string,
	overrides: Record<string, unknown> = {},
	x = 0,
	y = 0
): Promise<string> {
	return page.evaluate(
		async ({ type, overrides, x, y }) => {
			const editor = (window as any).editor
			// @ts-expect-error dynamic import of an app source file, only resolvable by the dev
			// server — same trick tests/e2e/helpers.ts uses elsewhere.
			const { getNodeDefinition } = await import('/client/pipeline/nodes/definitionStore.ts')
			const node = { ...getNodeDefinition(editor, type).getDefault(), ...overrides, type }
			const shapeId = `shape:${crypto.randomUUID()}`
			editor.createShape({ id: shapeId, type: 'node', x, y, props: { node, fontSize: 16 } })
			return shapeId
		},
		{ type, overrides, x, y }
	)
}

async function setDark(page: Page, dark: boolean) {
	await page.evaluate((dark) => {
		;(window as any).editor.user.updateUserPreferences({ colorScheme: dark ? 'dark' : 'light' })
	}, dark)
}

/** All registered (non-removed) node types, read from the live registry module — used by the
 * card-wide "nothing overflows its own card" sweep. */
async function listTypes(page: Page): Promise<string[]> {
	return page.evaluate(async () => {
		// @ts-expect-error dynamic import of an app source file
		const mod = await import('/client/pipeline/nodes/registry.ts')
		return Object.values(mod.NodeDefinitions as Record<string, { type: string }>).map((d) => d.type)
	})
}

test.describe('WP39 final visual polish', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('sweep: no element of any default card overflows its own card box horizontally', async ({ page }) => {
		const types = await listTypes(page)
		const overflowing: string[] = []
		for (const type of types) {
			let id: string
			try {
				id = await createDefault(page, type, {}, 0, 0)
			} catch {
				continue // a handful of types need inputs createDefault can't supply; not this test's concern
			}
			await zoomToFit(page)
			const bad = await page.evaluate((id) => {
				const card = document.querySelector(`[data-shape-id="${id}"]`)
				if (!card) return []
				const cardRect = card.getBoundingClientRect()
				const bad: string[] = []
				for (const el of card.querySelectorAll<HTMLElement>('*')) {
					// Dropdown/menu content renders through a portal elsewhere in the DOM, not as a
					// descendant of the card, so it is naturally excluded from this query already.
					// A port dot's own coordinate sits exactly on the card's edge by design (so a
					// wire visually lands on the border) — it straddles the edge on purpose, not a
					// clipping bug.
					if (el.className && String(el.className).includes('Port')) continue
					// `.CodeArea-highlight` (CodeArea.tsx) is a decorative, `aria-hidden` syntax-
					// highlight overlay clipped by its own `overflow: hidden` — its scroll position
					// is kept in sync with the real (invisible) input textarea next to it, which the
					// user does scroll, so a long code line "escaping" the overlay's own box isn't a
					// bug the way it would be for ordinary content.
					if (el.closest('.CodeArea-highlight')) continue
					// Content inside a horizontally/vertically SCROLLABLE ancestor (a code editor,
					// a `.NodeScroll` list) is reachable by scrolling, so it isn't "cut off" even
					// though its layout box is wider than the box the user currently sees. Only an
					// ancestor up to (not including) the card counts — the card/NodeBody's own
					// `overflow: hidden` must still catch genuinely clipped content.
					let reachable = false
					for (let p = el.parentElement; p && p !== card; p = p.parentElement) {
						const cs = getComputedStyle(p)
						if (/(auto|scroll)/.test(cs.overflowX) || /(auto|scroll)/.test(cs.overflowY)) {
							reachable = true
							break
						}
					}
					if (reachable) continue
					const r = el.getBoundingClientRect()
					if (r.width === 0 && r.height === 0) continue
					if (r.right > cardRect.right + 5) {
						bad.push(`${el.className || el.tagName}: right=${r.right.toFixed(1)} > card right=${cardRect.right.toFixed(1)}`)
					}
				}
				return bad
			}, id)
			if (bad.length) overflowing.push(`${type}: ${bad.slice(0, 3).join(' | ')}`)
			await page.evaluate((id) => { (window as any).editor.deleteShape(id) }, id)
		}
		expect(overflowing, overflowing.join('\n')).toEqual([])
	})

	test('1. Database: all four Source options fit without truncation, Rows hint on one line', async ({ page }) => {
		const id = await createDefault(page, 'database')
		await zoomToFit(page)
		const card = nodeLocator(page, id)
		const cardBox = (await card.boundingBox())!
		const segmented = card.locator('.UiSegmented').first()
		const items = segmented.locator('.UiSegmented-item')
		expect(await items.count()).toBe(4)
		for (let i = 0; i < 4; i++) {
			const item = items.nth(i)
			const box = (await item.boundingBox())!
			expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1)
			const overflowing = await item.locator('.tlui-button__label').evaluate((el) => el.scrollWidth > el.clientWidth + 1)
			expect(overflowing).toBe(false)
		}
		// The "Rows" hint must read on one line, not a cramped wrapped fragment off to one side.
		const hint = card.locator('.NodeRow', { hasText: 'Rows' }).locator('.NodeRow-disconnected')
		await expect(hint).toHaveText('wire CSV rows to load')
		const hintBox = (await hint.boundingBox())!
		expect(hintBox.height).toBeLessThan(24) // one line at this font, not two
	})

	test('2. Decision switch: every field has a label+editor or a labelled "not used" hint, never blank', async ({ page }) => {
		const id = await createDefault(page, 'decision_switch')
		await zoomToFit(page)
		const card = nodeLocator(page, id)
		// Default resolves to Yes/No mode: Options/Bands say "not used", Threshold/Margin are
		// real labelled editors in the same row as their label.
		await expect(card.locator('.NodeRow', { hasText: 'Options' })).toContainText('not used in Yes/No mode')
		await expect(card.locator('.NodeRow', { hasText: 'Bands' })).toContainText('not used in Yes/No mode')
		const thresholdRow = card.locator('.NodeRow', { hasText: 'Threshold' })
		await expect(thresholdRow.locator('input')).toHaveValue('0.5')
		const marginRow = card.locator('.NodeRow', { hasText: 'Margin' })
		await expect(marginRow.locator('input')).toHaveValue('0')
		await expect(marginRow).toContainText('0 = off')

		// Switch to Choice mode: now Options gets the real editor, Threshold/Margin collapse.
		await setNodeProps(page, id, { mode: 'choice' })
		await expect(card.locator('.NodeRow', { hasText: 'Threshold' })).toContainText('not used in Choice mode')
		await expect(card.locator('.NodeRow', { hasText: 'Margin' })).toContainText('not used in Choice mode')
		await expect(card.locator('textarea[placeholder="One option per line"]')).toBeVisible()
	})

	test('3. Merge: defaults to Newline (not "Choose"), greys out with a hint outside All-joined mode', async ({ page }) => {
		const id = await createDefault(page, 'merge')
		const props = await page.evaluate((id) => (window as any).editor.getShape(id)?.props?.node, id)
		expect((props as { separator: string }).separator).toBe('\n') // a real newline, not the literal "\n"
		await zoomToFit(page)
		const card = nodeLocator(page, id)
		const joinRow = card.locator('.NodeRow', { hasText: 'Join with' })
		await expect(joinRow.locator('.UiSelect-label')).toHaveText('Newline')
		await expect(joinRow.locator('.UiSelect-trigger')).toBeDisabled()
		await expect(joinRow).toContainText('All joined only')

		await setNodeProps(page, id, { mode: 'all' })
		await expect(joinRow.locator('.UiSelect-trigger')).toBeEnabled()
		await expect(joinRow).not.toContainText('All joined only')
	})

	test('4. For each: progress reads as a labelled bar, not a bare scrollbar-like strip', async ({ page }) => {
		const id = await createDefault(page, 'for_each')
		await zoomToFit(page)
		const card = nodeLocator(page, id)
		const progress = card.locator('.ForEachNode-progress')
		await expect(progress).toContainText('Not run yet')
		const bar = progress.locator('.ProgressBar > span')
		expect(await bar.evaluate((el) => el.style.width)).toBe('0%')

		await setNodeProps(page, id, { progress: '3 / 10' })
		await expect(progress).toContainText('3 / 10')
		expect(await bar.evaluate((el) => el.style.width)).toBe('30%')
	})

	test('5. JSON fields: the Paths box grows to show every path line (up to the cap)', async ({ page }) => {
		const id = await createDefault(page, 'json_fields')
		await zoomToFit(page)
		const card = nodeLocator(page, id)
		// Default node has 4 paths; the box must be tall enough to show all 4 without scrolling.
		const heights = await card.locator('textarea').evaluateAll((els: HTMLTextAreaElement[]) => {
			const el = els.find((e) => e.placeholder.includes('data[0].name'))!
			return { scroll: el.scrollHeight, client: el.clientHeight }
		})
		expect(heights.client).toBeGreaterThanOrEqual(heights.scroll - 2)
	})

	test('6. Chart: the Text row is a real placeholder textarea, hidden once Table is wired', async ({ page }) => {
		const chartId = await createDefault(page, 'chart')
		await zoomToFit(page)
		const card = nodeLocator(page, chartId)
		const textarea = card.locator('textarea[placeholder="Paste a table: CSV, TSV, JSON array, or Markdown"]')
		await expect(textarea).toBeVisible()

		const promptId = await createNode(page, { type: 'prompt', text: 'a,b\n1,2' }, { x: 700, y: 0 })
		await wire(page, promptId, 'output', chartId, 'data')
		await zoomToFit(page)
		await expect(textarea).toHaveCount(0)
	})

	test('7. HTML preview: the HTML override placeholder reads on one line, not clipped mid-line', async ({ page }) => {
		const id = await createDefault(page, 'html_preview')
		await zoomToFit(page)
		const card = nodeLocator(page, id)
		const html = card.locator('textarea[placeholder="Overrides the html fenced block"]')
		await expect(html).toBeVisible()
		const h = await html.evaluate((el: HTMLTextAreaElement) => ({ scroll: el.scrollHeight, client: el.clientHeight }))
		expect(h.client).toBeGreaterThanOrEqual(h.scroll - 2)
	})

	test('7b. HTML preview/form: "Allow network" reads on one line and the height field stays compact', async ({ page }) => {
		for (const type of ['html_preview', 'html_form']) {
			const id = await createDefault(page, type, {}, 0, 0)
			await zoomToFit(page)
			const card = nodeLocator(page, id)
			const label = card.locator('.UiCheckbox-label', { hasText: 'Allow network' })
			await expect(label).toBeVisible()
			const overflowing = await label.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
			expect(overflowing, `${type}: Allow network must not wrap`).toBe(false)
			const heightInput = card.locator('.HtmlPreviewNode-heightInput')
			const w = (await heightInput.boundingBox())!.width
			expect(w, `${type}: height field must stay ~56px, not balloon`).toBeLessThan(70)
			await page.evaluate((id) => { (window as any).editor.deleteShape(id) }, id)
		}
	})

	test('8. Image tools: Restore default is a compact icon button, Tool select keeps its width', async ({ page }) => {
		const id = await createDefault(page, 'image_tool')
		await zoomToFit(page)
		const card = nodeLocator(page, id)
		const resetButton = card.locator('button[title="Restore default"]')
		await expect(resetButton).toBeVisible()
		await expect(resetButton).not.toHaveText(/Restore default/)
		const select = card.locator('.NodeRow', { hasText: 'Tool' }).locator('.UiSelect-trigger')
		const box = (await select.boundingBox())!
		expect(box.width).toBeGreaterThan(100) // was squeezed to ~70px by the old full-text button
	})

	test('9. Model provider: a long URL stays single-line (scrolls) instead of breaking mid-word', async ({ page }) => {
		const id = await createDefault(page, 'model_source', {
			baseURL: 'https://my-very-long-custom-proxy-endpoint.example.com/api/v1/openai-compatible',
		})
		await zoomToFit(page)
		const card = nodeLocator(page, id)
		const field = card.locator('.UiGrowingInput_nowrap')
		await expect(field).toBeVisible()
		const h = await field.evaluate((el: HTMLTextAreaElement) => ({ scroll: el.scrollHeight, client: el.clientHeight }))
		// A single-line field's scrollHeight may exceed clientHeight by at most rounding, never by
		// a whole extra wrapped line (~19px) the way the old break-word field did.
		expect(h.scroll - h.client).toBeLessThan(6)
		const box = (await field.boundingBox())!
		const cardBox = (await card.boundingBox())!
		expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1)
	})

	test('10a. Text tools: Param B says it is not used instead of rendering a blank row', async ({ page }) => {
		const id = await createDefault(page, 'text_tool') // default op "template" has no second param
		await zoomToFit(page)
		const card = nodeLocator(page, id)
		const row = card.locator('.NodeRow', { hasText: 'Param B' })
		await expect(row).toContainText('not used by Template')
	})

	test('10b. Code: an input row\'s rename field and its label stay paired, not pulled apart', async ({ page }) => {
		const id = await createDefault(page, 'code')
		await zoomToFit(page)
		const card = nodeLocator(page, id)
		const row = card.locator('.CodeNode-portRow').first() // the "a" row
		const label = row.locator('.CodeNode-portName')
		const input = row.locator('.CodeNode-name')
		const labelBox = (await label.boundingBox())!
		const inputBox = (await input.boundingBox())!
		// The label sits immediately before the rename input, not detached at the row's far edge
		// past empty space (the old bug: the label was absolutely positioned to the row's right
		// edge while the input stayed near the port, so they visually swapped places).
		expect(labelBox.x).toBeLessThan(inputBox.x)
		expect(inputBox.x - (labelBox.x + labelBox.width)).toBeLessThan(40)
	})

	test('10c. JEV: a row\'s hint and its paired output label never overlap, and the hint is one line', async ({ page }) => {
		const id = await createDefault(page, 'jev', { kind: 'noul' })
		await zoomToFit(page)
		const card = nodeLocator(page, id)
		const contextHint = card.locator('.NodeRow', { hasText: 'Context' }).locator('.NodeRow-disconnected')
		const probsLabel = card.locator('.NodeRow', { hasText: 'Context' }).locator('.CodeNode-outLabel-static')
		await expect(contextHint).toHaveText('e.g. LLM output')
		await expect(probsLabel).toHaveText('probabilities →')
		const hintBox = (await contextHint.boundingBox())!
		const labelBox = (await probsLabel.boundingBox())!
		expect(hintBox.height).toBeLessThan(24) // one line, not wrapped
		expect(hintBox.x + hintBox.width).toBeLessThanOrEqual(labelBox.x + 1) // no overlap

		// Not `.NodeRow` + hasText: 'Input text' — the Filter checkbox's own label ("Then filter
		// the input text with an LLM") also contains that substring (case-insensitively) and
		// would make the locator ambiguous.
		const inputLabel = card.locator('.NodePortLabel', { hasText: /^Input text$/ })
		await expect(inputLabel).toHaveText('Input text')
		const il = await inputLabel.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)
		expect(il, 'Input text label must not wrap to two lines').toBe(true)
	})

	test('10d. Capture: header/footer backing follows the theme instead of a hardcoded white bar', async ({ page }) => {
		const id = await createDefault(page, 'capture')
		await zoomToFit(page)
		const heading = nodeLocator(page, id).locator('.NodeShape-heading')
		await setDark(page, false)
		const light = await heading.evaluate((el) => getComputedStyle(el).backgroundColor)
		await setDark(page, true)
		const dark = await heading.evaluate((el) => getComputedStyle(el).backgroundColor)
		expect(dark, 'the heading backing must change with theme, not stay a fixed white').not.toBe(light)
	})
})
