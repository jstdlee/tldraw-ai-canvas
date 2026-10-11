/**
 * WP25: helpers for the perf benchmark (`tests/perf/`). Reuses the e2e suite's own
 * `createNode`/`wire`/`gotoApp`/helpers (`tests/e2e/helpers.ts`) for setup, and adds frame-time
 * sampling + a React-commit counter on top.
 */
import { Page } from '@playwright/test'
import { createNode, wire } from '../e2e/helpers'

export interface FrameStats {
	p50: number
	p95: number
	max: number
	count: number
}

export function frameStats(frames: number[]): FrameStats {
	if (frames.length === 0) return { p50: 0, p95: 0, max: 0, count: 0 }
	const sorted = [...frames].sort((a, b) => a - b)
	const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
	return { p50: pct(0.5), p95: pct(0.95), max: sorted[sorted.length - 1], count: sorted.length }
}

/** Installs a React DevTools hook stub before any app script runs, so `react-dom` (dev build)
 * reports every commit to it — a commit counter with no change to app source. Call once, before
 * `gotoApp`. */
export async function installCommitCounter(page: Page): Promise<void> {
	await page.addInitScript(() => {
		;(window as any).__wp25Commits = 0
		if (!(window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__) {
			;(window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
				isDisabled: false,
				supportsFiber: true,
				renderers: new Map(),
				inject() {
					return 1
				},
				onCommitFiberRoot() {
					;(window as any).__wp25Commits++
				},
				onCommitFiberUnmount() {},
				onPostCommitFiberRoot() {},
				checkDCE() {},
			}
		}
	})
}

export async function resetCommitCounter(page: Page): Promise<void> {
	await page.evaluate(() => {
		;(window as any).__wp25Commits = 0
	})
}

export async function readCommitCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__wp25Commits ?? 0)
}

/** `getNodeTypePorts` evaluation counter (dev-only, defined in `nodeTypes.tsx`). */
export async function resetPortEvalCounter(page: Page): Promise<void> {
	await page.evaluate(() => {
		const c = (window as any).__wp25PerfCounters
		if (c) c.getNodeTypePortsCalls = 0
	})
}

export async function readPortEvalCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__wp25PerfCounters?.getNodeTypePortsCalls ?? 0)
}

/** Starts an in-page `requestAnimationFrame` sampler; `stopFrameRecorder` returns the deltas. */
export async function startFrameRecorder(page: Page): Promise<void> {
	await page.evaluate(() => {
		;(window as any).__frames = []
		let last = performance.now()
		const tick = (t: number) => {
			;(window as any).__frames.push(t - last)
			last = t
			;(window as any).__rafId = requestAnimationFrame(tick)
		}
		;(window as any).__rafId = requestAnimationFrame(tick)
	})
}

export async function stopFrameRecorder(page: Page): Promise<number[]> {
	return page.evaluate(() => {
		cancelAnimationFrame((window as any).__rafId)
		return ((window as any).__frames as number[]) ?? []
	})
}

/** Zoom in (so only part of the canvas is visible — at "zoom to fit" over 150 cards, nothing is
 * ever off-screen, so panning never exercises culling), then pan the camera back and forth for
 * `ms`, sweeping far enough each leg that cards actually cross the viewport edge — like a user
 * scrubbing across a big canvas, not just nudging it. */
export async function panFor(page: Page, ms: number): Promise<void> {
	await page.evaluate(async (ms) => {
		const editor = (window as any).editor
		const cam0 = editor.getCamera()
		editor.setCamera({ x: cam0.x, y: cam0.y, z: 1 }, { immediate: true })
		const start = performance.now()
		let dx = 40
		let sign = 1
		while (performance.now() - start < ms) {
			const cam = editor.getCamera()
			editor.setCamera({ x: cam.x + dx * sign, y: cam.y, z: cam.z }, { immediate: true })
			if (Math.abs(((performance.now() - start) / 600) % 2 - 1) < 0.02) sign *= -1
			await new Promise((r) => setTimeout(r, 16))
		}
	}, ms)
}

/** Drag one shape back and forth for `ms` by moving its x/y directly (the same reactive cost a
 * real pointer drag causes: geometry, ports and connected wires all re-derive from the shape's
 * new position), without depending on real-OS pointer timing. */
export async function dragFor(page: Page, shapeId: string, ms: number): Promise<void> {
	await page.evaluate(
		async ({ shapeId, ms }) => {
			const editor = (window as any).editor
			const start0 = editor.getShape(shapeId)
			const x0 = start0.x
			const y0 = start0.y
			const start = performance.now()
			let dx = 6
			let sign = 1
			while (performance.now() - start < ms) {
				const elapsed = performance.now() - start
				if (Math.abs((elapsed / 500) % 2 - 1) < 0.02) sign *= -1
				const t = (performance.now() - start) * 0.01
				editor.updateShape({ id: shapeId, type: 'node', x: x0 + Math.sin(t) * 150, y: y0 + Math.cos(t * 0.7) * 60 })
				await new Promise((r) => setTimeout(r, 16))
			}
			editor.updateShape({ id: shapeId, type: 'node', x: x0, y: y0 })
			void dx
			void sign
		},
		{ shapeId, ms }
	)
}

/** One "chain unit" of the realistic card mix named in the WP25 guide: DataPipe (with preview)
 * -> Group -> Chart, DataPipe -> Group -> Table view, a Prompt -> AI text chain (never run — the
 * benchmark only measures idle-canvas interaction cost for these, not a real model call), a JEV
 * decision, an If, a Database card and a Web search card. 10 cards, several wired. */
export async function buildMixUnit(
	page: Page,
	index: number
): Promise<{ ids: string[]; promptId: string; dataPipeId: string }> {
	const col = index % 5
	const row = Math.floor(index / 5)
	const ox = col * 2600
	const oy = row * 1400
	const CSV = 'region,amount,score\nEast,10,3\nEast,5,4\nWest,7,2\nNorth,9,5\n'

	const dataPipeId = await createNode(
		page,
		{
			type: 'table',
			text: CSV,
			format: 'auto',
			op: 'select',
			columns: 'region,amount,score',
			column: '',
			as: '',
			expr: '',
			sep: ' ',
			pattern: '',
			with: '',
			name: '',
			error: null,
			source: 'inline',
		},
		{ x: ox, y: oy }
	)
	const groupId = await createNode(
		page,
		{
			type: 'table',
			text: '',
			format: 'auto',
			op: 'groupby',
			columns: 'amount:sum:total',
			column: 'region',
			as: '',
			expr: '',
			sep: ' ',
			pattern: '',
			with: '',
			name: '',
			error: null,
			source: 'input',
		},
		{ x: ox + 440, y: oy }
	)
	const chartId = await createNode(
		page,
		{
			type: 'chart',
			text: '',
			format: 'csv',
			kind: 'bar',
			xCol: 'region',
			yCol: 'total',
			dualScale: false,
			error: null,
			series: '',
			aggregate: 'none',
			stack: false,
			sort: 'none',
			top: 0,
			otherRow: false,
			bins: 10,
			title: '',
			xLabel: '',
			yLabel: '',
			labels: false,
			smooth: false,
		},
		{ x: ox + 880, y: oy }
	)
	const tableViewId = await createNode(
		page,
		{
			type: 'table_view',
			text: 'name,city,score\nAda,Paris,3\nLin,Oslo,5',
			filterText: '',
			sortColumn: '',
			sortDir: 'asc',
			error: null,
			lastOutput: null,
			lastJson: null,
			lastInfo: '',
		},
		{ x: ox + 1320, y: oy }
	)
	const promptId = await createNode(
		page,
		{ type: 'prompt', text: 'a photo of a cat sitting on a windowsill' },
		{ x: ox, y: oy + 400 }
	)
	const textAiId = await createNode(
		page,
		{
			type: 'text_ai',
			operation: 'summarize',
			option: '',
			instruction: '',
			model: '',
			lastResultText: null,
			error: null,
		},
		{ x: ox + 440, y: oy + 400 }
	)
	const jevId = await createNode(
		page,
		{
			type: 'jev',
			kind: 'noul',
			question: 'Should we approve this request?',
			options:
				'approve: the request is complete and reasonable\nask: more information is needed\nreject: the request breaks the rules',
			model: '',
			filter: false,
			filterInstruction: 'Rewrite the input text so it follows the decision.',
			filterModel: '',
			lastResult: null,
			lastFinal: null,
			error: null,
		},
		{ x: ox + 880, y: oy + 400 }
	)
	const ifId = await createNode(
		page,
		{ type: 'if', condition: 'contains', operand: 'yes', lastResult: null, lastValue: null },
		{ x: ox + 1320, y: oy + 400 }
	)
	const databaseId = await createNode(
		page,
		{
			type: 'database',
			fileUrl: '',
			fileName: '',
			fileSize: 0,
			sql: 'select 1',
			tables: '',
			lastOutput: null,
			lastInfo: '',
			error: null,
			source: 'sqlite',
		},
		{ x: ox, y: oy + 800 }
	)
	const webSearchId = await createNode(
		page,
		{
			type: 'web_search',
			provider: 'exa',
			query: 'tldraw performance',
			count: 5,
			tavilyDepth: 'basic',
			tavilyIncludeAnswer: false,
			exaIncludeText: false,
			keyRef: '',
			lastResultsJson: null,
			lastAnswer: null,
			lastInfo: '',
			error: null,
		},
		{ x: ox + 440, y: oy + 800 }
	)

	await wire(page, dataPipeId, 'output', groupId, 'data')
	await wire(page, groupId, 'output', chartId, 'data')
	await wire(page, groupId, 'output', tableViewId, 'data')
	await wire(page, promptId, 'output', textAiId, 'input')
	await wire(page, textAiId, 'output', jevId, 'field:question')
	await wire(page, jevId, 'yes', ifId, 'input')

	return {
		ids: [dataPipeId, groupId, chartId, tableViewId, promptId, textAiId, jevId, ifId, databaseId, webSearchId],
		promptId,
		dataPipeId,
	}
}

/** Builds a realistic canvas of roughly `count` cards (whole mix units of 10; the WP guide's
 * mix: DataPipe with preview, Chart, AI text with result, Prompt, JEV, If, Database, Table
 * view). Returns every shape id, the first Prompt card (for the typing test) and a mid-canvas
 * card (for the drag test). */
export async function buildRealisticCanvas(
	page: Page,
	count: number
): Promise<{ ids: string[]; promptId: string; dragId: string }> {
	const units = Math.max(1, Math.round(count / 10))
	const ids: string[] = []
	let promptId = ''
	let dragId = ''
	for (let i = 0; i < units; i++) {
		const unit = await buildMixUnit(page, i)
		ids.push(...unit.ids)
		if (i === 0) promptId = unit.promptId
		if (i === Math.floor(units / 2)) dragId = unit.dataPipeId
	}
	return { ids, promptId, dragId: dragId || ids[0] }
}

/** A 5-card chain with no network/model calls (pure table ops + chart), so "run one chain" can
 * actually execute inside the benchmark (AI/web-search cards need provider keys and network,
 * which this offline benchmark never has). */
export async function buildPureChain(page: Page): Promise<{ lastId: string }> {
	const CSV = 'region,amount\nEast,10\nEast,5\nWest,7\nNorth,9\n'
	const a = await createNode(
		page,
		{
			type: 'table',
			text: CSV,
			format: 'auto',
			op: 'select',
			columns: 'region,amount',
			column: '',
			as: '',
			expr: '',
			sep: ' ',
			pattern: '',
			with: '',
			name: '',
			error: null,
			source: 'inline',
		},
		{ x: 4000, y: 0 }
	)
	const b = await createNode(
		page,
		{
			type: 'table',
			text: '',
			format: 'auto',
			op: 'groupby',
			columns: 'amount:sum:total',
			column: 'region',
			as: '',
			expr: '',
			sep: ' ',
			pattern: '',
			with: '',
			name: '',
			error: null,
			source: 'input',
		},
		{ x: 4440, y: 0 }
	)
	const c = await createNode(
		page,
		{
			type: 'table',
			text: '',
			format: 'auto',
			op: 'select',
			columns: 'region,total',
			column: '',
			as: '',
			expr: '',
			sep: ' ',
			pattern: '',
			with: '',
			name: '',
			error: null,
			source: 'input',
		},
		{ x: 4880, y: 0 }
	)
	const d = await createNode(
		page,
		{
			type: 'table_view',
			text: '',
			filterText: '',
			sortColumn: '',
			sortDir: 'asc',
			error: null,
			lastOutput: null,
			lastJson: null,
			lastInfo: '',
		},
		{ x: 5320, y: 0 }
	)
	const e = await createNode(
		page,
		{
			type: 'chart',
			text: '',
			format: 'csv',
			kind: 'bar',
			xCol: 'region',
			yCol: 'total',
			dualScale: false,
			error: null,
			series: '',
			aggregate: 'none',
			stack: false,
			sort: 'none',
			top: 0,
			otherRow: false,
			bins: 10,
			title: '',
			xLabel: '',
			yLabel: '',
			labels: false,
			smooth: false,
		},
		{ x: 5760, y: 0 }
	)
	await wire(page, a, 'output', b, 'data')
	await wire(page, b, 'output', c, 'data')
	await wire(page, c, 'output', d, 'data')
	await wire(page, d, 'output', e, 'data')
	return { lastId: e }
}
