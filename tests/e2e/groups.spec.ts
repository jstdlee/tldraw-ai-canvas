import { expect, Page, test } from '@playwright/test'
import { createDefaultNode, gotoApp, nodeLocator, nodeProps, runNode, selectShapes, wire, zoomToFit } from './helpers'

/**
 * WP47: groups. Ungroup works (Ctrl+Shift+G and the menu), a group owns the wires between
 * its own cards, and any group collapses to one card and expands back unchanged.
 */

/** Group the given shapes with the real Ctrl+G key; returns the new group's id. */
async function groupWithKeys(page: Page, ids: string[]): Promise<string> {
	await selectShapes(page, ids)
	await page.keyboard.press('Control+g')
	return page.evaluate(() => {
		const s = (window as any).editor.getOnlySelectedShape()
		if (s?.type !== 'group') throw new Error('Ctrl+G made no group')
		return s.id as string
	})
}

function parentOf(page: Page, id: string): Promise<string | null> {
	return page.evaluate((id) => (window as any).editor.getShape(id)?.parentId ?? null, id)
}

function pageId(page: Page): Promise<string> {
	return page.evaluate(() => (window as any).editor.getCurrentPageId())
}

/** Connection shapes that are children of `parentId`, as "fromNode:port->toNode:port" strings
 * (or with the node ids mapped through `names`). */
async function wiresIn(page: Page, parentId: string, names: Record<string, string> = {}): Promise<string[]> {
	return page.evaluate(
		({ parentId, names }) => {
			const editor = (window as any).editor
			return editor
				.getSortedChildIdsForParent(parentId)
				.map((id: string) => editor.getShape(id))
				.filter((s: any) => s.type === 'connection')
				.map((s: any) => {
					const bs = editor.getBindingsFromShape(s.id, 'connection')
					const start = bs.find((b: any) => b.props.terminal === 'start')
					const end = bs.find((b: any) => b.props.terminal === 'end')
					const n = (id: string) => names[id] ?? id
					return `${n(start?.toId)}:${start?.props.portId}->${n(end?.toId)}:${end?.props.portId}`
				})
				.sort()
		},
		{ parentId, names }
	)
}

/** Every wire on the current page (any parent), same format as `wiresIn`. */
async function allWires(page: Page, names: Record<string, string> = {}): Promise<string[]> {
	return page.evaluate(
		({ names }) => {
			const editor = (window as any).editor
			return editor
				.getCurrentPageShapes()
				.filter((s: any) => s.type === 'connection')
				.map((s: any) => {
					const bs = editor.getBindingsFromShape(s.id, 'connection')
					const start = bs.find((b: any) => b.props.terminal === 'start')
					const end = bs.find((b: any) => b.props.terminal === 'end')
					const n = (id: string) => names[id] ?? id
					return `${n(start?.toId)}:${start?.props.portId}->${n(end?.toId)}:${end?.props.portId}`
				})
				.sort()
		},
		{ names }
	)
}

async function pagePositions(page: Page, ids: string[]): Promise<Record<string, { x: number; y: number }>> {
	return page.evaluate((ids) => {
		const editor = (window as any).editor
		return Object.fromEntries(
			ids.map((id) => {
				const b = editor.getShapePageBounds(id)
				return [id, { x: b.x, y: b.y }]
			})
		)
	}, ids)
}

test.describe('groups (WP47)', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('Ctrl+G then Ctrl+Shift+G puts the shapes back on the page', async ({ page }) => {
		const a = await createDefaultNode(page, 'prompt', { text: 'a' }, { x: 0, y: 0 })
		const b = await createDefaultNode(page, 'prompt', { text: 'b' }, { x: 500, y: 0 })
		await zoomToFit(page)
		const groupId = await groupWithKeys(page, [a, b])
		expect(await parentOf(page, a)).toBe(groupId)

		await page.keyboard.press('Control+Shift+G')
		const page1 = await pageId(page)
		expect(await parentOf(page, a)).toBe(page1)
		expect(await parentOf(page, b)).toBe(page1)
		// Not ungrouped and grouped again (the old bug): no group is left at all.
		const groups = await page.evaluate(() =>
			(window as any).editor.getCurrentPageShapes().filter((s: any) => s.type === 'group').length
		)
		expect(groups).toBe(0)
	})

	test('the context menu Ungroup item ungroups, also from inside a dived-into group', async ({ page }) => {
		const a = await createDefaultNode(page, 'prompt', { text: 'a' }, { x: 0, y: 0 })
		const b = await createDefaultNode(page, 'prompt', { text: 'b' }, { x: 500, y: 0 })
		await zoomToFit(page)
		await groupWithKeys(page, [a, b])

		await nodeLocator(page, a).click({ button: 'right', position: { x: 40, y: 12 } })
		await page.getByRole('menuitem', { name: /^Ungroup/ }).first().click()
		expect(await parentOf(page, a)).toBe(await pageId(page))

		// Dived into: focus the group, select one card inside, Ctrl+Shift+G ungroups the focused group.
		const groupId = await groupWithKeys(page, [a, b])
		await page.evaluate(
			({ groupId, a }) => {
				const editor = (window as any).editor
				editor.setFocusedGroup(groupId)
				editor.select(a)
			},
			{ groupId, a }
		)
		await page.keyboard.press('Control+Shift+G')
		expect(await parentOf(page, a)).toBe(await pageId(page))
		expect(await page.evaluate(() => (window as any).editor.getFocusedGroupId())).toBe(await pageId(page))
	})

	test('a wire between two grouped cards belongs to the group; a wire to outside stays and follows', async ({ page }) => {
		const out = await createDefaultNode(page, 'prompt', { text: 'outside' }, { x: -600, y: 0 })
		const a = await createDefaultNode(page, 'text_tool', { op: 'trim' }, { x: 0, y: 0 })
		const b = await createDefaultNode(page, 'text_tool', { op: 'upper' }, { x: 500, y: 0 })
		const inner = await wire(page, a, 'output', b, 'input')
		const boundary = await wire(page, out, 'output', a, 'input')
		await zoomToFit(page)

		const groupId = await groupWithKeys(page, [a, b])
		expect(await parentOf(page, inner)).toBe(groupId)
		// keepConnectionsAtBottom works inside the group: the wire is drawn under both cards.
		const wireBelow = await page.evaluate(
			({ groupId, inner }) => {
				const editor = (window as any).editor
				return editor.getSortedChildIdsForParent(groupId)[0] === inner
			},
			{ groupId, inner }
		)
		expect(wireBelow).toBe(true)
		const page1 = await pageId(page)
		expect(await parentOf(page, boundary)).toBe(page1)
		// The group outline includes its wire: the wire's bounds are inside the group's bounds.
		const contained = await page.evaluate(
			({ groupId, inner }) => {
				const editor = (window as any).editor
				return editor.getShapePageBounds(groupId).contains(editor.getShapePageBounds(inner))
			},
			{ groupId, inner }
		)
		expect(contained).toBe(true)

		// Move the group: the boundary wire's end follows card A's input port.
		const before = await page.evaluate((id) => (window as any).editor.getShapePageBounds(id).maxX, boundary)
		await page.evaluate((groupId) => {
			const editor = (window as any).editor
			const g = editor.getShape(groupId)
			editor.updateShape({ id: groupId, type: 'group', x: g.x + 200, y: g.y + 40 })
		}, groupId)
		const after = await page.evaluate((id) => (window as any).editor.getShapePageBounds(id).maxX, boundary)
		expect(after - before).toBeCloseTo(200, 0)
		expect(await parentOf(page, boundary)).toBe(page1)

		// Ungroup: the inner wire returns to the page.
		await selectShapes(page, [groupId])
		await page.keyboard.press('Control+Shift+G')
		expect(await parentOf(page, inner)).toBe(page1)
		expect(await parentOf(page, boundary)).toBe(page1)
	})

	test('tldraw arrows bound at both ends also go into the group', async ({ page }) => {
		const ids = await page.evaluate(() => {
			const editor = (window as any).editor
			editor.createShape({ id: 'shape:g1', type: 'geo', x: 0, y: 0, props: { w: 100, h: 100 } })
			editor.createShape({ id: 'shape:g2', type: 'geo', x: 400, y: 0, props: { w: 100, h: 100 } })
			editor.createShape({ id: 'shape:ar', type: 'arrow', x: 0, y: 0, props: { start: { x: 50, y: 50 }, end: { x: 450, y: 50 } } })
			for (const [terminal, toId] of [
				['start', 'shape:g1'],
				['end', 'shape:g2'],
			]) {
				editor.createBinding({
					type: 'arrow',
					fromId: 'shape:ar',
					toId,
					props: { terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false },
				})
			}
			return ['shape:g1', 'shape:g2']
		})
		await zoomToFit(page)
		const groupId = await groupWithKeys(page, ids)
		expect(await parentOf(page, 'shape:ar')).toBe(groupId)
	})

	test('duplicate, copy/paste and move to page keep a group’s inner wires', async ({ page }) => {
		const a = await createDefaultNode(page, 'text_tool', { op: 'trim' }, { x: 0, y: 0 })
		const b = await createDefaultNode(page, 'text_tool', { op: 'upper' }, { x: 500, y: 0 })
		await wire(page, a, 'output', b, 'input')
		await zoomToFit(page)
		const groupId = await groupWithKeys(page, [a, b])

		// The copy's wire is its own child, bound to the copy's own cards.
		const checkCopy = async (copyId: string) => {
			const result = await page.evaluate(
				({ copyId, a, b }) => {
					const editor = (window as any).editor
					const kids = editor.getSortedChildIdsForParent(copyId).map((id: string) => editor.getShape(id))
					const cards = kids.filter((s: any) => s.type === 'node').map((s: any) => s.id)
					const wires = kids.filter((s: any) => s.type === 'connection')
					const targets = wires.flatMap((w: any) => editor.getBindingsFromShape(w.id, 'connection').map((x: any) => x.toId))
					return {
						cards: cards.length,
						wires: wires.length,
						ownCards: targets.length === 2 && targets.every((t: string) => cards.includes(t)),
						touchesOriginal: targets.some((t: string) => t === a || t === b),
					}
				},
				{ copyId, a, b }
			)
			expect(result).toEqual({ cards: 2, wires: 1, ownCards: true, touchesOriginal: false })
		}

		await selectShapes(page, [groupId])
		await page.keyboard.press('Control+d')
		const dupId = await page.evaluate(() => (window as any).editor.getOnlySelectedShape()?.id)
		expect(dupId).not.toBe(groupId)
		await checkCopy(dupId)

		// Copy / paste through tldraw's own content API (what Ctrl+C / Ctrl+V use, minus the OS clipboard).
		const pastedId = await page.evaluate((groupId) => {
			const editor = (window as any).editor
			const content = editor.getContentFromCurrentPage([groupId])
			editor.putContentOntoCurrentPage(content, { select: true })
			return editor.getOnlySelectedShape()?.id
		}, groupId)
		expect(pastedId).not.toBe(groupId)
		await checkCopy(pastedId)

		// Move to another page: the inner wire goes too.
		const moved = await page.evaluate((groupId) => {
			const editor = (window as any).editor
			const pageId = 'page:other'
			editor.createPage({ id: pageId, name: 'Other' })
			editor.moveShapesToPage([groupId], pageId)
			const g = editor.getShape(groupId)
			const kids = editor.getSortedChildIdsForParent(groupId).map((id: string) => editor.getShape(id).type)
			const wire = editor.getSortedChildIdsForParent(groupId).find((id: string) => editor.getShape(id).type === 'connection')
			return { parent: g?.parentId, kids: kids.sort(), bindings: wire ? editor.getBindingsFromShape(wire, 'connection').length : 0 }
		}, groupId)
		expect(moved).toEqual({ parent: 'page:other', kids: ['connection', 'node', 'node'], bindings: 2 })
	})

	test('collapse a group of three wired cards and a note to one card, run it, expand, collapse again', async ({ page }) => {
		const src = await createDefaultNode(page, 'prompt', { text: '  hello   world  ' }, { x: -700, y: 0 })
		const a = await createDefaultNode(page, 'text_tool', { op: 'trim' }, { x: 0, y: 0 })
		const b = await createDefaultNode(page, 'text_tool', { op: 'upper' }, { x: 450, y: 0 })
		const c = await createDefaultNode(page, 'text_tool', { op: 'remove_extra_spaces' }, { x: 900, y: 0 })
		const sink = await createDefaultNode(page, 'text_tool', { op: 'template', a: '{{input}}!' }, { x: 1700, y: 0 })
		const note = await page.evaluate(() => {
			const editor = (window as any).editor
			editor.createShape({ id: 'shape:note1', type: 'note', x: 0, y: -320 })
			return 'shape:note1'
		})
		await wire(page, src, 'output', a, 'input')
		await wire(page, a, 'output', b, 'input')
		await wire(page, b, 'output', c, 'input')
		await wire(page, c, 'output', sink, 'input')
		await zoomToFit(page)

		const names = { [src]: 'src', [a]: 'a', [b]: 'b', [c]: 'c', [sink]: 'sink' }
		const groupId = await groupWithKeys(page, [a, b, c, note])
		await page.evaluate((groupId) => {
			const editor = (window as any).editor
			editor.updateShape({ id: groupId, type: 'group', meta: { label: 'Clean up' } })
		}, groupId)
		const wiresBefore = await allWires(page, names)
		const inside = [a, b, c, note]
		const posBefore = await pagePositions(page, inside)

		// Collapse with the group label's button.
		await page.locator(`[data-shape-id="${groupId}"] .GroupEdgeLabel-collapse`).click()
		await page.waitForFunction(() => {
			const s = (window as any).editor.getOnlySelectedShape()
			return s?.type === 'node' && s.props.node?.type === 'subgraph'
		})
		const boxId = await page.evaluate(() => (window as any).editor.getOnlySelectedShape().id as string)
		const box = await nodeProps<{
			innerIds: string[]
			extraIds: string[]
			inputs: { nodeId: string; portId: string }[]
			outputs: { nodeId: string; portId: string }[]
		}>(page, boxId)
		expect(box.innerIds.sort()).toEqual([a, b, c].sort())
		expect(box.extraIds).toEqual([note])
		expect(box.inputs.some((p) => p.nodeId === a && p.portId === 'input')).toBe(true)
		expect(box.outputs.map((p) => `${p.nodeId}:${p.portId}`)).toEqual([`${c}:output`])
		const card = await page.evaluate((id) => (window as any).editor.getShape(id).props.label, boxId)
		expect(card).toBe('Clean up')
		expect(await page.evaluate((id) => (window as any).editor.isShapeHidden(id), note)).toBe(true)
		// The card is wired to the outside cards on its own ports.
		const boxWires = await page.evaluate((boxId) => {
			const editor = (window as any).editor
			return editor
				.getBindingsToShape(boxId, 'connection')
				.map((b: any) => b.props.terminal)
				.sort()
		}, boxId)
		expect(boxWires).toEqual(['end', 'start'])

		// Run it: the box runs its inner flow.
		await runNode(page, boxId)
		const outputs = await nodeProps<{ lastOutputs: string | null }>(page, boxId)
		expect(JSON.parse(outputs.lastOutputs ?? '{}')).toEqual({ [`o:${c.slice(6)}:output`]: 'HELLO WORLD' })

		// Expand with the card's button: same label, positions, wires, note back.
		await nodeLocator(page, boxId).getByRole('button', { name: 'Expand' }).click()
		const groupAgain = await page.evaluate(() => (window as any).editor.getOnlySelectedShape()?.id as string)
		expect(await page.evaluate((id) => (window as any).editor.getShape(id).meta.label, groupAgain)).toBe('Clean up')
		const posAfter = await pagePositions(page, inside)
		for (const id of inside) {
			expect(Math.abs(posAfter[id].x - posBefore[id].x)).toBeLessThanOrEqual(1)
			expect(Math.abs(posAfter[id].y - posBefore[id].y)).toBeLessThanOrEqual(1)
		}
		expect(await allWires(page, names)).toEqual(wiresBefore)
		expect(await wiresIn(page, groupAgain, names)).toEqual(['a:output->b:input', 'b:output->c:input'])
		expect(await parentOf(page, note)).toBe(groupAgain)
		expect(await page.evaluate((id) => (window as any).editor.getShape(id).meta.packedIn ?? null, note)).toBe(null)

		// Collapse again with Alt+Shift+C (Alt+C is Compare): same box, same ports, no growth.
		await selectShapes(page, [groupAgain])
		await page.keyboard.press('Alt+Shift+C')
		await page.waitForFunction((boxId) => (window as any).editor.getOnlySelectedShape()?.id === boxId, boxId)
		const box2 = await nodeProps<typeof box>(page, boxId)
		expect(box2.inputs).toEqual(box.inputs)
		expect(box2.outputs).toEqual(box.outputs)
		expect(box2.innerIds.sort()).toEqual(box.innerIds.sort())
		expect(box2.extraIds).toEqual(box.extraIds)

		await nodeLocator(page, boxId).getByRole('button', { name: 'Expand' }).click()
		const posAgain = await pagePositions(page, inside)
		for (const id of inside) {
			expect(Math.abs(posAgain[id].x - posBefore[id].x)).toBeLessThanOrEqual(1)
			expect(Math.abs(posAgain[id].y - posBefore[id].y)).toBeLessThanOrEqual(1)
		}
		expect(await allWires(page, names)).toEqual(wiresBefore)

		// Ungroup an expanded box's group: the hidden box goes, the cards stay, wires stay.
		const lastGroup = await page.evaluate(() => (window as any).editor.getOnlySelectedShape()?.id as string)
		await selectShapes(page, [lastGroup])
		await page.keyboard.press('Control+Shift+G')
		const page1 = await pageId(page)
		for (const id of inside) expect(await parentOf(page, id)).toBe(page1)
		expect(await page.evaluate((id) => Boolean((window as any).editor.getShape(id)), boxId)).toBe(false)
		await page.evaluate(() => new Promise((r) => setTimeout(r, 50)))
		for (const id of inside) {
			expect(await page.evaluate((id) => (window as any).editor.isShapeHidden(id), id)).toBe(false)
		}
		expect(await allWires(page, names)).toEqual(wiresBefore)
	})
})
