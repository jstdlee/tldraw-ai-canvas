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

/**
 * WP45: the flow cards (If, Logic, Decision switch, Router, Merge, Sleep, For each, While) and
 * the Code card, run as small real flows. See docs/review/2026-11-14-control-flow.md.
 */

/** Count `execute` calls per card of one type (wraps that type's definition instance). */
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

/** Time a trivial task takes to get its turn on the page's main thread (a frozen page: long). */
async function mainThreadDelayMs(page: Page): Promise<number> {
	const started = Date.now()
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)))
	return Date.now() - started
}

const footerButton = (page: Page, id: string) => nodeLocator(page, id).locator('.NodeShape-footer > button').first()

test.describe('Control flow cards', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('If: the taken branch runs, the other stops; a card after a Merge of both runs once', async ({ page }) => {
		await countRuns(page, 'output')
		const p = await createDefaultNode(page, 'prompt', { text: 'yes please' }, { x: 0, y: 0 })
		const g = await createDefaultNode(page, 'if', { condition: 'contains', operand: 'yes' }, { x: 400, y: 0 })
		const a = await createDefaultNode(page, 'output', {}, { x: 800, y: -200 })
		const b = await createDefaultNode(page, 'output', {}, { x: 800, y: 200 })
		const m = await createDefaultNode(page, 'merge', { mode: 'first' }, { x: 1200, y: 0 })
		const o = await createDefaultNode(page, 'output', {}, { x: 1600, y: 0 })
		await zoomToFit(page)
		await wire(page, p, 'output', g, 'input')
		await wire(page, g, 'then', a, 'input')
		await wire(page, g, 'else', b, 'input')
		await wire(page, a, 'output', m, 'in1')
		await wire(page, b, 'output', m, 'in2')
		await wire(page, m, 'output', o, 'input')

		await runNode(page, g)
		expect((await nodeProps<{ lastValue: string }>(page, a)).lastValue).toBe('yes please')
		expect(await runsOf(page, b)).toBe(0)
		expect((await nodeProps<{ lastValue: string }>(page, o)).lastValue).toBe('yes please')
		expect(await runsOf(page, o)).toBe(1)

		await setNodeProps(page, p, { text: 'nope' })
		await setNodeProps(page, m, { mode: 'all' })
		await runNode(page, g)
		expect((await nodeProps<{ lastValue: string }>(page, b)).lastValue).toBe('nope')
		expect((await nodeProps<{ lastValue: string }>(page, o)).lastValue).toBe('nope')
		expect(await runsOf(page, o)).toBe(2)
	})

	test('If: both branches wired straight into one card run it once with the taken value', async ({ page }) => {
		await countRuns(page, 'output')
		const p = await createDefaultNode(page, 'prompt', { text: 'no' }, { x: 0, y: 0 })
		const g = await createDefaultNode(page, 'if', { condition: 'contains', operand: 'yes' }, { x: 400, y: 0 })
		const o = await createDefaultNode(page, 'output', {}, { x: 800, y: 0 })
		await zoomToFit(page)
		await wire(page, p, 'output', g, 'input')
		await wire(page, g, 'then', o, 'input')
		await wire(page, g, 'else', o, 'input')
		await runNode(page, g)
		expect((await nodeProps<{ lastValue: string }>(page, o)).lastValue).toBe('no')
		expect(await runsOf(page, o)).toBe(1)
	})

	test('If: else-if is a chain of If cards on "else"', async ({ page }) => {
		const n = await createDefaultNode(page, 'prompt', { text: '50' }, { x: 0, y: 0 })
		const g1 = await createDefaultNode(page, 'if', { condition: 'gt', operand: '100' }, { x: 400, y: 0 })
		const g2 = await createDefaultNode(page, 'if', { condition: 'gt', operand: '10' }, { x: 800, y: 300 })
		const big = await createDefaultNode(page, 'output', {}, { x: 1200, y: -200 })
		const mid = await createDefaultNode(page, 'output', {}, { x: 1200, y: 150 })
		const small = await createDefaultNode(page, 'output', {}, { x: 1200, y: 500 })
		await zoomToFit(page)
		await wire(page, n, 'output', g1, 'input')
		await wire(page, g1, 'then', big, 'input')
		await wire(page, g1, 'else', g2, 'input')
		await wire(page, g2, 'then', mid, 'input')
		await wire(page, g2, 'else', small, 'input')
		await runNode(page, g1)
		expect((await nodeProps<{ lastValue: string | null }>(page, big)).lastValue).toBeNull()
		expect((await nodeProps<{ lastValue: string | null }>(page, mid)).lastValue).toBe('50')
		expect((await nodeProps<{ lastValue: string | null }>(page, small)).lastValue).toBeNull()
		await expect(nodeLocator(page, g1).locator('.IfNode-sentence')).toHaveAttribute('title', /else if/)
	})

	test('If: an empty value fails a number test (it used to read as 0)', async ({ page }) => {
		const p = await createDefaultNode(page, 'prompt', { text: '' }, { x: 0, y: 0 })
		const g = await createDefaultNode(page, 'if', { condition: 'lt', operand: '5' }, { x: 400, y: 0 })
		await zoomToFit(page)
		await wire(page, p, 'output', g, 'input')
		await runNode(page, g)
		expect((await nodeProps<{ lastResult: boolean }>(page, g)).lastResult).toBe(false)
	})

	test('Logic: every operator with empty, number-in-text, true/"false" and JSON inputs', async ({ page }) => {
		const a = await createDefaultNode(page, 'prompt', { text: '' }, { x: 0, y: 0 })
		const b = await createDefaultNode(page, 'prompt', { text: '' }, { x: 0, y: 300 })
		const l = await createDefaultNode(page, 'logic', { op: 'and' }, { x: 400, y: 0 })
		await zoomToFit(page)
		await wire(page, a, 'output', l, 'a')
		await wire(page, b, 'output', l, 'b')
		const cases: [string, string, string, boolean][] = [
			['and', '', 'x', false],
			['or', '', 'x', true],
			['not', '', '', true],
			['and', '5', '1', true],
			['and', '0.0', '1', false],
			['xor', 'true', 'false', true],
			['nand', 'TRUE', 'yes', false],
			['or', '[]', '{}', false],
			['and', '{"a":1}', '[1]', true],
		]
		for (const [op, va, vb, expected] of cases) {
			await setNodeProps(page, a, { text: va })
			await setNodeProps(page, b, { text: vb })
			await setNodeProps(page, l, { op })
			await runNode(page, l)
			expect((await nodeProps<{ lastResult: boolean }>(page, l)).lastResult, `${op}(${va}, ${vb})`).toBe(expected)
		}
	})

	test('Decision switch: true/false, numbers, and a clear error for an empty decision', async ({ page }) => {
		const d = await createDefaultNode(page, 'prompt', { text: '' }, { x: 0, y: 0 })
		const s = await createDefaultNode(page, 'decision_switch', {}, { x: 400, y: 0 })
		await zoomToFit(page)
		await wire(page, d, 'output', s, 'decision')
		const chosen = async (mode: string, text: string) => {
			await setNodeProps(page, d, { text })
			await setNodeProps(page, s, { mode, lastOptions: null, lastDecisionJson: null })
			await runNode(page, s)
			const node = await nodeProps<{ lastDecisionJson: string | null }>(page, s)
			return node.lastDecisionJson ? JSON.parse(node.lastDecisionJson).chosen : null
		}
		expect(await chosen('auto', 'true')).toBe('yes')
		expect(await chosen('auto', 'false')).toBe('no')
		expect(await chosen('noul', '0.8')).toBe('yes')
		expect(await chosen('auto', '0.2')).toBe('band:low')
		expect(await chosen('auto', '{"a":0.1,"b":0.9}')).toBe('opt:b')

		await chosen('auto', '')
		expect((await getNodeRun(page, s))?.status).toBe('error')
		await expect(nodeLocator(page, s).locator('.NodeErrorBanner')).toContainText('The decision is empty')
		await chosen('noul', 'banana')
		await expect(nodeLocator(page, s).locator('.NodeErrorBanner')).toContainText('cannot read "banana"')
	})

	test('Merge: when no wired branch delivers, it is skipped, not shown as failed', async ({ page }) => {
		await countRuns(page, 'output')
		const d = await createDefaultNode(page, 'prompt', { text: 'c' }, { x: 0, y: 0 })
		const s = await createDefaultNode(page, 'decision_switch', { mode: 'choice', options: 'a\nb' }, { x: 400, y: 0 })
		const m = await createDefaultNode(page, 'merge', { mode: 'all' }, { x: 900, y: 0 })
		const o = await createDefaultNode(page, 'output', {}, { x: 1300, y: 0 })
		await zoomToFit(page)
		await wire(page, d, 'output', s, 'decision')
		await wire(page, s, 'opt:a', m, 'in1')
		await wire(page, s, 'opt:b', m, 'in2')
		await wire(page, m, 'output', o, 'input')
		await runNode(page, s)
		expect((await getNodeRun(page, s))?.status).toBe('ok')
		expect((await getNodeRun(page, m))?.status).toBeUndefined()
		expect(await runsOf(page, o)).toBe(0)
	})

	test('Sleep on the untaken branch never runs; Merge after it still runs once', async ({ page }) => {
		await countRuns(page, 'sleep')
		await countRuns(page, 'output')
		const p = await createDefaultNode(page, 'prompt', { text: 'yes' }, { x: 0, y: 0 })
		const g = await createDefaultNode(page, 'if', { condition: 'contains', operand: 'yes' }, { x: 400, y: 0 })
		const fast = await createDefaultNode(page, 'sleep', { ms: 10 }, { x: 800, y: -150 })
		const slow = await createDefaultNode(page, 'sleep', { ms: 3000 }, { x: 800, y: 150 })
		const m = await createDefaultNode(page, 'merge', { mode: 'all' }, { x: 1200, y: 0 })
		const o = await createDefaultNode(page, 'output', {}, { x: 1600, y: 0 })
		await zoomToFit(page)
		await wire(page, p, 'output', g, 'input')
		await wire(page, g, 'then', fast, 'input')
		await wire(page, g, 'else', slow, 'input')
		await wire(page, fast, 'output', m, 'in1')
		await wire(page, slow, 'output', m, 'in2')
		await wire(page, m, 'output', o, 'input')
		const started = Date.now()
		await runNode(page, g)
		expect(Date.now() - started).toBeLessThan(2500)
		expect(await runsOf(page, slow)).toBe(0)
		expect(await runsOf(page, o)).toBe(1)
		expect((await nodeProps<{ lastValue: string }>(page, o)).lastValue).toBe('yes')
	})

	test('Router: copies the input to every output, through a real input port', async ({ page }) => {
		const a = await createDefaultNode(page, 'prompt', { text: 'v' }, { x: 0, y: 0 })
		const r = await createDefaultNode(page, 'router', {}, { x: 400, y: 0 })
		const o = await createDefaultNode(page, 'output', {}, { x: 800, y: 0 })
		await zoomToFit(page)
		await wire(page, a, 'output', r, 'input')
		await wire(page, r, 'out_2', o, 'input')
		await runNode(page, r)
		expect((await nodeProps<{ lastValue: string }>(page, o)).lastValue).toBe('v')
		// A real input row (not a painted dot): it shows where its value comes from.
		await expect(nodeLocator(page, r).locator('.NodeRow').first()).toContainText('prompt → v')
	})
})

test.describe('For each', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('rows, range and collect; a changed loop body is not answered from the cache', async ({ page }) => {
		const l = await createDefaultNode(page, 'prompt', { text: 'a\nbb\nccc' }, { x: 0, y: 0 })
		const f = await createDefaultNode(page, 'for_each', { collect: 'lines' }, { x: 400, y: 0 })
		const c = await createDefaultNode(page, 'code', { lang: 'js', inputCount: 1, code: 'export default ({ a }) => a.toUpperCase()' }, { x: 900, y: 0 })
		await zoomToFit(page)
		await wire(page, l, 'output', f, 'list')
		await wire(page, f, 'item', c, 'in1')
		await wire(page, c, 'output', f, 'result')

		await runNode(page, f)
		expect((await nodeProps<{ lastResults: string }>(page, f)).lastResults).toBe('A\nBB\nCCC')
		// Only the body changed: the loop must run again, not return the cached result.
		await setNodeProps(page, c, { code: 'export default ({ a }) => a + "!"' })
		await runNode(page, f)
		expect((await nodeProps<{ lastResults: string }>(page, f)).lastResults).toBe('a!\nbb!\nccc!')

		await setNodeProps(page, f, { split: 'range', rangeFrom: 1, rangeTo: 3, collect: 'json' })
		await runNode(page, f)
		expect((await nodeProps<{ lastResults: string }>(page, f)).lastResults).toBe('["1!","2!","3!"]')

		await setNodeProps(page, l, { text: 'name,qty\npen,2\ncup,5' })
		await setNodeProps(page, f, { split: 'rows', collect: 'table', resultColumn: 'out' })
		await setNodeProps(page, c, { code: 'export default ({ a }) => JSON.parse(a).qty * 10' })
		await runNode(page, f)
		expect((await nodeProps<{ lastResults: string }>(page, f)).lastResults).toBe('name,qty,out\npen,2,20\ncup,5,50')
	})

	test('a repeated item gets its result too (a body cache hit used to drop it)', async ({ page }) => {
		const l = await createDefaultNode(page, 'prompt', { text: 'a\na\nb\na' }, { x: 0, y: 0 })
		const f = await createDefaultNode(page, 'for_each', { collect: 'lines' }, { x: 400, y: 0 })
		const c = await createDefaultNode(page, 'code', { lang: 'js', inputCount: 1, code: 'export default ({ a }) => a.toUpperCase()' }, { x: 900, y: 0 })
		await zoomToFit(page)
		await wire(page, l, 'output', f, 'list')
		await wire(page, f, 'item', c, 'in1')
		await wire(page, c, 'output', f, 'result')
		await runNode(page, f)
		expect((await nodeProps<{ lastResults: string }>(page, f)).lastResults).toBe('A\nA\nB\nA')
	})

	test('a range over the limit fails with a clear message', async ({ page }) => {
		const f = await createDefaultNode(page, 'for_each', { split: 'range', rangeFrom: 1, rangeTo: 20000 }, { x: 0, y: 0 })
		await zoomToFit(page)
		await runNode(page, f)
		await expect(nodeLocator(page, f).locator('.NodeErrorBanner')).toContainText('the limit is 10000')
	})

	test('nested For each: the inner body can read the outer item', async ({ page }) => {
		const l = await createDefaultNode(page, 'prompt', { text: 'x\ny' }, { x: 0, y: 0 })
		const outer = await createDefaultNode(page, 'for_each', { collect: 'lines' }, { x: 400, y: 0 })
		const inner = await createDefaultNode(page, 'for_each', { split: 'range', rangeFrom: 1, rangeTo: 3, collect: 'joined', joiner: '' }, { x: 900, y: 0 })
		const c = await createDefaultNode(page, 'code', { lang: 'js', inputCount: 2, code: 'export default ({ a, b }) => a + b' }, { x: 1400, y: 0 })
		await zoomToFit(page)
		await wire(page, l, 'output', outer, 'list')
		await wire(page, outer, 'item', inner, 'list')
		await wire(page, outer, 'item', c, 'in1')
		await wire(page, inner, 'item', c, 'in2')
		await wire(page, c, 'output', inner, 'result')
		await wire(page, inner, 'output', outer, 'result')
		await runNode(page, outer)
		expect((await nodeProps<{ lastResults: string; error: string | null }>(page, outer)).lastResults).toBe('x1x2x3\ny1y2y3')
	})

	test('a 10 000-item loop keeps the window responsive, shows progress, and stops at once on Stop', async ({ page }) => {
		const f = await createDefaultNode(page, 'for_each', { split: 'range', rangeFrom: 1, rangeTo: 10000, collect: 'lines' }, { x: 0, y: 0 })
		const g = await createDefaultNode(page, 'if', { condition: 'gt', operand: '5' }, { x: 500, y: 0 })
		await zoomToFit(page)
		await wire(page, f, 'item', g, 'input')
		await wire(page, g, 'then', f, 'result')

		await footerButton(page, f).click()
		await expect.poll(async () => (await nodeProps<{ progress: string | null }>(page, f)).progress ?? '').toMatch(/^\d+ \/ 10000$/)
		expect(await mainThreadDelayMs(page)).toBeLessThan(500)
		const stopAt = Date.now()
		await footerButton(page, f).click() // Stop
		await waitForRunIdle(page, 3_000)
		expect(Date.now() - stopAt).toBeLessThan(2000)
		expect((await nodeProps<{ progress: string }>(page, f)).progress).toMatch(/^stopped at \d+ \/ 10000$/)
	})

	test('Stop during a Sleep in the loop body stops the loop at once', async ({ page }) => {
		const f = await createDefaultNode(page, 'for_each', { split: 'range', rangeFrom: 1, rangeTo: 20 }, { x: 0, y: 0 })
		const s = await createDefaultNode(page, 'sleep', { ms: 1000 }, { x: 500, y: 0 })
		await zoomToFit(page)
		await wire(page, f, 'item', s, 'input')
		await wire(page, s, 'output', f, 'result')
		await footerButton(page, f).click()
		await expect.poll(async () => (await getNodeRun(page, s))?.status).toBe('running')
		const stopAt = Date.now()
		await footerButton(page, f).click()
		await waitForRunIdle(page, 3_000)
		expect(Date.now() - stopAt).toBeLessThan(800)
		expect((await nodeProps<{ progress: string }>(page, f)).progress).toMatch(/^stopped at 0 \/ 20$/)
	})
})

test.describe('While', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	async function doubling(page: Page, whileProps: Record<string, unknown>) {
		const start = await createDefaultNode(page, 'number', { value: 3 }, { x: 0, y: 0 })
		const w = await createDefaultNode(page, 'while', whileProps, { x: 400, y: 0 })
		const c = await createDefaultNode(page, 'code', { lang: 'js', inputCount: 2, code: 'export default ({ a, b }) => Number(a) * 2' }, { x: 900, y: 0 })
		const out = await createDefaultNode(page, 'output', {}, { x: 900, y: 500 })
		const count = await createDefaultNode(page, 'output', {}, { x: 1300, y: 500 })
		await zoomToFit(page)
		await wire(page, start, 'output', w, 'initial')
		await wire(page, w, 'value', c, 'in1')
		await wire(page, w, 'iteration', c, 'in2')
		await wire(page, c, 'output', w, 'result')
		await wire(page, w, 'output', out, 'input')
		await wire(page, w, 'count', count, 'input')
		return { w, c, out, count }
	}

	test('runs the body while the condition holds; outputs the last value and the count', async ({ page }) => {
		const { w, out, count } = await doubling(page, { condition: 'lt', operand: '1000' })
		await runNode(page, w)
		expect((await nodeProps<{ lastValue: string }>(page, out)).lastValue).toBe('1536')
		expect(String((await nodeProps<{ lastValue: unknown }>(page, count)).lastValue)).toBe('9')
		expect((await nodeProps<{ progress: string }>(page, w)).progress).toBe('9 done')
	})

	test('ends at Max iterations, and the body sees the iteration number', async ({ page }) => {
		const { w, c } = await doubling(page, { condition: 'truthy', maxIterations: 4 })
		await setNodeProps(page, c, { code: 'export default ({ a, b }) => a + "," + b' })
		await runNode(page, w)
		const node = await nodeProps<{ lastValue: string; lastCount: number; progress: string }>(page, w)
		expect(node.lastValue).toBe('3,1,2,3,4')
		expect(node.lastCount).toBe(4)
		expect(node.progress).toContain('Max iterations (4)')
	})

	test('a body error stops the loop with the iteration in the message', async ({ page }) => {
		const { w, c } = await doubling(page, { condition: 'truthy', maxIterations: 50 })
		await setNodeProps(page, c, { code: 'export default ({ a, b }) => {\n  if (b === "3") throw new Error("bad three")\n  return a\n}' })
		await runNode(page, w)
		expect((await getNodeRun(page, w))?.status).toBe('error')
		await expect(nodeLocator(page, w).locator('.NodeErrorBanner')).toContainText('Iteration 3')
		await expect(nodeLocator(page, w).locator('.NodeErrorBanner')).toContainText('bad three')
	})

	test('a long While keeps the window responsive and stops at once on Stop', async ({ page }) => {
		const w = await createDefaultNode(page, 'while', { condition: 'truthy', maxIterations: 10000 }, { x: 0, y: 0 })
		const t = await createDefaultNode(page, 'prompt', { text: 'go' }, { x: -400, y: 0 })
		const g = await createDefaultNode(page, 'if', { condition: 'truthy' }, { x: 500, y: 0 })
		await zoomToFit(page)
		await wire(page, t, 'output', w, 'initial')
		await wire(page, w, 'value', g, 'input')
		await wire(page, g, 'then', w, 'result')
		await footerButton(page, w).click()
		await expect.poll(async () => (await nodeProps<{ progress: string | null }>(page, w)).progress ?? '').toMatch(/^iteration \d+ \/ max 10000$/)
		expect(await mainThreadDelayMs(page)).toBeLessThan(500)
		const stopAt = Date.now()
		await footerButton(page, w).click()
		await waitForRunIdle(page, 3_000)
		expect(Date.now() - stopAt).toBeLessThan(2000)
		expect((await getNodeRun(page, w))?.status).toBe('stopped')
	})
})

test.describe('Code card', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('inputs, console.log, objects and tables, and the result in the next card', async ({ page }) => {
		const a = await createDefaultNode(page, 'prompt', { text: 'hello' }, { x: 0, y: 0 })
		const c = await createDefaultNode(
			page,
			'code',
			{
				lang: 'ts',
				inputCount: 1,
				outputCount: 2,
				code: 'export default function run({ a }: Record<string, string>) {\n  console.log("got", a)\n  return { output: { n: a.length }, out2: [{ x: 1 }, { x: 2 }] }\n}\n',
			},
			{ x: 400, y: 0 }
		)
		const o = await createDefaultNode(page, 'output', {}, { x: 900, y: 0 })
		await zoomToFit(page)
		await wire(page, a, 'output', c, 'in1')
		await wire(page, c, 'out2', o, 'input')
		await runNode(page, c)
		const node = await nodeProps<{ logs: string; lastOutputs: string; error: string | null }>(page, c)
		expect(node.error).toBeNull()
		expect(node.logs).toBe('got hello')
		expect(JSON.parse(JSON.parse(node.lastOutputs).output)).toEqual({ n: 5 })
		expect(JSON.parse((await nodeProps<{ lastValue: string }>(page, o)).lastValue)).toEqual([{ x: 1 }, { x: 2 }])
	})

	test('errors show the line number and the message in the banner', async ({ page }) => {
		const a = await createDefaultNode(page, 'prompt', { text: 'hello' }, { x: 0, y: 0 })
		const c = await createDefaultNode(page, 'code', { lang: 'ts', inputCount: 1, code: 'export default function run({ a }: any) {\n  const x = 1\n  return a.nope.deeper\n}\n' }, { x: 400, y: 0 })
		await zoomToFit(page)
		await wire(page, a, 'output', c, 'in1')
		const banner = nodeLocator(page, c).locator('.NodeErrorBanner')

		await runNode(page, c)
		expect((await getNodeRun(page, c))?.status).toBe('error')
		await expect(banner).toContainText("Line 3: Cannot read properties of undefined (reading 'deeper')")

		await setNodeProps(page, c, { code: 'export default function run() {\n  const x = \n}\n' })
		await runNode(page, c)
		await expect(banner).toContainText('Line 3: Syntax error')

		await setNodeProps(page, c, { code: 'export default function run() {\n  console.log("nothing back")\n}\n' })
		await runNode(page, c)
		await expect(banner).toContainText('The code returned nothing')
	})

	test('an endless loop stops at the Timeout and never freezes the window', async ({ page }) => {
		const c = await createDefaultNode(page, 'code', { lang: 'js', timeoutSec: 1, code: 'export default function run() {\n  while (true) {}\n}\n' }, { x: 0, y: 0 })
		await zoomToFit(page)
		const started = Date.now()
		await footerButton(page, c).click()
		await expect.poll(async () => (await getNodeRun(page, c))?.status).toBe('running')
		expect(await mainThreadDelayMs(page)).toBeLessThan(500)
		await waitForRunIdle(page, 5_000)
		expect(Date.now() - started).toBeLessThan(3000)
		await expect(nodeLocator(page, c).locator('.NodeErrorBanner')).toContainText('longer than 1 s')
	})

	test('Stop ends an endless loop at once', async ({ page }) => {
		const c = await createDefaultNode(page, 'code', { lang: 'js', code: 'export default function run() {\n  while (true) {}\n}\n' }, { x: 0, y: 0 })
		await zoomToFit(page)
		await footerButton(page, c).click()
		await expect.poll(async () => (await getNodeRun(page, c))?.status).toBe('running')
		const stopAt = Date.now()
		await footerButton(page, c).click()
		await expect.poll(async () => (await getNodeRun(page, c))?.status, { timeout: 2_000 }).toBe('stopped')
		expect(Date.now() - stopAt).toBeLessThan(1000)
		expect((await nodeProps<{ error: string | null }>(page, c)).error).toBeNull()
	})

	test('Python offline: a clear message about the one-time download, not a hang', async ({ page }) => {
		await page.route('**/cdn.jsdelivr.net/**', (route) => route.abort())
		const a = await createDefaultNode(page, 'prompt', { text: 'hello world' }, { x: 0, y: 0 })
		const c = await createDefaultNode(page, 'code', { lang: 'py', inputCount: 1, code: 'output = inputs["a"].upper()\n' }, { x: 400, y: 0 })
		await zoomToFit(page)
		await wire(page, a, 'output', c, 'in1')
		const started = Date.now()
		await runNode(page, c)
		expect(Date.now() - started).toBeLessThan(10_000)
		await expect(nodeLocator(page, c).locator('.NodeErrorBanner')).toContainText('one-time download')
	})

	// Downloads Pyodide (~10 MB): opt-in only, the suite never needs the network by default.
	test('Python online: print, outputs, an error line, and a loaded runtime kept between runs', async ({ page }) => {
		test.skip(!process.env.E2E_PYTHON_ONLINE, 'set E2E_PYTHON_ONLINE=1 to run (downloads Pyodide)')
		test.setTimeout(180_000)
		const a = await createDefaultNode(page, 'prompt', { text: 'hello world' }, { x: 0, y: 0 })
		const c = await createDefaultNode(page, 'code', { lang: 'py', inputCount: 1, code: 'print("hi")\noutput = {"up": inputs["a"].upper()}\n' }, { x: 400, y: 0 })
		await zoomToFit(page)
		await wire(page, a, 'output', c, 'in1')
		await runNode(page, c, 150_000)
		let node = await nodeProps<{ logs: string; lastOutputs: string; error: string | null }>(page, c)
		expect(node.error).toBeNull()
		expect(node.logs).toBe('hi')
		expect(JSON.parse(JSON.parse(node.lastOutputs).output)).toEqual({ up: 'HELLO WORLD' })

		await setNodeProps(page, c, { code: 'print("before")\nx = nope\n' })
		const started = Date.now()
		await runNode(page, c, 30_000)
		expect(Date.now() - started).toBeLessThan(5_000) // runtime already loaded
		node = await nodeProps(page, c)
		expect(node.error).toContain("Line 2: NameError: name 'nope' is not defined")
		expect(node.logs).toBe('before')

		await setNodeProps(page, c, { code: 'while True:\n    pass\n', timeoutSec: 1 })
		await runNode(page, c, 30_000)
		expect((await nodeProps<{ error: string }>(page, c)).error).toContain('longer than 1 s')
	})
})
