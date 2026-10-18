import { expect, Page, test } from '@playwright/test'
import { gotoApp, nodeLocator, nodeProps, runNode, selectShapes, waitForRunIdle, zoomToFit } from './helpers'

/**
 * WP38 (GAPS-19): the 8 new examples added to `shared/examples.ts`, each combining the new
 * cards (Agent, Extract, Template, Merge, Gallery, For each "table rows", HTML form "value",
 * Decision switch choice/score) the way a real pipeline would. Placed exactly as shipped — by
 * id, from the real `EXAMPLES` array — so a future edit to the example itself is what this
 * suite re-checks, not a hand-duplicated copy. Every AI-calling endpoint is mocked; no test
 * here may reach a real model.
 */

/** Places one example by id (mirrors `client/pipeline/loadExample.ts`, but returns the
 * example-local id -> real shape id map the test needs to drive individual cards). */
async function placeExample(page: Page, exampleId: string): Promise<Record<string, string>> {
	return page.evaluate(async (exampleId) => {
		// @ts-expect-error runtime import of an app source file, only resolvable by the dev server
		const store = await import('/client/pipeline/nodes/definitionStore.ts')
		// @ts-expect-error runtime import of an app source file, only resolvable by the dev server
		const ex = await import('/shared/examples.ts')
		const editor = (window as any).editor
		const example = ex.EXAMPLES.find((e: any) => e.id === exampleId)
		if (!example) throw new Error(`no such example: ${exampleId}`)
		const ids = new Map<string, string>()
		for (const node of example.nodes) {
			const def = store.getNodeDefinition(editor, node.type)
			const value = { ...def.getDefault(), ...(node.props ?? {}), type: node.type }
			const id = `shape:${crypto.randomUUID()}`
			editor.createShape({ id, type: 'node', x: node.x, y: node.y, props: { node: value, fontSize: 16 } })
			ids.set(node.id, id)
		}
		for (const w of example.wires) {
			const fromId = ids.get(w.from)
			const toId = ids.get(w.to)
			if (!fromId || !toId) continue
			const connectionId = `shape:${crypto.randomUUID()}`
			editor.createShape({ id: connectionId, type: 'connection', props: { start: { x: 0, y: 0 }, end: { x: 80, y: 0 } } })
			editor.createBinding({
				id: `binding:${crypto.randomUUID()}`,
				type: 'connection',
				fromId: connectionId,
				toId: fromId,
				props: { terminal: 'start', portId: w.fromPort, order: 0 },
			})
			editor.createBinding({
				id: `binding:${crypto.randomUUID()}`,
				type: 'connection',
				fromId: connectionId,
				toId: toId,
				props: { terminal: 'end', portId: w.toPort, order: 1 },
			})
		}
		editor.selectNone()
		return Object.fromEntries(ids)
	}, exampleId)
}

/** A generic `/api/generate-text` mock (text_ai, generate_text) returning one fixed reply. */
async function mockGenerateText(page: Page, reply = 'AI MOCK REPLY') {
	await page.route('**/api/generate-text', async (route) => {
		await route.fulfill({ json: { text: reply } })
	})
}

test.describe('WP38 new examples (GAPS-19)', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('csv-rows-ai-table: For each "table rows" + AI text + Collect "table"', async ({ page }) => {
		await mockGenerateText(page, 'Great, fast shipping.')
		const ids = await placeExample(page, 'csv-rows-ai-table')
		await zoomToFit(page)
		// The loop itself must run (its AI-calling body is only reached by running the for_each
		// card directly — a downstream reader does not pull-trigger a loop's own body).
		await runNode(page, ids.loop, 30_000)
		await waitForRunIdle(page, 30_000)
		await runNode(page, ids.out, 30_000)

		const loop = await nodeProps<{ lastResults: string | null; error: string | null }>(page, ids.loop)
		expect(loop.error).toBeNull()
		expect(loop.lastResults).toContain('summary')
		expect(loop.lastResults).toContain('id,product,review,summary')
		expect(loop.lastResults).toContain('Great, fast shipping.')
	})

	test('agent-extract-chart: Agent prose -> Extract (table) -> Chart', async ({ page }) => {
		await page.route('**/api/agent/run', async (route) => {
			const events = [
				{
					type: 'final',
					output:
						'Here is what I found:\n\n| language | share |\n| --- | --- |\n| Python | 28 |\n| JavaScript | 20 |\n| Java | 15 |\n\nLet me know if you want more detail.',
					steps: [],
				},
			]
			const sse = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
			await route.fulfill({ contentType: 'text/event-stream', body: sse })
		})
		const ids = await placeExample(page, 'agent-extract-chart')
		await zoomToFit(page)
		await runNode(page, ids.chart, 30_000)

		const agent = await nodeProps<{ error: string | null }>(page, ids.agent)
		expect(agent.error).toBeNull()
		const ext = await nodeProps<{ lastTable: string; error: string | null }>(page, ids.ext)
		expect(ext.error).toBeNull()
		expect(ext.lastTable).toContain('language,share')
		const chart = await nodeProps<{ error: string | null }>(page, ids.chart)
		expect(chart.error).toBeNull()
	})

	test('form-switch-merge: HTML form "value" -> Decision switch choice -> AI text -> Merge', async ({ page }) => {
		await mockGenerateText(page, 'Short and punchy rewrite.')
		const ids = await placeExample(page, 'form-switch-merge')
		await zoomToFit(page)

		// Start the form card so its iframe renders, then click "Short".
		await nodeLocator(page, ids.form).locator('.NodeShape-footer > button').first().click()
		await selectShapes(page, [ids.form])
		await page.frameLocator(`[data-shape-id="${ids.form}"] iframe`).locator('button[data-value="short"]').click()
		await waitForRunIdle(page, 30_000)

		const route = await nodeProps<{ lastDecisionJson: string }>(page, ids.route)
		expect(JSON.parse(route.lastDecisionJson).chosen).toBe('opt:short')
		const short = await nodeProps<{ error: string | null }>(page, ids.short)
		expect(short.error).toBeNull()
		const out = await nodeProps<{ lastValue: string | null }>(page, ids.out)
		expect(out.lastValue).toBe('Short and punchy rewrite.')
	})

	test('sql-template-report: Database (grouped SQL) -> Template ({{table}} + {{chart}}) -> HTML preview -> Save', async ({ page }) => {
		const ids = await placeExample(page, 'sql-template-report')
		// No zoomToFit: the chain's last card ("save") sits at the far right of a wide row, and
		// fitting the whole example into frame can land it under tldraw's own floating style
		// panel. runNode() already zooms to the clicked shape's own bounds when it isn't
		// (fully) on screen, which it reliably is right after placement (camera at its default).
		await runNode(page, ids.save, 30_000)

		const db = await nodeProps<{ error: string | null }>(page, ids.db)
		expect(db.error).toBeNull()
		const rpt = await nodeProps<{ lastOutput: string | null; error: string | null }>(page, ids.rpt)
		expect(rpt.error).toBeNull()
		expect(rpt.lastOutput).toContain('<h1>Sales report</h1>')
		expect(rpt.lastOutput).toMatch(/region/i)
		expect(rpt.lastOutput).toMatch(/<img src="[^"]+">/)
		const save = await nodeProps<{ error: string | null; lastPath: string | null }>(page, ids.save)
		expect(save.error).toBeNull()
		expect(save.lastPath).toBeTruthy()
	})

	test('links-foreach-summary: Extract links -> For each rows (row:text) -> AI text -> Collect "table"', async ({ page }) => {
		await mockGenerateText(page, 'A friendly one-liner.')
		const ids = await placeExample(page, 'links-foreach-summary')
		await zoomToFit(page)
		await runNode(page, ids.links, 30_000)
		const links = await nodeProps<{ error: string | null }>(page, ids.links)
		expect(links.error).toBeNull()
		// The loop itself must run (its AI-calling body is only reached by running the for_each
		// card directly — a downstream reader does not pull-trigger a loop's own body).
		await runNode(page, ids.loop, 30_000)
		await runNode(page, ids.out, 30_000)
		const loop = await nodeProps<{ lastResults: string | null; error: string | null }>(page, ids.loop)
		expect(loop.error).toBeNull()
		expect(loop.lastResults).toContain('url,text,summary')
		expect(loop.lastResults).toContain('A friendly one-liner.')
	})

	test('search-table-chart: Web search results -> DataPipe formula column -> Chart', async ({ page }) => {
		await page.route('**/api/search', async (route) => {
			await route.fulfill({
				json: {
					provider: 'exa',
					ms: 5,
					results: [
						{ title: 'Automerge 3.0 released', url: 'https://automerge.org/blog/automerge-3', snippet: 'Faster CRDT sync for everyone.' },
						{ title: 'ElectricSQL sync engine', url: 'https://electric-sql.com/docs/intro', snippet: 'Postgres sync.' },
					],
				},
			})
		})
		const ids = await placeExample(page, 'search-table-chart')
		await zoomToFit(page)
		await runNode(page, ids.bars, 30_000)

		const search = await nodeProps<{ error: string | null }>(page, ids.search)
		expect(search.error).toBeNull()
		const pipe = await nodeProps<{ error: string | null }>(page, ids.pipe)
		expect(pipe.error).toBeNull()
		const bars = await nodeProps<{ error: string | null }>(page, ids.bars)
		expect(bars.error).toBeNull()
	})

	test('jev-switch-merge: JEV yes/no pass-through -> AI text -> Merge', async ({ page }) => {
		await page.route('**/api/jev', async (route) => {
			await route.fulfill({ json: { type: 'noul', answer: 'yes', probabilities: { yes: 0.92, no: 0.08 }, confidence: 0.92, source: 'mock' } })
		})
		await mockGenerateText(page, 'A heartfelt apology with a refund offer.')
		const ids = await placeExample(page, 'jev-switch-merge')
		await zoomToFit(page)
		await runNode(page, ids.out, 30_000)

		const judge = await nodeProps<{ error: string | null }>(page, ids.judge)
		expect(judge.error).toBeNull()
		const apology = await nodeProps<{ error: string | null }>(page, ids.apology)
		expect(apology.error).toBeNull()
		const out = await nodeProps<{ lastValue: string | null }>(page, ids.out)
		expect(out.lastValue).toBe('A heartfelt apology with a refund offer.')
	})

	test('batch-resize-gallery: For each -> Load image -> Resize -> Collect "json" -> Gallery', async ({ page }) => {
		const ids = await placeExample(page, 'batch-resize-gallery')
		await zoomToFit(page)
		// The loop itself must run (its body is only reached by running the for_each card
		// directly — a downstream reader does not pull-trigger a loop's own body).
		await runNode(page, ids.loop, 30_000)
		await runNode(page, ids.grid, 30_000)

		const loop = await nodeProps<{ lastResults: string | null; error: string | null }>(page, ids.loop)
		expect(loop.error).toBeNull()
		const images: unknown = JSON.parse(loop.lastResults ?? '[]')
		expect(Array.isArray(images) ? images.length : 0).toBe(3)
		const grid = await nodeProps<{ error: string | null }>(page, ids.grid)
		expect(grid.error).toBeNull()
	})
})
