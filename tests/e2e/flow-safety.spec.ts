import { expect, Page, test } from '@playwright/test'
import {
	createDefaultNode,
	getNodeRun,
	gotoApp,
	nodeLocator,
	nodeProps,
	runNode,
	setNodeProps,
	waitForRunIdle,
	wire,
	zoomToFit,
} from './helpers'

/** WP49: Try / catch, Ask user, Set / Get variable, Notify, offline Python, HTTP selector
 * extract, and chart export. */

async function countRuns(page: Page, type: string) {
	await page.evaluate(async (type) => {
		// @ts-expect-error dev-server import, only resolvable at runtime
		const mod = await import('/client/pipeline/nodes/definitionStore.ts')
		const def = mod.getNodeDefinition((window as any).editor, type)
		const w = window as any
		w.__runs = w.__runs ?? {}
		const original = def.execute.bind(def)
		def.execute = async (shape: { id: string }, ...rest: unknown[]) => {
			w.__runs[shape.id] = (w.__runs[shape.id] ?? 0) + 1
			return original(shape, ...rest)
		}
	}, type)
}
const runsOf = (page: Page, id: string) => page.evaluate((id) => (window as any).__runs?.[id] ?? 0, id)

const footerButton = (page: Page, id: string) => nodeLocator(page, id).locator('.NodeShape-footer > button').first()

const THROWS = 'export default function run({ a }: any) {\n  throw new Error("body broke on " + a)\n}\n'
const UPPER = 'export default function run({ a }: any) {\n  return String(a).toUpperCase()\n}\n'

/** prompt → try_catch, body → code → result, output / error → two Output cards. */
async function tryFlow(page: Page, code: string, tryProps: Record<string, unknown> = {}) {
	const p = await createDefaultNode(page, 'prompt', { text: 'abc' }, { x: 0, y: 0 })
	const t = await createDefaultNode(page, 'try_catch', { waitSec: 0, ...tryProps }, { x: 400, y: 0 })
	const c = await createDefaultNode(page, 'code', { lang: 'ts', inputCount: 1, code }, { x: 850, y: -250 })
	const ok = await createDefaultNode(page, 'output', {}, { x: 850, y: 250 })
	const err = await createDefaultNode(page, 'output', {}, { x: 850, y: 550 })
	await zoomToFit(page)
	await wire(page, p, 'output', t, 'input')
	await wire(page, t, 'body', c, 'in1')
	await wire(page, c, 'output', t, 'result')
	await wire(page, t, 'output', ok, 'input')
	await wire(page, t, 'error', err, 'input')
	return { p, t, c, ok, err }
}

/** prompt → ask_user → two Output cards; starts the run but does not wait for it. */
async function askFlow(page: Page, props: Record<string, unknown>) {
	const p = await createDefaultNode(page, 'prompt', { text: 'the draft' }, { x: 0, y: 0 })
	const a = await createDefaultNode(page, 'ask_user', props, { x: 400, y: 0 })
	const yes = await createDefaultNode(page, 'output', {}, { x: 900, y: -150 })
	const no = await createDefaultNode(page, 'output', {}, { x: 900, y: 250 })
	await zoomToFit(page)
	await wire(page, p, 'output', a, 'input')
	await wire(page, a, 'answer', yes, 'input')
	await wire(page, a, 'rejected', no, 'input')
	await footerButton(page, a).click()
	await expect(nodeLocator(page, a).locator('.AskUser-area.is-waiting')).toBeVisible()
	return { p, a, yes, no }
}

const lastValue = async (page: Page, id: string) => (await nodeProps<{ lastValue: string | null }>(page, id)).lastValue

test.describe('Flow safety cards', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('Try / catch: a failing Code card in the body takes the error path', async ({ page }) => {
		await countRuns(page, 'output')
		const { t, c, ok, err } = await tryFlow(page, THROWS)
		await runNode(page, t)
		expect(await lastValue(page, err)).toContain('body broke on abc')
		expect(await runsOf(page, ok)).toBe(0)
		const node = await nodeProps<{ lastOutcome: string; lastAttempts: number }>(page, t)
		expect(node.lastOutcome).toBe('error')
		expect(node.lastAttempts).toBe(1)
		// The body card shows its own error; the Try / catch card itself did not fail.
		expect((await getNodeRun(page, c))?.status).toBe('error')
		await expect(nodeLocator(page, c).locator('.NodeErrorBanner')).toContainText('body broke')
		expect((await getNodeRun(page, t))?.status).toBe('ok')
	})

	test('Try / catch: a good body takes the output path', async ({ page }) => {
		await countRuns(page, 'output')
		const { t, ok, err } = await tryFlow(page, UPPER)
		await runNode(page, t)
		expect(await lastValue(page, ok)).toBe('ABC')
		expect(await runsOf(page, err)).toBe(0)
		expect((await nodeProps<{ lastOutcome: string }>(page, t)).lastOutcome).toBe('ok')
	})

	test('Try / catch: retries N times before the error path', async ({ page }) => {
		await countRuns(page, 'code')
		const { t, c, err } = await tryFlow(page, THROWS, { retries: 2, waitSec: 0.2 })
		const started = Date.now()
		await runNode(page, t)
		expect(await runsOf(page, c)).toBe(3)
		expect(Date.now() - started).toBeGreaterThanOrEqual(400)
		expect((await nodeProps<{ lastAttempts: number; progress: string }>(page, t)).lastAttempts).toBe(3)
		expect(await lastValue(page, err)).toContain('body broke')
	})

	test('Ask user: approve passes the input on; a toast offers "Go to card"', async ({ page }) => {
		const { a, yes, no } = await askFlow(page, { question: 'Send {{input}}?', answerType: 'approve' })
		await expect(nodeLocator(page, a).locator('.AskUser-question')).toHaveText('Send the draft?')
		await expect(page.locator('.tlui-toast__title', { hasText: 'A card is waiting for your answer' })).toBeVisible()
		await expect(page.getByRole('button', { name: 'Go to card' })).toBeVisible()
		await nodeLocator(page, a).getByRole('button', { name: 'Approve', exact: true }).click()
		await waitForRunIdle(page)
		expect(await lastValue(page, yes)).toBe('the draft')
		expect(await lastValue(page, no)).toBeNull()
		await expect(page.locator('.tlui-toast__title', { hasText: 'A card is waiting for your answer' })).toHaveCount(0)
	})

	test('Ask user: reject sends the input to "rejected" only', async ({ page }) => {
		await countRuns(page, 'output')
		const { a, yes, no } = await askFlow(page, { answerType: 'approve' })
		await nodeLocator(page, a).getByRole('button', { name: 'Reject', exact: true }).click()
		await waitForRunIdle(page)
		expect(await lastValue(page, no)).toBe('the draft')
		expect(await runsOf(page, yes)).toBe(0)
	})

	test('Ask user: choose one of the options', async ({ page }) => {
		const { a, yes } = await askFlow(page, { answerType: 'choose', options: 'Red\nBlue\n' })
		await nodeLocator(page, a).getByRole('button', { name: 'Blue' }).click()
		await waitForRunIdle(page)
		expect(await lastValue(page, yes)).toBe('Blue')
	})

	test('Ask user: free text', async ({ page }) => {
		const { a, yes } = await askFlow(page, { answerType: 'text', question: 'Your name?' })
		await nodeLocator(page, a).getByPlaceholder('Type your answer').fill('Ada')
		await nodeLocator(page, a).getByRole('button', { name: 'Send' }).click()
		await waitForRunIdle(page)
		expect(await lastValue(page, yes)).toBe('Ada')
	})

	test('Ask user: Stop cancels the wait', async ({ page }) => {
		await countRuns(page, 'output')
		const { a, yes, no } = await askFlow(page, { answerType: 'approve' })
		await footerButton(page, a).click()
		await expect.poll(async () => (await getNodeRun(page, a))?.status, { timeout: 3_000 }).toBe('stopped')
		await waitForRunIdle(page)
		await expect(nodeLocator(page, a).locator('.AskUser-area.is-waiting')).toHaveCount(0)
		expect(await runsOf(page, yes)).toBe(0)
		expect(await runsOf(page, no)).toBe(0)
	})

	test('Set then Get across two branches: Get waits for the Set', async ({ page }) => {
		const p = await createDefaultNode(page, 'prompt', { text: 'first' }, { x: 0, y: 0 })
		const slow = await createDefaultNode(page, 'sleep', { ms: 700 }, { x: 400, y: -200 })
		const s = await createDefaultNode(page, 'set_variable', { name: 'shared' }, { x: 800, y: -200 })
		const g = await createDefaultNode(page, 'get_variable', { name: 'shared' }, { x: 400, y: 250 })
		const o = await createDefaultNode(page, 'output', {}, { x: 800, y: 250 })
		await zoomToFit(page)
		await wire(page, p, 'output', slow, 'input')
		await wire(page, slow, 'output', s, 'value')
		await wire(page, p, 'output', g, 'after')
		await wire(page, g, 'output', o, 'input')
		await runNode(page, p)
		expect(await lastValue(page, o)).toBe('first')
		await setNodeProps(page, p, { text: 'second' })
		await runNode(page, p)
		expect(await lastValue(page, o)).toBe('second')
		// Stored in the document, so it saves (and undoes) with the canvas.
		const stored = await page.evaluate(() => (window as any).editor.getDocumentSettings().meta.variables)
		expect(stored.shared).toBe('second')
		await expect(nodeLocator(page, g).locator('.Variable-current')).toContainText('second')
	})

	test('Notify: shows a toast and a desktop notification, passes its input on', async ({ page }) => {
		await page.addInitScript(() => {
			const w = window as any
			w.__notes = []
			class FakeNotification {
				static permission = 'granted'
				static requestPermission = async () => 'granted'
				constructor(title: string, options: { body?: string }) {
					w.__notes.push({ title, body: options?.body })
				}
			}
			w.Notification = FakeNotification
		})
		await gotoApp(page)
		const p = await createDefaultNode(page, 'prompt', { text: '42 rows' }, { x: 0, y: 0 })
		const n = await createDefaultNode(page, 'notify', { title: 'Import done', message: 'Loaded {{input}}', sound: false }, { x: 400, y: 0 })
		const o = await createDefaultNode(page, 'output', {}, { x: 850, y: 0 })
		await zoomToFit(page)
		await wire(page, p, 'output', n, 'input')
		await wire(page, n, 'output', o, 'input')
		await runNode(page, n)
		await expect(page.locator('.tlui-toast__title', { hasText: 'Import done' })).toBeVisible()
		await expect(page.locator('.tlui-toast__description', { hasText: 'Loaded 42 rows' })).toBeVisible()
		await expect.poll(() => page.evaluate(() => (window as any).__notes)).toEqual([{ title: 'Import done', body: 'Loaded 42 rows' }])
		expect(await lastValue(page, o)).toBe('42 rows')
	})

	test('Python runs with cdn.jsdelivr.net blocked (bundled Pyodide)', async ({ page }) => {
		test.setTimeout(90_000)
		await page.route('**/cdn.jsdelivr.net/**', (route) => route.abort())
		const a = await createDefaultNode(page, 'prompt', { text: 'hello world' }, { x: 0, y: 0 })
		const c = await createDefaultNode(page, 'code', { lang: 'py', inputCount: 1, code: 'print("hi")\noutput = inputs["a"].upper()\n' }, { x: 400, y: 0 })
		await zoomToFit(page)
		await wire(page, a, 'output', c, 'in1')
		await runNode(page, c, 80_000)
		const node = await nodeProps<{ logs: string; lastOutputs: string; error: string | null }>(page, c)
		expect(node.error).toBeNull()
		expect(node.logs).toBe('hi')
		expect(JSON.parse(node.lastOutputs).output).toBe('HELLO WORLD')
	})

	test('HTTP: CSS selector extract returns a table of texts and links', async ({ page }) => {
		const url = await page.evaluate(() => `${location.origin}/tests/fixtures/scrape-page.html`)
		const h = await createDefaultNode(
			page,
			'http',
			{ method: 'GET', url, extractText: true, extract: 'selector', selector: '#items a.name', attribute: 'href' },
			{ x: 0, y: 0 }
		)
		await zoomToFit(page)
		await runNode(page, h)
		const node = await nodeProps<{ lastText: string; error: string | null }>(page, h)
		expect(node.error).toBeNull()
		const origin = new URL(url).origin
		expect(node.lastText.trim().split(/\r?\n/)).toEqual(['text,href', `Mug,${origin}/p/1`, `Lamp,${origin}/p/2`])
	})

	test('Chart: Save PNG downloads a file; Place on canvas adds a linked image', async ({ page }) => {
		const ch = await createDefaultNode(page, 'chart', { text: 'name,score\na,1\nb,3', xCol: 'name', yCol: 'score', title: 'Scores' }, { x: 0, y: 0 })
		await zoomToFit(page)
		const card = nodeLocator(page, ch)
		const [download] = await Promise.all([page.waitForEvent('download'), card.getByTitle('Save PNG').click()])
		expect(download.suggestedFilename()).toMatch(/^scores-.*\.png$/)
		await card.getByTitle('Place on canvas').click()
		await expect
			.poll(() => page.evaluate(() => (window as any).editor.getCurrentPageShapes().filter((s: any) => s.type === 'image').length))
			.toBe(1)
		const derived = await page.evaluate(
			() => (window as any).editor.getCurrentPageShapes().filter((s: any) => s.type === 'arrow' && s.meta?.derived).length
		)
		expect(derived).toBe(1)
	})
})
