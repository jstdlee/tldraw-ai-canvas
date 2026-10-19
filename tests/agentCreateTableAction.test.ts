import { describe, expect, it } from 'vitest'
import { CreateTableAction } from '../shared/schema/AgentActionSchemas'

describe('agent create-table action (WP40): schema', () => {
	it('parses a valid create-table action', () => {
		const result = CreateTableAction.safeParse({
			_type: 'create-table',
			intent: 'Make a PR list with 2 PRs',
			shapeId: 'table1',
			x: 100,
			y: 200,
			columns: ['PR', 'Title', 'Status'],
			rows: [
				['101', 'Fix login bug', 'Open'],
				['102', 'Add dark mode', 'Merged'],
			],
		})
		expect(result.success).toBe(true)
	})

	it('rejects the wrong _type literal', () => {
		expect(CreateTableAction.safeParse({ _type: 'create', shapeId: 'a', x: 0, y: 0, columns: [], rows: [], intent: '' }).success).toBe(
			false
		)
	})

	it('requires columns and rows to be arrays', () => {
		expect(
			CreateTableAction.safeParse({ _type: 'create-table', intent: '', shapeId: 'a', x: 0, y: 0, rows: [] }).success
		).toBe(false)
		expect(
			CreateTableAction.safeParse({ _type: 'create-table', intent: '', shapeId: 'a', x: 0, y: 0, columns: [] }).success
		).toBe(false)
	})

	it('allows an empty table (zero rows) as long as columns/rows are present', () => {
		expect(
			CreateTableAction.safeParse({
				_type: 'create-table',
				intent: 'blank table',
				shapeId: 'a',
				x: 0,
				y: 0,
				columns: ['A', 'B'],
				rows: [],
			}).success
		).toBe(true)
	})
})
