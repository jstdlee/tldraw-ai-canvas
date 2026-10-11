import { expect, test } from '@playwright/test'
import { freshCanvas, gotoApp, zoomToFit } from './helpers'

/**
 * WP21 follow-up: every port — input or output — of every card type should be a visible,
 * draggable, anchored dot, not just the ones WP21 itself touched (If/For each/JEV/Router).
 * Inserts each non-hidden card type at its default state, one at a time, and checks:
 *  - every output (terminal "start") port id returned by `getNodePorts` has a `.Port_start`
 *    element rendered somewhere under that card (the generic header "output" port is rendered
 *    by `NodeShapeComponent` itself, outside the body, so it's exempt the same way the dev
 *    warning in `nodeTypes.tsx` is);
 *  - no "[WP17]"/"[WP21]" "no port anchor" / "no field-port anchor" console warning fired for
 *    that card (covers dedicated input/output ports and wirable `field:<key>` ports alike —
 *    the single source of truth for "is this anchor missing and not a deliberate exception",
 *    so this test doesn't duplicate nodeTypes.tsx's own exemption list).
 *
 */
test.describe('every port is a visible, anchored dot', () => {
	test('every non-hidden card type, default state', async ({ page }) => {
		// ~40 card types, each with a 2.2s wait for the dev-warning timer to resolve.
		test.setTimeout(180_000)
		await gotoApp(page)

		const types = await page.evaluate(async () => {
			const editor = (window as any).editor
			// @ts-expect-error dynamic import of an app source file, resolvable at runtime by the
			// dev server only (see helpers.ts's runNode for the same trick).
			const mod = await import('/client/pipeline/nodes/definitionStore.ts')
			const defs = mod.getNodeDefinitions(editor)
			return Object.entries(defs)
				.filter(([type, def]: [string, any]) => !def.hidden)
				.map(([type]) => type)
		})
		expect(types.length).toBeGreaterThan(0)

		const failures: string[] = []

		for (const type of types) {
			const warnings: string[] = []
			const onConsole = (msg: import('@playwright/test').ConsoleMessage) => {
				const text = msg.text()
				if (/\[WP(17|21)\]/.test(text) && (text.includes('no port anchor') || text.includes('no field-port anchor'))) {
					warnings.push(text)
				}
			}
			page.on('console', onConsole)

			await freshCanvas(page)
			const { id, outputPortIds } = await page.evaluate(async (type: string) => {
				const editor = (window as any).editor
				// @ts-expect-error dynamic import, see above.
				const defStore = await import('/client/pipeline/nodes/definitionStore.ts')
				// @ts-expect-error dynamic import, see above.
				const nodePorts = await import('/client/pipeline/nodes/nodePorts.tsx')
				const def = defStore.getNodeDefinitions(editor)[type]
				const node = def.getDefault()
				const id = `shape:${crypto.randomUUID()}`
				editor.createShape({ id, type: 'node', x: 0, y: 0, props: { node, fontSize: 16 } })
				// Give layout effects (anchors) a tick to register before reading ports.
				await new Promise((r) => setTimeout(r, 50))
				const ports = nodePorts.getNodePorts(editor, editor.getShape(id))
				const outputPortIds = Object.values(ports ?? {})
					.filter((p: any) => p.terminal === 'start')
					.map((p: any) => p.id)
				return { id, outputPortIds }
			}, type)

			await zoomToFit(page)
			// Let the dev-warning setTimeout (2000ms in nodeTypes.tsx) resolve either way.
			await page.waitForTimeout(2200)

			for (const portId of outputPortIds) {
				if (portId === 'output') continue // rendered by NodeShapeComponent in the header
				const count = await page.locator(`[data-shape-id="${id}"] .Port_start`).count()
				if (count < 1) {
					failures.push(`${type}: no .Port_start rendered at all (expected one for "${portId}")`)
					break
				}
			}

			page.off('console', onConsole)
			if (warnings.length) {
				failures.push(`${type}: ${[...new Set(warnings)].join(' | ')}`)
			}
		}

		expect(failures, failures.join('\n')).toEqual([])
	})
})
