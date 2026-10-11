import { describe, expect, it } from 'vitest'
import { buildLoadPlan } from '../shared/dbLoadRows'

const CSV_ROWS = [
	['id', 'name', 'score'],
	['1', 'Ada', '9.5'],
	['2', 'Grace', '10'],
]

describe('buildLoadPlan', () => {
	it('creates the table and inserts in insert mode', () => {
		const plan = buildLoadPlan(CSV_ROWS, 'people', 'insert')
		expect(plan.columns).toEqual([
			{ name: 'id', type: 'bigint' },
			{ name: 'name', type: 'text' },
			{ name: 'score', type: 'double' },
		])
		expect(plan.statements[0]).toMatch(/^CREATE TABLE IF NOT EXISTS "people"/)
		expect(plan.statements[1]).toContain("INSERT INTO \"people\"")
		expect(plan.statements[1]).toContain("(1, 'Ada', 9.5)")
		expect(plan.rowCount).toBe(2)
	})

	it('drops the table first in replace mode', () => {
		const plan = buildLoadPlan(CSV_ROWS, 'people', 'replace')
		expect(plan.statements[0]).toBe('DROP TABLE IF EXISTS "people"')
	})

	it('builds an ON CONFLICT upsert on the key column', () => {
		const plan = buildLoadPlan(CSV_ROWS, 'people', 'upsert', 'id')
		expect(plan.statements[1]).toContain('ON CONFLICT ("id") DO UPDATE SET')
		expect(plan.statements[1]).not.toContain('"id" = EXCLUDED."id"')
	})

	it('requires a key column for upsert', () => {
		expect(() => buildLoadPlan(CSV_ROWS, 'people', 'upsert')).toThrow(/key column/)
	})

	it('rejects an unknown upsert key', () => {
		expect(() => buildLoadPlan(CSV_ROWS, 'people', 'upsert', 'nope')).toThrow(/not one of the loaded columns/)
	})

	it('requires a table name', () => {
		expect(() => buildLoadPlan(CSV_ROWS, '', 'insert')).toThrow(/table name/)
	})

	it('batches more than 1000 rows', () => {
		const header = ['a']
		const rows = Array.from({ length: 2500 }, (_, i) => [String(i)])
		const plan = buildLoadPlan([header, ...rows], 't', 'insert')
		// 1 CREATE + 3 batches (1000, 1000, 500)
		expect(plan.statements.length).toBe(4)
	})
})
