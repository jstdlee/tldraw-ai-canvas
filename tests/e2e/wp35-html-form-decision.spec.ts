import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator, nodeProps, runNode, selectShapes, waitForRunIdle, wire, zoomToFit } from './helpers'

/**
 * WP35 A2/GAPS-05/06/15/16 and FLOW-09: the HTML form -> Decision switch glue, named submit
 * buttons, an unselected card's first click, the preview CSP, and a downstream card's hint
 * while an upstream form is waiting.
 */
test.describe('WP35 A2: HTML form value -> Decision switch', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('form -> Decision switch routes by choice, with no extra card in between (GAPS-05)', async ({ page }) => {
		const form = await createNode(
			page,
			{
				type: 'html_form',
				text: '<button data-value="short">Short</button><button data-value="formal">Formal</button>',
				html: '',
				css: '',
				js: '',
				allowNetwork: false,
				heightPx: 160,
				lastHtml: null,
				lastSubmissionJson: null,
				error: null,
			},
			{ x: 0, y: 0 }
		)
		const sw = await createNode(
			page,
			{
				type: 'decision_switch',
				mode: 'choice',
				threshold: 0.5,
				margin: 0,
				options: 'short\nformal',
				bands: 'low: 0.33\nmid: 0.66\nhigh',
				lastDecisionJson: null,
				lastOptions: null,
				error: null,
			},
			{ x: 600, y: 0 }
		)
		const short = await createNode(page, { type: 'output', kind: 'auto', lastValue: null }, { x: 1100, y: -150 })
		const formal = await createNode(page, { type: 'output', kind: 'auto', lastValue: null }, { x: 1100, y: 150 })
		await wire(page, form, 'value', sw, 'decision')
		await wire(page, sw, 'opt:short', short, 'input')
		await wire(page, sw, 'opt:formal', formal, 'input')
		await zoomToFit(page)

		await nodeLocator(page, form).locator('.NodeShape-footer > button').first().click()
		await selectShapes(page, [form])
		const frame = page.frameLocator(`[data-shape-id="${form}"] iframe`)
		await frame.locator('button[data-value="formal"]').click()
		await waitForRunIdle(page)

		const formNode = await nodeProps<{ error: string | null }>(page, form)
		expect(formNode.error).toBeNull()
		const swNode = await nodeProps<{ lastDecisionJson: string }>(page, sw)
		expect(JSON.parse(swNode.lastDecisionJson).chosen).toBe('opt:formal')
		const formalOut = await nodeProps<{ lastValue: string | null }>(page, formal)
		expect(formalOut.lastValue).toBe('formal')
		const shortOut = await nodeProps<{ lastValue: string | null }>(page, short)
		expect(shortOut.lastValue).toBeNull()
	})

	test('GAPS-06: a named submit button reports only the clicked button\'s value, not every button', async ({ page }) => {
		const form = await createNode(
			page,
			{
				type: 'html_form',
				text: '<form><button name="style" value="short">Short</button><button name="style" value="formal">Formal</button></form>',
				html: '',
				css: '',
				js: '',
				allowNetwork: false,
				heightPx: 160,
				lastHtml: null,
				lastSubmissionJson: null,
				error: null,
			},
			{ x: 0, y: 0 }
		)
		await zoomToFit(page)

		await nodeLocator(page, form).locator('.NodeShape-footer > button').first().click()
		await selectShapes(page, [form])
		const frame = page.frameLocator(`[data-shape-id="${form}"] iframe`)
		await frame.locator('button[value="formal"]').click()
		await waitForRunIdle(page)

		const node = await nodeProps<{ lastSubmissionJson: string }>(page, form)
		expect(JSON.parse(node.lastSubmissionJson)).toEqual({ style: 'formal' })
	})

	test('GAPS-16: a click on an unselected form card still counts (the first click is not lost)', async ({ page }) => {
		const form = await createNode(
			page,
			{
				type: 'html_form',
				text: '<button data-value="a">Option A</button>',
				html: '',
				css: '',
				js: '',
				allowNetwork: false,
				heightPx: 160,
				lastHtml: null,
				lastSubmissionJson: null,
				error: null,
			},
			{ x: 0, y: 0 }
		)
		await zoomToFit(page)

		// Deliberately never selecting the card (unlike the WP29 suite's own tests, and unlike
		// every other test in this file) — GAPS-16 is exactly that an unselected form used to
		// swallow its first click. `createNode` (a direct `editor.createShape`) does not select
		// its new shape, so the card starts, and stays, unselected.
		await nodeLocator(page, form).locator('.NodeShape-footer > button').first().click()
		const frame = page.frameLocator(`[data-shape-id="${form}"] iframe`)
		await frame.locator('button[data-value="a"]').click()
		await waitForRunIdle(page)

		const node = await nodeProps<{ lastSubmissionJson: string | null; value?: string }>(page, form)
		expect(JSON.parse(node.lastSubmissionJson ?? 'null')).toEqual({ clicked: 'Option A', value: 'a' })
	})

	test('GAPS-15: no "img-src contains none alongside other sources" CSP console warning', async ({ page }) => {
		const warnings: string[] = []
		page.on('console', (msg) => {
			if (/img-src.*none/i.test(msg.text())) warnings.push(`[${msg.type()}] ${msg.text()}`)
		})
		await createNode(
			page,
			{ type: 'html_preview', text: '<p>hi</p>', html: '', css: '', js: '', allowNetwork: false, heightPx: 160, lastHtml: null, error: null },
			{ x: 0, y: 0 }
		)
		await createNode(
			page,
			{
				type: 'html_form',
				text: '<button data-value="a">A</button>',
				html: '',
				css: '',
				js: '',
				allowNetwork: false,
				heightPx: 160,
				lastHtml: null,
				lastSubmissionJson: null,
				error: null,
			},
			{ x: 600, y: 0 }
		)
		await zoomToFit(page)
		await page.waitForTimeout(500)
		expect(warnings).toEqual([])
	})
})

test.describe('FLOW-09: waiting-upstream hint', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('an Output downstream of a waiting html_form shows which card it is waiting on', async ({ page }) => {
		const form = await createNode(
			page,
			{
				type: 'html_form',
				text: '<button data-value="a">A</button>',
				html: '',
				css: '',
				js: '',
				allowNetwork: false,
				heightPx: 160,
				lastHtml: null,
				lastSubmissionJson: null,
				error: null,
			},
			{ x: 0, y: 0 }
		)
		const out = await createNode(page, { type: 'output', kind: 'auto', lastValue: null }, { x: 600, y: 0 })
		await wire(page, form, 'json', out, 'input')
		await zoomToFit(page)

		await nodeLocator(page, form).locator('.NodeShape-footer > button').first().click()
		await expect(nodeLocator(page, form).locator('.NodeStatus')).toContainText('Waiting for input')
		await expect(nodeLocator(page, out).locator('.NodeStatus')).toContainText('Waiting for input in')

		// Clean up: answer the form so the run doesn't linger past the test.
		await selectShapes(page, [form])
		await page.frameLocator(`[data-shape-id="${form}"] iframe`).locator('button[data-value="a"]').click()
		await waitForRunIdle(page)
	})
})
