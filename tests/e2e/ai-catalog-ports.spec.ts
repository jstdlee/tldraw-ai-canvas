import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

/**
 * WP38 (GAPS-08/R, FLOW-07): the "Build with AI" catalogue (`shared/nodeSpecs.ts` /
 * `shared/nodeCatalog.ts`) must describe the real ports of every visible card — the ones from
 * each definition's own `getPorts()`, not a stale or guessed list — for both the default state
 * and the documented dynamic ports (`opt:<slug>`, `var:<name>`, `path:<slug>`, `row:<column>`,
 * `in1..N`, JEV yes/no, Load image url, Code in1..). A mismatch here is exactly the class of bug
 * that let the AI "successfully" plan a wire that points at no real port (GAPS-08), or refuse a
 * wire the UI itself allows.
 *
 * This test creates each visible node type's default instance, plus one or more prop variants
 * that exercise its dynamic-port family, reads the *real* ports straight from the live
 * definitions (`getNodeTypePorts`), and fails on any difference from `NODE_SPECS`. Fix a
 * mismatch in `shared/nodeSpecs.ts`/`shared/nodeCatalog.ts` (the catalogue), or in the
 * definition itself only when the real port is actually wrong.
 */

/** Prop patches that make a type's dynamic-port family show up, beyond its bare getDefault(). */
const VARIANTS: Record<string, Record<string, unknown>[]> = {
	// Choice mode: one `opt:<slug>` per option, plus "other". Score mode: one `band:<slug>`
	// per band. (Default/auto resolves to yes/no/unsure before any run.)
	decision_switch: [{}, { mode: 'choice', options: 'short\nformal\nfunny' }, { mode: 'score' }],
	// Split: "table rows" gives one `row:<column>` output per remembered column.
	for_each: [{}, { split: 'rows', rowColumns: ['id', 'product', 'review'] }],
	// in1..in20 / output, out2..out20, sized by Input count / Output count.
	code: [{}, { inputCount: 4, outputCount: 3 }],
	// Task's own {{vars}} get var:<name> ports, same mechanism as Web search/Generate text.
	agent: [{}, { task: 'Summarize {{topic}} in a {{tone}} tone.' }],
	// "extra" (the second table) is hidden unless the chosen op actually uses one (shared/
	// nodeSpecs.ts and fieldVisibility.ts call this out as a declared-but-conditional port,
	// same pattern as decision_switch/jev's mode-dependent ports — not a slug-keyed dynamic
	// family, so it's exercised here instead of via DYNAMIC_PORTS).
	table: [{}, { op: 'append' }],
	// "url" is hidden unless Source is "url" (default: upload) — same declared-but-conditional
	// pattern as table's "extra" above.
	file_in: [{}, { source: 'url' }],
}

function variantsFor(type: string): Record<string, unknown>[] {
	return VARIANTS[type] ?? [{}]
}

interface RealPort {
	id: string
	dataType: string
	terminal: 'start' | 'end'
}

test('AI catalog ports match the real node definitions, default state and dynamic variants', async ({ page }) => {
	await gotoApp(page)

	const visibleTypes: string[] = await page.evaluate(async () => {
		// @ts-expect-error runtime import through the dev server
		const specs = await import('/shared/nodeSpecs.ts')
		return Object.keys(specs.NODE_SPECS).filter((type: string) => !specs.NODE_SPECS[type].hidden)
	})
	expect(visibleTypes.length).toBeGreaterThan(30)

	const problems: string[] = []
	let x = 0
	for (const type of visibleTypes) {
		const variants = variantsFor(type)
		const realIn = new Map<string, string>()
		const realOut = new Map<string, string>()
		for (const patch of variants) {
			x += 500
			const ports: RealPort[] | { error: string } = await page.evaluate(
				async ({ type, patch, x }) => {
					// @ts-expect-error runtime import through the dev server
					const store = await import('/client/pipeline/nodes/definitionStore.ts')
					// @ts-expect-error runtime import through the dev server
					const nt = await import('/client/pipeline/nodes/nodeTypes.tsx')
					const editor = (window as any).editor
					const def = store.getNodeDefinition(editor, type)
					let node: any
					try {
						node = { ...def.getDefault(), ...patch, type }
					} catch (e) {
						return { error: String(e) }
					}
					const id = `shape:ai-cat-${type}-${x}`
					try {
						editor.createShape({ id, type: 'node', x, y: 0, props: { node, fontSize: 16 } })
					} catch (e) {
						return { error: String(e) }
					}
					await new Promise((r) => setTimeout(r, 30))
					const shape = editor.getShape(id)
					const ports = nt.getNodeTypePorts(editor, shape)
					return Object.values(ports).map((p: any) => ({ id: p.id, dataType: p.dataType, terminal: p.terminal }))
				},
				{ type, patch, x }
			)
			if (!Array.isArray(ports)) {
				problems.push(`${type} ${JSON.stringify(patch)}: failed to create — ${(ports as { error: string }).error}`)
				continue
			}
			for (const p of ports) {
				if (p.terminal === 'end' && !p.id.startsWith('field:')) realIn.set(p.id, p.dataType)
				if (p.terminal === 'start') realOut.set(p.id, p.dataType)
			}
		}

		const { specInIds, specOutIds, specInTypes, specOutTypes }: {
			specInIds: string[]
			specOutIds: string[]
			specInTypes: Record<string, string>
			specOutTypes: Record<string, string>
		} = await page.evaluate(async (type) => {
			// @ts-expect-error runtime import through the dev server
			const specs = await import('/shared/nodeSpecs.ts')
			const spec = specs.NODE_SPECS[type]
			return {
				specInIds: spec.inputs.map((p: any) => p.id),
				specOutIds: spec.outputs.map((p: any) => p.id),
				specInTypes: Object.fromEntries(spec.inputs.map((p: any) => [p.id, p.dataType])),
				specOutTypes: Object.fromEntries(spec.outputs.map((p: any) => [p.id, p.dataType])),
			}
		}, type)

		const isDynamic = async (portId: string, direction: 'in' | 'out') =>
			page.evaluate(
				async ({ type, portId, direction }) => {
					// @ts-expect-error runtime import through the dev server
					const specs = await import('/shared/nodeSpecs.ts')
					return specs.findDynamicPort(type, portId, direction)
				},
				{ type, portId, direction }
			)

		const staticRealIn: string[] = []
		for (const id of realIn.keys()) if (!(await isDynamic(id, 'in'))) staticRealIn.push(id)
		const staticRealOut: string[] = []
		for (const id of realOut.keys()) if (!(await isDynamic(id, 'out'))) staticRealOut.push(id)

		// "Missing" only looks at the non-dynamic real ports: a real port matching a DYNAMIC_PORTS
		// rule (even one that also happens to exist at the default state, like code's in1/in2 or
		// merge's in1/in2) is explained by that rule, not expected as a literal spec entry.
		// "Extra" still requires a spec-declared id to be a literal real port in some variant,
		// dynamic-classified or not — a spec id that never materializes anywhere is just wrong.
		const missingFromSpecIn = staticRealIn.filter((id) => !specInIds.includes(id))
		const extraInSpecIn = specInIds.filter((id) => !realIn.has(id))
		const missingFromSpecOut = staticRealOut.filter((id) => !specOutIds.includes(id))
		const extraInSpecOut = specOutIds.filter((id) => !realOut.has(id))
		if (missingFromSpecIn.length) problems.push(`${type}: real input(s) [${missingFromSpecIn.join(', ')}] missing from NODE_SPECS.inputs`)
		if (extraInSpecIn.length) problems.push(`${type}: NODE_SPECS.inputs [${extraInSpecIn.join(', ')}] are not real ports (default + variants)`)
		if (missingFromSpecOut.length) problems.push(`${type}: real output(s) [${missingFromSpecOut.join(', ')}] missing from NODE_SPECS.outputs`)
		if (extraInSpecOut.length) problems.push(`${type}: NODE_SPECS.outputs [${extraInSpecOut.join(', ')}] are not real ports (default + variants)`)

		for (const id of specInIds) {
			const real = realIn.get(id)
			if (real !== undefined && real !== specInTypes[id]) problems.push(`${type}.${id}: spec input dataType "${specInTypes[id]}" vs real "${real}"`)
		}
		for (const id of specOutIds) {
			const real = realOut.get(id)
			if (real !== undefined && real !== specOutTypes[id]) problems.push(`${type}.${id}: spec output dataType "${specOutTypes[id]}" vs real "${real}"`)
		}

		// Dynamic real ports found must match their declared DYNAMIC_PORTS dataType.
		for (const [id, dt] of realIn) {
			const rule = await isDynamic(id, 'in')
			if (rule && dt !== rule.dataType) problems.push(`${type}.${id}: dynamic input dataType "${rule.dataType}" vs real "${dt}"`)
		}
		for (const [id, dt] of realOut) {
			const rule = await isDynamic(id, 'out')
			if (rule && dt !== rule.dataType) problems.push(`${type}.${id}: dynamic output dataType "${rule.dataType}" vs real "${dt}"`)
		}
	}

	expect(problems, problems.join('\n')).toEqual([])
})

// Explicit, named checks for the exact dynamic-port families WP38 calls out — a focused
// regression test, independent of the sweep above, so a future change to one family's shape
// (not just presence) is caught with a clear message pointing at the family, not a type.
test.describe('named dynamic-port families', () => {
	async function portsOf(page: import('@playwright/test').Page, type: string, patch: Record<string, unknown>, tag: string) {
		return page.evaluate(
			async ({ type, patch, tag }) => {
				// @ts-expect-error runtime import through the dev server
				const store = await import('/client/pipeline/nodes/definitionStore.ts')
				// @ts-expect-error runtime import through the dev server
				const nt = await import('/client/pipeline/nodes/nodeTypes.tsx')
				const editor = (window as any).editor
				const def = store.getNodeDefinition(editor, type)
				const node = { ...def.getDefault(), ...patch, type }
				const id = `shape:named-${tag}`
				editor.createShape({ id, type: 'node', x: 0, y: 0, props: { node, fontSize: 16 } })
				await new Promise((r) => setTimeout(r, 30))
				const shape = editor.getShape(id)
				const ports = nt.getNodeTypePorts(editor, shape)
				return Object.keys(ports)
			},
			{ type, patch, tag }
		)
	}

	test('decision_switch choice mode exposes opt:<slug> ports', async ({ page }) => {
		await gotoApp(page)
		const ids = await portsOf(page, 'decision_switch', { mode: 'choice', options: 'short\nformal\nfunny' }, 'choice')
		expect(ids).toEqual(expect.arrayContaining(['opt:short', 'opt:formal', 'opt:funny', 'other']))
	})

	test('json_fields exposes path:<slug> ports from its default Paths', async ({ page }) => {
		await gotoApp(page)
		const ids = await portsOf(page, 'json_fields', {}, 'jsonfields')
		expect(ids).toEqual(expect.arrayContaining(['path:value', 'path:topic', 'path:data_0_name', 'path:customer_country', 'rest']))
	})

	test('for_each "table rows" exposes row:<column> ports', async ({ page }) => {
		await gotoApp(page)
		const ids = await portsOf(page, 'for_each', { split: 'rows', rowColumns: ['id', 'product', 'review'] }, 'rows')
		expect(ids).toEqual(expect.arrayContaining(['row:id', 'row:product', 'row:review']))
	})

	test('code exposes in1..inN / output, out2..outN sized by Input/Output count', async ({ page }) => {
		await gotoApp(page)
		const ids = await portsOf(page, 'code', { inputCount: 4, outputCount: 3 }, 'code')
		expect(ids).toEqual(expect.arrayContaining(['in1', 'in2', 'in3', 'in4', 'output', 'out2', 'out3']))
	})

	test('jev (default kind) exposes yes/no pass-through ports', async ({ page }) => {
		await gotoApp(page)
		const ids = await portsOf(page, 'jev', {}, 'jev')
		expect(ids).toEqual(expect.arrayContaining(['yes', 'no', 'output', 'probs', 'final']))
	})

	test('load_image exposes a url input port', async ({ page }) => {
		await gotoApp(page)
		const ids = await portsOf(page, 'load_image', {}, 'loadimage')
		expect(ids).toContain('url')
	})

	test('template exposes var:<name> ports from its default template', async ({ page }) => {
		await gotoApp(page)
		const ids = await portsOf(page, 'template', {}, 'template')
		expect(ids).toEqual(expect.arrayContaining(['var:name', 'var:summary']))
	})
})
