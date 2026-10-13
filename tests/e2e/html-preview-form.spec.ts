import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator, nodeProps, selectShapes, waitForRunIdle, wire, zoomToFit } from './helpers'

/**
 * WP29: the sandboxed HTML preview (`html_preview`) and HTML form (`html_form`) cards.
 * `html_form`'s `execute()` waits for a `postMessage` from its own iframe — these tests click
 * inside that iframe (via `frameLocator`) instead of calling `startExecution` directly, so the
 * whole bridge (sandbox -> postMessage -> validate -> resolve/re-run) is exercised for real.
 */
test.describe('HTML preview / HTML form cards', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('HTML preview renders a fragment inside the sandboxed iframe', async ({ page }) => {
		const id = await createNode(
			page,
			{
				type: 'html_preview',
				text: '<p id="marker">hello from the sandbox</p>',
				html: '',
				css: '',
				js: '',
				allowNetwork: false,
				heightPx: 220,
				lastHtml: null,
				error: null,
			},
			{ x: 100, y: 100 }
		)
		await zoomToFit(page)
		// No Play needed: the in-card preview is a live computation from the current fields.
		const frame = page.frameLocator(`[data-shape-id="${id}"] iframe`)
		await expect(frame.locator('#marker')).toHaveText('hello from the sandbox')
	})

	test('neither card ever sets allow-same-origin on its iframe', async ({ page }) => {
		const previewId = await createNode(
			page,
			{
				type: 'html_preview',
				text: '<p>hi</p>',
				html: '',
				css: '',
				js: '',
				allowNetwork: false,
				heightPx: 220,
				lastHtml: null,
				error: null,
			},
			{ x: 100, y: 100 }
		)
		const formId = await createNode(
			page,
			{
				type: 'html_form',
				text: '<button data-value="a">A</button>',
				html: '',
				css: '',
				js: '',
				allowNetwork: false,
				heightPx: 220,
				lastHtml: null,
				lastSubmissionJson: null,
				error: null,
			},
			{ x: 600, y: 100 }
		)
		await zoomToFit(page)
		for (const id of [previewId, formId]) {
			const sandbox = await nodeLocator(page, id).locator('iframe').getAttribute('sandbox')
			expect(sandbox).not.toBeNull()
			expect(sandbox).not.toContain('allow-same-origin')
			expect(sandbox).toContain('allow-scripts')
			expect(sandbox).toContain('allow-forms')
		}
	})

	test('clicking a data-value button outputs { clicked, value } as json, and Stop cancels the wait', async ({ page }) => {
		const id = await createNode(
			page,
			{
				type: 'html_form',
				text: '<button data-value="a">Option A</button><button data-value="b">Option B</button>',
				html: '',
				css: '',
				js: '',
				allowNetwork: false,
				heightPx: 220,
				lastHtml: null,
				lastSubmissionJson: null,
				error: null,
			},
			{ x: 100, y: 100 }
		)
		await zoomToFit(page)

		const card = nodeLocator(page, id)
		await card.locator('.NodeShape-footer > button').first().click()
		await expect(card.locator('.NodeStatus')).toContainText('Waiting for input')
		await selectShapes(page, [id])

		const frame = page.frameLocator(`[data-shape-id="${id}"] iframe`)
		await frame.locator('button[data-value="a"]').click()
		await waitForRunIdle(page)

		const node = await nodeProps<{ lastSubmissionJson: string | null; error: string | null }>(page, id)
		expect(node.error).toBeNull()
		expect(JSON.parse(node.lastSubmissionJson ?? 'null')).toEqual({ clicked: 'Option A', value: 'a' })
	})

	test('submitting a <form> outputs its fields as json (checkbox -> boolean, number input -> number)', async ({ page }) => {
		const formHtml =
			'<form><input name="q" value="hello" /><input type="checkbox" name="agree" checked /><input type="number" name="count" value="3" /><button type="submit">Go</button></form>'
		const id = await createNode(
			page,
			{
				type: 'html_form',
				text: formHtml,
				html: '',
				css: '',
				js: '',
				allowNetwork: false,
				heightPx: 220,
				lastHtml: null,
				lastSubmissionJson: null,
				error: null,
			},
			{ x: 100, y: 100 }
		)
		await zoomToFit(page)

		await nodeLocator(page, id).locator('.NodeShape-footer > button').first().click()
		await selectShapes(page, [id])
		const frame = page.frameLocator(`[data-shape-id="${id}"] iframe`)
		await frame.locator('button[type="submit"]').click()
		await waitForRunIdle(page)

		const node = await nodeProps<{ lastSubmissionJson: string | null }>(page, id)
		expect(JSON.parse(node.lastSubmissionJson ?? 'null')).toEqual({ q: 'hello', agree: true, count: 3 })
	})

	test('submitting again (without pressing Play) re-runs whatever is wired downstream', async ({ page }) => {
		const formId = await createNode(
			page,
			{
				type: 'html_form',
				text: '<button data-value="a">Option A</button><button data-value="b">Option B</button>',
				html: '',
				css: '',
				js: '',
				allowNetwork: false,
				heightPx: 220,
				lastHtml: null,
				lastSubmissionJson: null,
				error: null,
			},
			{ x: 100, y: 100 }
		)
		const outputId = await createNode(page, { type: 'output', kind: 'auto', lastValue: null }, { x: 700, y: 100 })
		await wire(page, formId, 'json', outputId, 'input')
		await zoomToFit(page)

		await nodeLocator(page, formId).locator('.NodeShape-footer > button').first().click()
		await selectShapes(page, [formId])
		const frame = page.frameLocator(`[data-shape-id="${formId}"] iframe`)
		await frame.locator('button[data-value="a"]').click()
		await waitForRunIdle(page)

		const first = await nodeProps<{ lastValue: string | null }>(page, outputId)
		expect(JSON.parse(first.lastValue ?? 'null')).toEqual({ clicked: 'Option A', value: 'a' })

		// No Play click this time — the card's own bridge handler starts the re-run.
		await frame.locator('button[data-value="b"]').click()
		await waitForRunIdle(page)

		const second = await nodeProps<{ lastValue: string | null }>(page, outputId)
		expect(JSON.parse(second.lastValue ?? 'null')).toEqual({ clicked: 'Option B', value: 'b' })
	})
})
