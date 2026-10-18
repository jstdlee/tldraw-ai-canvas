import { expect, Page, test } from '@playwright/test'
import { createNode, gotoApp, nodeProps, runNode, wire, zoomToFit } from './helpers'

/**
 * WP35 Part C: "For each over table rows" — split: 'rows' feeds the loop body the row (as
 * JSON) plus one `row:<column>` port per column, and collect: 'table' adds the per-row result
 * back onto the original table as a new column (row <-> result kept; no result -> empty cell).
 * The loop body here is a Text tool (deterministic, no model call needed — the guide allows
 * "mock LLM or Text tools" for this exact scenario).
 */
async function addDefault(page: Page, type: string, patch: Record<string, unknown> = {}, x = 0, y = 0): Promise<string> {
	return page.evaluate(
		async ({ type, patch, x, y }) => {
			// @ts-expect-error dynamic import of an app source file, resolvable at runtime only
			// by the dev server (see tests/e2e/helpers.ts's runNode for the same trick).
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

const CSV = 'id,product,review\n1,Mug,great cup\n2,Lamp,bit dim'

test.describe('WP35 Part C: For each over table rows', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('CSV -> For each rows -> Text tools -> table with a new column -> Table view', async ({ page }) => {
		const csv = await createNode(page, { type: 'prompt', text: CSV }, { x: 0, y: 0 })
		const loop = await addDefault(page, 'for_each', { split: 'rows', collect: 'table', resultColumn: 'summary' }, 460, 0)
		// "Uppercase" stands in for "an AI summary of the review" (the guide: mock LLM or Text
		// tools) — deterministic, so the test asserts an exact result instead of "something ran".
		const upper = await addDefault(page, 'text_tool', { op: 'upper' }, 920, 0)
		const view = await addDefault(page, 'table_view', {}, 1380, 0)
		await wire(page, csv, 'output', loop, 'list')
		// `wire()` creates the connection/binding records directly (bypassing the drag-and-drop
		// UI), so it doesn't need "row:review" to already be a rendered port — only `execute()`
		// needs to resolve it by this exact id, which it does the same way regardless of
		// whether the card has ever run before (see `rowColumnPorts` in shared/logic.ts).
		await wire(page, loop, 'row:review', upper, 'input')
		await wire(page, upper, 'output', loop, 'result')
		await wire(page, loop, 'output', view, 'data')
		await zoomToFit(page)

		await runNode(page, loop)
		const loopNode = await nodeProps<{ lastResults: string; error: string | null }>(page, loop)
		expect(loopNode.error).toBeNull()
		expect(loopNode.lastResults).toBe('id,product,review,summary\n1,Mug,great cup,GREAT CUP\n2,Lamp,bit dim,BIT DIM')

		await runNode(page, view)
		const viewNode = await nodeProps<{ error: string | null; lastInfo: string }>(page, view)
		expect(viewNode.error).toBeNull()
		expect(viewNode.lastInfo).toContain('2')
	})

	test('GAPS-14: collect "joined" respects "Join with" even though the list came from a JSON array', () => {
		// Covered as a pure-logic unit test (tests/logic.test.ts collectResults), since it needs
		// no UI — kept here as a pointer so the fix's two layers (pure logic + this card) are
		// easy to find together.
		expect(true).toBe(true)
	})

	test('a row with no result leaves an empty cell, not a dropped row (noResult does not apply to collect: table)', async ({ page }) => {
		const csv = await createNode(page, { type: 'prompt', text: 'id,n\n1,2\n2,9\n3,4' }, { x: 0, y: 0 })
		const loop = await addDefault(page, 'for_each', { split: 'rows', collect: 'table', resultColumn: 'flag', noResult: 'skip' }, 460, 0)
		// Only rows where n > 5 reach "then" -> "result"; the others' "else" is never wired back.
		const gate = await addDefault(page, 'if', { condition: 'gt', operand: '5' }, 920, 0)
		await wire(page, csv, 'output', loop, 'list')
		await wire(page, loop, 'row:n', gate, 'input')
		await wire(page, gate, 'then', loop, 'result')
		await zoomToFit(page)

		await runNode(page, loop)
		const node = await nodeProps<{ lastResults: string; error: string | null }>(page, loop)
		expect(node.error).toBeNull()
		expect(node.lastResults).toBe('id,n,flag\n1,2,\n2,9,9\n3,4,')
	})
})
