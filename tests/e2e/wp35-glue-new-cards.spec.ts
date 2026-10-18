import { createServer, Server } from 'node:http'
import { expect, Page, test } from '@playwright/test'
import { createNode, gotoApp, nodeProps, runNode, wire, zoomToFit } from './helpers'

/**
 * WP35: the three new "glue" cards (A JSON fields, B Extract from text, F Template), each
 * exercised through the real engine (a Run click, not a direct call into the pure helper —
 * those already have thorough unit tests in tests/jsonFields.test.ts, extractFromText.test.ts
 * and templateCard.test.ts).
 */

/** Create a node from its own definition's default value, patched — the same pattern the gaps
 * review helpers (tests/review-tmp/gaps/g.ts) use, kept local here to avoid touching the shared
 * tests/e2e/helpers.ts while other agents' suites are also importing it. */
async function addDefault(page: Page, type: string, patch: Record<string, unknown> = {}, x = 0, y = 0): Promise<string> {
	return page.evaluate(
		async ({ type, patch, x, y }) => {
			// @ts-expect-error dynamic import of an app source file, resolvable at runtime only
			// by the dev server (see helpers.ts's runNode for the same trick).
			const store = await import('/client/pipeline/nodes/definitionStore.ts')
			const editor = (window as any).editor
			const def = store.getNodeDefinition(editor, type)
			const node = { ...def.getDefault(), ...patch, type }
			const id = `shape:${crypto.randomUUID()}`
			editor.createShape({ id, type: 'node', x, y, props: { node, fontSize: 16 } })
			return id
		},
		{ type, patch, x, y }
	)
}

async function portIds(page: Page, id: string, terminal: 'start' | 'end'): Promise<string[]> {
	return page.evaluate(
		async ({ id, terminal }) => {
			// @ts-expect-error dynamic import, see addDefault above.
			const nt = await import('/client/pipeline/nodes/nodeTypes.tsx')
			const editor = (window as any).editor
			const ports = nt.getNodeTypePorts(editor, editor.getShape(id))
			return Object.values<any>(ports)
				.filter((p: any) => p.terminal === terminal)
				.map((p: any) => p.id)
		},
		{ id, terminal }
	)
}

test.describe('WP35 Part A: JSON fields', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('one output port per Paths line, missing path is a warning not an error', async ({ page }) => {
		const source = await createNode(page, { type: 'prompt', text: '{"value":"hi","topic":"demo","customer":{"country":"NO"}}' }, { x: 0, y: 0 })
		const fields = await addDefault(page, 'json_fields', { paths: 'value\ntopic\ncustomer.country\nnope.really' }, 460, 0)
		await wire(page, source, 'output', fields, 'json')
		await zoomToFit(page)

		const outs = await portIds(page, fields, 'start')
		expect(outs).toEqual(expect.arrayContaining(['path:value', 'path:topic', 'path:customer_country', 'path:nope_really', 'rest']))

		await runNode(page, fields)
		const node = await nodeProps<{ lastValues: string; warnings: string | null; error: string | null }>(page, fields)
		expect(node.error).toBeNull()
		const values = JSON.parse(node.lastValues)
		expect(values['path:value']).toBe('hi')
		expect(values['path:customer_country']).toBe('NO')
		expect(values['path:nope_really']).toBe('')
		expect(node.warnings).toContain('"nope.really" not found')
	})

	test('a nested object/array path is extracted as JSON text, not [object Object]', async ({ page }) => {
		const source = await createNode(page, { type: 'prompt', text: '{"customer":{"name":"Ada","country":"NO"}}' }, { x: 0, y: 0 })
		const fields = await addDefault(page, 'json_fields', { paths: 'customer' }, 460, 0)
		await wire(page, source, 'output', fields, 'json')
		await zoomToFit(page)

		await runNode(page, fields)
		const node = await nodeProps<{ lastValues: string }>(page, fields)
		const values = JSON.parse(node.lastValues)
		expect(JSON.parse(values['path:customer'])).toEqual({ name: 'Ada', country: 'NO' })
	})
})

const PROSE_WITH_TABLE = [
	'Here are the findings from the latest survey:',
	'',
	'| Country | Share |',
	'| --- | --- |',
	'| Norway | 42 |',
	'| Sweden | 31 |',
	'',
	'Let me know if you would like a breakdown by age group.',
].join('\n')

test.describe('WP35 Part B: Extract from text', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('Agent-like prose -> Extract -> Chart: the table is found and charts without an upstream detour', async ({ page }) => {
		const prose = await createNode(page, { type: 'prompt', text: PROSE_WITH_TABLE }, { x: 0, y: 0 })
		const extract = await addDefault(page, 'extract', {}, 460, 0)
		const chart = await addDefault(page, 'chart', { xCol: 'Country', yCol: 'Share' }, 980, 0)
		await wire(page, prose, 'output', extract, 'text')
		await wire(page, extract, 'table', chart, 'data')
		await zoomToFit(page)

		await runNode(page, extract)
		const extracted = await nodeProps<{ lastTable: string; lastKind: string; error: string | null }>(page, extract)
		expect(extracted.error).toBeNull()
		expect(extracted.lastKind).toBe('table')
		expect(extracted.lastTable).toBe('Country,Share\nNorway,42\nSweden,31')

		await runNode(page, chart)
		const charted = await nodeProps<{ error: string | null }>(page, chart)
		expect(charted.error).toBeNull()
	})

	test('clean: strips %, thousands separators, and **bold** from the found table', async ({ page }) => {
		const prose = '| **Region** | **Revenue** |\n| --- | --- |\n| EU | $1,234,000 |\n| US | 56% |'
		const id = await createNode(page, { type: 'prompt', text: prose }, { x: 0, y: 0 })
		const extract = await addDefault(page, 'extract', { find: 'table', clean: true }, 460, 0)
		await wire(page, id, 'output', extract, 'text')
		await zoomToFit(page)

		await runNode(page, extract)
		const node = await nodeProps<{ lastTable: string }>(page, extract)
		expect(node.lastTable).toBe('Region,Revenue\nEU,$1234000\nUS,56')
	})
})

test.describe('WP35 Part F: Template', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('one var: port per {{name}}, filled from wired values', async ({ page }) => {
		const name = await createNode(page, { type: 'prompt', text: 'Ada' }, { x: 0, y: 0 })
		const total = await createNode(page, { type: 'prompt', text: '42' }, { x: 0, y: 220 })
		const tpl = await addDefault(page, 'template', { template: 'Hi {{name}}, total {{total}}.', escape: 'none' }, 460, 100)
		await wire(page, name, 'output', tpl, 'var:name')
		await wire(page, total, 'output', tpl, 'var:total')
		await zoomToFit(page)

		const ins = await portIds(page, tpl, 'end')
		expect(ins).toEqual(expect.arrayContaining(['var:name', 'var:total']))

		await runNode(page, tpl)
		const node = await nodeProps<{ lastOutput: string; warning: string | null }>(page, tpl)
		expect(node.warning).toBeNull()
		expect(node.lastOutput).toBe('Hi Ada, total 42.')
	})

	test('GAPS-18: escape: json keeps a hand-built JSON body valid, then posts it to HTTP (a local fixture server, not a mocked browser route — the HTTP card\'s request is made by the server, not the page)', async ({ page }) => {
		// The HTTP card's request goes out from the Hono server (server/http.ts), not from the
		// browser page, so `page.route` (which only intercepts the page's own fetches) cannot
		// see it. A tiny real local server, on its own port, is the right double here.
		let received: { body: string; contentType: string | undefined } | null = null
		const server: Server = createServer((req, res) => {
			const chunks: Buffer[] = []
			req.on('data', (c) => chunks.push(c))
			req.on('end', () => {
				received = { body: Buffer.concat(chunks).toString('utf8'), contentType: req.headers['content-type'] }
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end('{"ok":true}')
			})
		})
		await new Promise<void>((resolve) => server.listen(18843, '127.0.0.1', resolve))
		try {
			const input = await createNode(page, { type: 'prompt', text: 'Hello "world"\nLine2' }, { x: 0, y: 0 })
			const tpl = await addDefault(page, 'template', { template: '{"text": "{{input}}"}', escape: 'json' }, 460, 0)
			const http = await addDefault(
				page,
				'http',
				{ method: 'POST', url: 'http://127.0.0.1:18843/webhook', headers: 'Content-Type: application/json' },
				980,
				0
			)
			await wire(page, input, 'output', tpl, 'var:input')
			await wire(page, tpl, 'output', http, 'body')
			await zoomToFit(page)

			await runNode(page, tpl)
			const tplNode = await nodeProps<{ lastOutput: string }>(page, tpl)
			expect(() => JSON.parse(tplNode.lastOutput)).not.toThrow()

			await runNode(page, http)
			expect(received).not.toBeNull()
			expect(JSON.parse(received!.body)).toEqual({ text: 'Hello "world"\nLine2' })
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
	})
})
