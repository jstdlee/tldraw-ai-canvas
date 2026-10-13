/**
 * WP20: small helpers shared by the Playwright suite. The dev build exposes `window.editor`
 * (see client/App.tsx's onMount) — used here for setup (creating/wiring/reading nodes) so each
 * test can focus on the one real-UI interaction it is actually checking.
 */
import { expect, Locator, Page } from '@playwright/test'

/** Matches client/shell/shellState.ts's picker-rank storage key: keep JEV re-rank off in tests
 * (no test may call a real AI model or the network). */
const SMART_RANKING_KEY = 'oh-my-tldraw:picker-smart-ranking'

/** Navigate to the app, disable JEV re-rank before any app script runs, wait for the editor,
 * and clear the canvas so every test starts from nothing. */
export async function gotoApp(page: Page): Promise<void> {
	await page.addInitScript((key: string) => {
		try {
			localStorage.setItem(key, 'off')
		} catch {
			// Private mode: fine, the app just falls back to local ranking.
		}
	}, SMART_RANKING_KEY)
	await page.goto('/')
	await page.waitForFunction(() => Boolean((window as any).editor))
	await freshCanvas(page)
}

/** Delete every shape on the current page ("freshCanvas"). */
export async function freshCanvas(page: Page): Promise<void> {
	await page.evaluate(() => {
		const editor = (window as any).editor
		const ids = [...editor.getCurrentPageShapeIds()]
		if (ids.length) editor.deleteShapes(ids)
	})
}

export function nodeLocator(page: Page, id: string): Locator {
	return page.locator(`[data-shape-id="${id}"]`)
}

/** Create a node shape directly (setup only — mirrors what `createNodeAt` does, minus the
 * free-spot search tests don't need). Returns the new shape id. */
export async function createNode(
	page: Page,
	node: Record<string, unknown>,
	opts: { x?: number; y?: number; fontSize?: number } = {}
): Promise<string> {
	return page.evaluate(
		({ node, opts }) => {
			const editor = (window as any).editor
			const id = `shape:${crypto.randomUUID()}`
			editor.createShape({
				id,
				type: 'node',
				x: opts.x ?? 0,
				y: opts.y ?? 0,
				props: { node, fontSize: opts.fontSize ?? 16 },
			})
			return id
		},
		{ node, opts }
	)
}

/** Wire `fromId`'s output port to `toId`'s input port, the same way the app does it
 * (one `connection` shape, two `connection` bindings). Returns the connection shape id. */
export async function wire(
	page: Page,
	fromId: string,
	fromPort: string,
	toId: string,
	toPort: string
): Promise<string> {
	return page.evaluate(
		({ fromId, fromPort, toId, toPort }) => {
			const editor = (window as any).editor
			const connectionId = `shape:${crypto.randomUUID()}`
			editor.createShape({
				id: connectionId,
				type: 'connection',
				props: { start: { x: 0, y: 0 }, end: { x: 80, y: 0 } },
			})
			editor.createBinding({
				id: `binding:${crypto.randomUUID()}`,
				type: 'connection',
				fromId: connectionId,
				toId: fromId,
				props: { portId: fromPort, terminal: 'start', order: 0 },
			})
			editor.createBinding({
				id: `binding:${crypto.randomUUID()}`,
				type: 'connection',
				fromId: connectionId,
				toId: toId,
				props: { portId: toPort, terminal: 'end', order: 1 },
			})
			return connectionId
		},
		{ fromId, fromPort, toId, toPort }
	)
}

/** Remove a wire created by `wire()` (or any connection shape), by its own shape id. */
export async function unwire(page: Page, connectionId: string): Promise<void> {
	await page.evaluate((id: string) => {
		(window as any).editor.deleteShape(id)
	}, connectionId)
}

/** Zoom to fit everything on the page, so later clicks on a card land inside the viewport. */
export async function zoomToFit(page: Page): Promise<void> {
	await page.evaluate(() => {
		// WP27: an instant jump, not tldraw's default animated transition — without this, a
		// test that reads a port/shape's boundingBox() right after zoomToFit() (as several do,
		// to then drive page.mouse directly) can capture a mid-animation position and then drag
		// from a now-stale pixel once the camera finishes settling a moment later. A taller card
		// (a bigger zoom/pan delta to fit) makes the animation longer and the race easier to
		// hit, which is what exposed this — but any card's size change could have, since nothing
		// here ever waited for the animation to finish.
		(window as any).editor.zoomToFit({ animation: { duration: 0 } })
		// Even an instant camera move only takes effect in the DOM on the next paint (tldraw
		// applies the camera transform via a rAF-driven render tick, not synchronously) — wait
		// one so a boundingBox() read right after this resolves reflects the real, final
		// position instead of the pre-zoom one.
		return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
	})
}

/** A node shape's full `props` (including `fontSize`, `node`, …) for a shape id. */
export async function shapeProps<T = Record<string, unknown>>(page: Page, id: string): Promise<T> {
	return page.evaluate((id: string) => (window as any).editor.getShape(id)?.props ?? null, id) as Promise<T>
}

/** The node value (`shape.props.node`) for a shape id. */
export async function nodeProps<T = Record<string, unknown>>(page: Page, id: string): Promise<T> {
	return page.evaluate((id: string) => {
		const editor = (window as any).editor
		return editor.getShape(id)?.props?.node ?? null
	}, id) as Promise<T>
}

/** A card's run status (`{ status, message, ms }` from `nodeRunState.ts`), via the dev-server
 * dynamic import trick `runNode` also uses — the per-shape atom isn't on the shape itself. */
export async function getNodeRun(
	page: Page,
	id: string
): Promise<{ status: string; message?: string; ms?: number } | undefined> {
	return page.evaluate(async (id: string) => {
		// @ts-expect-error dynamic import of an app source file, only resolvable at runtime
		// by the dev server — see helpers.ts's `runNode` for why.
		const mod = await import('/client/pipeline/execution/nodeRunState.ts')
		return mod.getNodeRun((window as any).editor, id)
	}, id)
}

/** Merge a patch into a node's props, the same way the app's own `updateNode` does it (which
 * also marks the card `isOutOfDate` — the signal `staleUpstreamOrder` uses to decide a later
 * Run must visit it again). */
export async function setNodeProps(page: Page, id: string, patch: Record<string, unknown>): Promise<void> {
	await page.evaluate(
		({ id, patch }) => {
			const editor = (window as any).editor
			const shape = editor.getShape(id)
			editor.updateShape({ id, type: 'node', props: { node: { ...shape.props.node, ...patch }, isOutOfDate: true } })
		},
		{ id, patch }
	)
}

/** Click a node's own "Run" footer button (real UI — not calling `startExecution` directly),
 * and wait for the whole run graph to go idle. A cache hit can finish so fast its footer label
 * never visibly changes (and doesn't even change at all when "cached" — no `ms` is recorded,
 * see ExecutionGraph's `setNodeRun(..., { status: 'ok', message: 'cached' })`), so the label
 * isn't a reliable "done" signal. `executionState.runningGraph` (imported through the dev
 * server, the same trick the WP20 guide suggests for `startExecution`) is. */
export async function runNode(page: Page, id: string, timeout = 15_000): Promise<void> {
	const button = nodeLocator(page, id).locator('.NodeShape-footer > button').first()
	// WP27: a card's height isn't fixed — a result preview, a growing field, an expanded
	// section can all make it taller after the page's earlier (one-time) zoomToFit ran,
	// pushing the footer below the viewport (e.g. DataPipe gains ~176px of preview table
	// height after its first run). Only re-fit when the button isn't already fully on
	// screen — zoomToBounds on just this one (possibly small) shape every single call would
	// over-zoom a small card, which can shove its own content under the fixed bottom toolbar.
	const viewport = page.viewportSize()
	const box = await button.boundingBox()
	const onScreen =
		!!box && !!viewport && box.y >= 0 && box.x >= 0 && box.y + box.height <= viewport.height && box.x + box.width <= viewport.width
	if (!onScreen) {
		await page.evaluate((id) => {
			const editor = (window as any).editor
			const bounds = editor.getShapePageBounds(id)
			if (bounds) editor.zoomToBounds(bounds, { animation: { duration: 0 } })
		}, id)
	}
	await button.click()
	const deadline = Date.now() + timeout
	for (;;) {
		const running = await page.evaluate(async () => {
			// @ts-expect-error dynamic import of an app source file, only resolvable at runtime
			// by the dev server — see helpers.ts's `runNode` for why.
			const mod = await import('/client/pipeline/execution/executionState.ts')
			return mod.executionState.get((window as any).editor).runningGraph !== null
		})
		if (!running) return
		if (Date.now() > deadline) throw new Error(`runNode(${id}): still running after ${timeout}ms`)
		await page.waitForTimeout(50)
	}
}

/** Whether a shape still exists on the page. */
export async function shapeExists(page: Page, id: string): Promise<boolean> {
	return page.evaluate((id: string) => Boolean((window as any).editor.getShape(id)), id)
}

/** A shape's `meta` object. */
export async function shapeMeta(page: Page, id: string): Promise<Record<string, unknown>> {
	return page.evaluate((id: string) => (window as any).editor.getShape(id)?.meta ?? {}, id)
}

/** The id of the one currently-selected shape, or null. */
export async function selectedShapeId(page: Page): Promise<string | null> {
	return page.evaluate(() => (window as any).editor.getOnlySelectedShape()?.id ?? null)
}

export async function selectShapes(page: Page, ids: string[]): Promise<void> {
	await page.evaluate((ids: string[]) => {
		(window as any).editor.select(...ids)
	}, ids)
}

/** Click an empty spot on the canvas, far from any card, so a later keyboard shortcut is not
 * swallowed by a focused text field. */
export async function clickEmptyCanvas(page: Page, x = 700, y = 560): Promise<void> {
	await page.mouse.click(x, y)
}

/** Type into the "/" insert palette (must already be open) and press Enter (or Shift+Enter to
 * also wire the new card to the selected one). */
export async function insertFromPalette(page: Page, query: string, opts: { shiftEnter?: boolean } = {}): Promise<void> {
	const input = page.getByPlaceholder('Insert card…')
	await input.fill(query)
	await input.press(opts.shiftEnter ? 'Shift+Enter' : 'Enter')
}

/** Search the node library rail for `title` and click the (expected single) matching card,
 * which inserts it at the viewport centre and selects it. Returns the new shape id. */
export async function addCardFromLibrary(page: Page, title: string): Promise<string> {
	const search = page.locator('.ImagePipelineSidebar-search input')
	await search.fill(title)
	await page.locator('.ImagePipelineSidebar-item', { hasText: title }).first().click()
	await search.fill('')
	const id = await selectedShapeId(page)
	if (!id) throw new Error(`addCardFromLibrary(${title}): nothing selected after clicking the item`)
	return id
}

/** Wait for `executionState.runningGraph` to go idle (same signal `runNode` polls), without
 * clicking anything first — for a card whose run is started some other way (e.g. a card like
 * HTML form that only starts its run once the user interacts with its own preview). */
export async function waitForRunIdle(page: Page, timeout = 15_000): Promise<void> {
	const deadline = Date.now() + timeout
	for (;;) {
		const running = await page.evaluate(async () => {
			// @ts-expect-error dynamic import of an app source file, only resolvable at runtime
			// by the dev server — see helpers.ts's `runNode` for why.
			const mod = await import('/client/pipeline/execution/executionState.ts')
			return mod.executionState.get((window as any).editor).runningGraph !== null
		})
		if (!running) return
		if (Date.now() > deadline) throw new Error(`waitForRunIdle: still running after ${timeout}ms`)
		await page.waitForTimeout(50)
	}
}
