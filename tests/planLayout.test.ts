import { describe, expect, it } from 'vitest'
import { AiPlan } from '../shared/aiPlan'
import { layoutPlan, LayoutBox } from '../shared/planLayout'

function plan(partial: Partial<AiPlan>): AiPlan {
	return { summary: '', add: [], update: [], wires: [], unwire: [], notes: [], arrange: 'tidy', ...partial }
}

const sizeOf = () => ({ w: 200, h: 100 })

function overlaps(a: LayoutBox, b: LayoutBox, gap = 0): boolean {
	return !(
		a.x + a.w + gap <= b.x ||
		b.x + b.w + gap <= a.x ||
		a.y + a.h + gap <= b.y ||
		b.y + b.h + gap <= a.y
	)
}

describe('layoutPlan', () => {
	it('places a chain left to right with increasing x', () => {
		const p = plan({
			add: [
				{ ref: 'a', type: 'prompt', props: {} },
				{ ref: 'b', type: 'table', props: {} },
				{ ref: 'c', type: 'chart', props: {} },
			],
			wires: [
				{ from: 'a', fromPort: 'output', to: 'b', toPort: 'data' },
				{ from: 'b', fromPort: 'output', to: 'c', toPort: 'data' },
			],
		})
		const result = layoutPlan(p, [], sizeOf)
		expect(result.b.x).toBeGreaterThan(result.a.x)
		expect(result.c.x).toBeGreaterThan(result.b.x)
	})

	it('never overlaps existing boxes', () => {
		const existing: LayoutBox[] = [{ id: 'e1', x: 0, y: 0, w: 200, h: 100 }]
		const p = plan({
			add: [{ ref: 'a', type: 'prompt', props: {} }],
			wires: [{ from: 'e1', fromPort: 'output', to: 'a', toPort: 'data' }],
		})
		const result = layoutPlan(p, existing, sizeOf)
		const box: LayoutBox = { id: 'a', x: result.a.x, y: result.a.y, w: 200, h: 100 }
		expect(overlaps(box, existing[0], 48)).toBe(false)
	})

	it('never overlaps other new nodes either', () => {
		const p = plan({
			add: [
				{ ref: 'a', type: 'prompt', props: {} },
				{ ref: 'b', type: 'prompt', props: {} },
				{ ref: 'c', type: 'table', props: {} },
			],
			wires: [
				{ from: 'a', fromPort: 'output', to: 'c', toPort: 'data' },
				{ from: 'b', fromPort: 'output', to: 'c', toPort: 'extra' },
			],
		})
		const result = layoutPlan(p, [], sizeOf)
		const boxes: LayoutBox[] = Object.entries(result).map(([id, pos]) => ({ id, x: pos.x, y: pos.y, w: 200, h: 100 }))
		for (let i = 0; i < boxes.length; i++) {
			for (let j = i + 1; j < boxes.length; j++) {
				expect(overlaps(boxes[i], boxes[j], 48), `${boxes[i].id} vs ${boxes[j].id}`).toBe(false)
			}
		}
	})

	it('places a node with no wires at all below the selection', () => {
		const existing: LayoutBox[] = [{ id: 'e1', x: 0, y: 0, w: 200, h: 100 }]
		const p = plan({ add: [{ ref: 'a', type: 'prompt', props: {} }] })
		const result = layoutPlan(p, existing, sizeOf)
		expect(result.a.y).toBeGreaterThanOrEqual(100)
	})

	it('is deterministic for the same input', () => {
		const p = plan({
			add: [
				{ ref: 'a', type: 'prompt', props: {} },
				{ ref: 'b', type: 'table', props: {} },
			],
			wires: [{ from: 'a', fromPort: 'output', to: 'b', toPort: 'data' }],
		})
		const first = layoutPlan(p, [], sizeOf)
		const second = layoutPlan(p, [], sizeOf)
		expect(first).toEqual(second)
	})

	it('never moves an existing node', () => {
		const existing: LayoutBox[] = [{ id: 'e1', x: 50, y: 60, w: 200, h: 100 }]
		const p = plan({ add: [{ ref: 'a', type: 'prompt', props: {} }], wires: [{ from: 'e1', fromPort: 'output', to: 'a', toPort: 'data' }] })
		layoutPlan(p, existing, sizeOf)
		expect(existing[0]).toEqual({ id: 'e1', x: 50, y: 60, w: 200, h: 100 })
	})

	// WP22 B2: "arrange: tidy" also repositions existing cards named in `movable`.
	describe('movable (tidy arrange moves existing cards too)', () => {
		it('repositions a movable existing node to the right of what feeds it', () => {
			const existing: LayoutBox[] = [
				{ id: 'src', x: 0, y: 0, w: 200, h: 100 },
				{ id: 'mid', x: 20, y: 500, w: 200, h: 100 }, // far away before tidy
			]
			const p = plan({ wires: [{ from: 'src', fromPort: 'output', to: 'mid', toPort: 'data' }] })
			const result = layoutPlan(p, existing, sizeOf, 48, new Set(['mid']))
			expect(result.mid).toBeDefined()
			expect(result.mid.x).toBeGreaterThan(existing[0].x)
			expect(result.src).toBeUndefined() // "src" isn't movable: it keeps its position (no entry)
		})

		it('leaves a movable node with no wire in the plan untouched (no result entry)', () => {
			const existing: LayoutBox[] = [{ id: 'e1', x: 10, y: 10, w: 200, h: 100 }]
			const p = plan({})
			const result = layoutPlan(p, existing, sizeOf, 48, new Set(['e1']))
			expect(result.e1).toBeUndefined()
		})

		it('a new node wired to a movable existing node still avoids overlapping it at its new spot', () => {
			const existing: LayoutBox[] = [
				{ id: 'src', x: 0, y: 0, w: 200, h: 100 },
				{ id: 'mid', x: 20, y: 500, w: 200, h: 100 },
			]
			const p = plan({
				add: [{ ref: 'b', type: 'prompt', props: {} }],
				wires: [
					{ from: 'src', fromPort: 'output', to: 'mid', toPort: 'data' },
					{ from: 'mid', fromPort: 'output', to: 'b', toPort: 'data' },
				],
			})
			const result = layoutPlan(p, existing, sizeOf, 48, new Set(['mid']))
			const midBox: LayoutBox = { id: 'mid', x: result.mid.x, y: result.mid.y, w: 200, h: 100 }
			const bBox: LayoutBox = { id: 'b', x: result.b.x, y: result.b.y, w: 200, h: 100 }
			expect(overlaps(midBox, bBox, 48)).toBe(false)
			expect(result.b.x).toBeGreaterThan(result.mid.x)
		})
	})
})
