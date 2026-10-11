import { describe, expect, it } from 'vitest'
import { upstreamOrder, UpstreamGraph } from '../shared/upstreamOrder'

describe('upstreamOrder', () => {
	it('orders a diamond graph dependency-first', () => {
		// A -> B -> D, A -> C -> D. All stale.
		const graph: UpstreamGraph = {
			A: { dependsOn: [], outOfDate: true },
			B: { dependsOn: ['A'], outOfDate: true },
			C: { dependsOn: ['A'], outOfDate: true },
			D: { dependsOn: ['B', 'C'], outOfDate: true },
		}
		const order = upstreamOrder(graph, 'D')
		// A must come before both B and C; B and C must come before... nothing after (D excluded).
		expect(order).toContain('A')
		expect(order).toContain('B')
		expect(order).toContain('C')
		expect(order).not.toContain('D')
		expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'))
		expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'))
		// A appears once even though it is reached through two paths.
		expect(order.filter((id) => id === 'A')).toHaveLength(1)
	})

	it('skips an already up-to-date node and does not look past it', () => {
		// A -> B -> D. B is up to date, so A (further upstream) is never visited
		// even though A itself is marked stale.
		const graph: UpstreamGraph = {
			A: { dependsOn: [], outOfDate: true },
			B: { dependsOn: ['A'], outOfDate: false },
			D: { dependsOn: ['B'], outOfDate: true },
		}
		expect(upstreamOrder(graph, 'D')).toEqual([])
	})

	it('runs only the stale branch of a mixed diamond', () => {
		const graph: UpstreamGraph = {
			A: { dependsOn: [], outOfDate: true },
			B: { dependsOn: ['A'], outOfDate: false },
			C: { dependsOn: ['A'], outOfDate: true },
			D: { dependsOn: ['B', 'C'], outOfDate: true },
		}
		expect(upstreamOrder(graph, 'D')).toEqual(['A', 'C'])
	})

	it('does not loop forever on a cycle', () => {
		const graph: UpstreamGraph = {
			A: { dependsOn: ['B'], outOfDate: true },
			B: { dependsOn: ['A'], outOfDate: true },
		}
		expect(() => upstreamOrder(graph, 'A')).not.toThrow()
		// A revisits itself through B; the guard stops the second visit, so each still appears once.
		expect(upstreamOrder(graph, 'A')).toEqual(['A', 'B'])
	})

	it('returns an empty list for an unknown target or a target with no inputs', () => {
		expect(upstreamOrder({}, 'missing')).toEqual([])
		expect(upstreamOrder({ A: { dependsOn: [], outOfDate: true } }, 'A')).toEqual([])
	})
})
