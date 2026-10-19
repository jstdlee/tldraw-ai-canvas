import { describe, expect, it } from 'vitest'
import { withTableDefaults } from '../shared/table/canvasTableOps'

/**
 * WP40: the TableShapeUtil props migration (client/pipeline/table/TableShapeUtil.tsx,
 * tableShapeMigrations) delegates entirely to withTableDefaults — it just assigns
 * `props.table = withTableDefaults(props.table)` and folds an early-draft top-level
 * `headerRow` field into `props.table.headerRow`. The migration itself needs tldraw's
 * Editor/Store to construct (it's wired up and exercised end-to-end in
 * tests/e2e/old-canvas-migration.spec.ts); what's unit-testable in Node is the pure
 * function it calls, which this file covers directly (see also tests/canvasTableOps.test.ts).
 */
describe('table shape migration data (EnsureTableDefaults step logic)', () => {
	it('a record with no table prop at all gets a full default table', () => {
		const result = withTableDefaults(undefined)
		expect(result.columns.length).toBeGreaterThan(0)
		expect(result.rows.length).toBeGreaterThan(0)
		expect(typeof result.headerRow).toBe('boolean')
	})

	it('folding an early-draft top-level headerRow into props.table.headerRow (simulating the up() step)', () => {
		const props: any = {
			table: { columns: [{ id: 'c1', name: 'A' }], rows: [{ id: 'r1', cells: { c1: 'x' } }] },
			headerRow: false,
		}
		props.table = withTableDefaults(props.table)
		if (typeof props.headerRow !== 'undefined') {
			props.table.headerRow = !!props.headerRow
			delete props.headerRow
		}
		expect(props.table.headerRow).toBe(false)
		expect(props.headerRow).toBeUndefined()
		expect(props.table.rows[0].cells.c1).toBe('x')
	})

	it('a malformed column (missing width/type) is repaired without losing its name/id', () => {
		const result = withTableDefaults({
			columns: [{ id: 'keep-me', name: 'Kept' } as any],
			rows: [],
		})
		expect(result.columns[0].id).toBe('keep-me')
		expect(result.columns[0].name).toBe('Kept')
		expect(result.columns[0].width).toBeGreaterThan(0)
		expect(result.columns[0].type).toBe('text')
		// no rows -> one blank row is synthesized so the shape never renders empty
		expect(result.rows).toHaveLength(1)
	})
})
