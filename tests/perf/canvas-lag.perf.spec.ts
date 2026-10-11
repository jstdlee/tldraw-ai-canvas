/**
 * WP25 — performance with many cards. Builds a realistic canvas (DataPipe with preview, Chart,
 * AI text with result, Prompt, JEV, If, Database, Table view and Web search cards, wired in
 * chains) at 30/80/150 cards, and measures the five actions the guide names:
 *   - pan the camera for 3s
 *   - drag one card for 3s
 *   - type 20 characters in a Prompt
 *   - run one chain of 5 cards
 *   - select-all + deselect
 * Frame times come from an in-page `requestAnimationFrame` sampler (p50/p95/longest); React
 * commits come from a React DevTools hook stub (no app source touched); `getNodeTypePorts`
 * evaluations come from the dev-only counter in `client/pipeline/nodes/nodeTypes.tsx`. Results
 * are appended to `tests/perf/results.md`. Local only — never run as part of `npm run test:e2e`.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { gotoApp, nodeLocator, runNode, zoomToFit } from '../e2e/helpers'
import {
	buildPureChain,
	buildRealisticCanvas,
	dragFor,
	frameStats,
	FrameStats,
	installCommitCounter,
	panFor,
	readCommitCount,
	readPortEvalCount,
	resetCommitCounter,
	resetPortEvalCounter,
	startFrameRecorder,
	stopFrameRecorder,
} from './helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RESULTS_PATH = join(__dirname, 'results.md')
const RUN_LABEL = process.env.WP25_RUN_LABEL ?? 'run'
const CARD_COUNTS = [30, 80, 150]

interface ActionResult {
	action: string
	frames: FrameStats
	commits: number
	portEvals: number
}

function fmtMs(n: number): string {
	return `${n.toFixed(1)}ms`
}

function writeResults(cardCount: number, results: ActionResult[]) {
	mkdirSync(join(__dirname), { recursive: true })
	const lines: string[] = []
	lines.push(`\n### ${RUN_LABEL} — ${cardCount} cards\n`)
	lines.push('| action | p50 | p95 | longest | frames | React commits | getNodeTypePorts evals |')
	lines.push('|---|---|---|---|---|---|---|')
	for (const r of results) {
		lines.push(
			`| ${r.action} | ${fmtMs(r.frames.p50)} | ${fmtMs(r.frames.p95)} | ${fmtMs(r.frames.max)} | ${r.frames.count} | ${r.commits} | ${r.portEvals} |`
		)
	}
	appendFileSync(RESULTS_PATH, lines.join('\n') + '\n')
}

test.describe.configure({ mode: 'serial' })

for (const cardCount of CARD_COUNTS) {
	test(`${cardCount} cards: pan / drag / type / run / select`, async ({ page }) => {
		test.setTimeout(240_000)
		await installCommitCounter(page)
		await gotoApp(page)

		const { promptId, dragId } = await buildRealisticCanvas(page, cardCount)
		const { lastId: chainLastId } = await buildPureChain(page)
		await zoomToFit(page)
		// Settle any mount-time effects (ResizeObservers, chart init) before measuring.
		await page.waitForTimeout(500)

		const results: ActionResult[] = []

		const measure = async (action: string, body: () => Promise<void>) => {
			await resetCommitCounter(page)
			await resetPortEvalCounter(page)
			await startFrameRecorder(page)
			await body()
			const frames = await stopFrameRecorder(page)
			const commits = await readCommitCount(page)
			const portEvals = await readPortEvalCount(page)
			results.push({ action, frames: frameStats(frames), commits, portEvals })
		}

		await measure('pan 3s', () => panFor(page, 3000))
		// The pan action (zoomed in, sweeping ~1500px per leg) can leave the viewport anywhere;
		// the next two actions drive real Playwright clicks, which need their target visible.
		await zoomToFit(page)
		await measure('drag one card 3s', () => dragFor(page, dragId, 3000))
		await zoomToFit(page)
		await measure('type 20 chars in a Prompt', async () => {
			const textarea = nodeLocator(page, promptId).locator('textarea.NodeField-textarea')
			await textarea.scrollIntoViewIfNeeded()
			await textarea.click()
			await textarea.pressSequentially('hello world benchmark!', { delay: 40 })
		})
		await zoomToFit(page)
		await measure('run chain of 5 cards', async () => {
			await runNode(page, chainLastId, 20_000)
		})
		await measure('select-all + deselect', async () => {
			await page.evaluate(() => void (window as any).editor.selectAll())
			await new Promise((r) => setTimeout(r, 300))
			await page.evaluate(() => void (window as any).editor.selectNone())
			await new Promise((r) => setTimeout(r, 300))
		})

		writeResults(cardCount, results)

		// Sanity: the benchmark itself must not be broken (frames were actually sampled).
		for (const r of results) expect(r.frames.count).toBeGreaterThan(0)
	})
}
