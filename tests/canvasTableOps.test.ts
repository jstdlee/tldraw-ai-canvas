import { describe, expect, it } from 'vitest'
import {
	buildTableTemplate,
	computeAutoFitRowHeight,
	computeAutoFitWidth,
	convertCellValue,
	createEmptyTable,
	deleteColumn,
	deleteRow,
	duplicateRow,
	insertColumn,
	insertRow,
	parseRawGrid,
	pasteIntoTable,
	reorderColumn,
	reorderRow,
	setColumnType,
	sortByColumn,
	tableFromGrid,
	toCSV,
	toMarkdown,
	withTableDefaults,
} from '../shared/table/canvasTableOps'

describe('createEmptyTable / templates', () => {
	it('creates the requested shape', () => {
		const t = createEmptyTable(3, 2)
		expect(t.columns).toHaveLength(3)
		expect(t.rows).toHaveLength(2)
		expect(t.headerRow).toBe(true)
		// every row has a cell for every column
		for (const row of t.rows) for (const col of t.columns) expect(col.id in row.cells).toBe(true)
	})

	it('every template has unique column ids and at least one row', () => {
		for (const id of ['issue-list', 'pr-list', 'checklist', 'comparison'] as const) {
			const t = buildTableTemplate(id)
			const ids = new Set(t.columns.map((c) => c.id))
			expect(ids.size).toBe(t.columns.length)
			expect(t.rows.length).toBeGreaterThan(0)
		}
	})
})

describe('parseRawGrid', () => {
	it('detects TSV from a tab', () => {
		expect(parseRawGrid('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
	})

	it('detects CSV with quoted commas', () => {
		expect(parseRawGrid('a,"b, c"\n1,2')).toEqual([['a', 'b, c'], ['1', '2']])
	})

	it('detects a Markdown pipe table and drops the --- separator row', () => {
		const md = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |'
		expect(parseRawGrid(md)).toEqual([['A', 'B'], ['1', '2'], ['3', '4']])
	})
})

describe('tableFromGrid', () => {
	it('builds columns from the header row and cells from the rest', () => {
		const t = tableFromGrid([['Name', 'City'], ['Ada', 'Paris']], true)
		expect(t.columns.map((c) => c.name)).toEqual(['Name', 'City'])
		expect(t.rows[0].cells[t.columns[0].id]).toBe('Ada')
		expect(t.rows[0].cells[t.columns[1].id]).toBe('Paris')
	})
})

describe('pasteIntoTable', () => {
	it('grows columns and rows as needed, landing exactly at the start cell', () => {
		const t = createEmptyTable(2, 2)
		const grown = pasteIntoTable(t, 1, 1, [['x', 'y', 'z'], ['p', 'q', 'r']])
		expect(grown.columns).toHaveLength(4)
		expect(grown.rows).toHaveLength(3)
		expect(grown.rows[1].cells[grown.columns[1].id]).toBe('x')
		expect(grown.rows[2].cells[grown.columns[3].id]).toBe('r')
		// untouched cell at (0,0) stays empty
		expect(grown.rows[0].cells[grown.columns[0].id]).toBe('')
	})

	it('does not treat the pasted first row as a header', () => {
		const t = createEmptyTable(2, 1)
		const next = pasteIntoTable(t, 0, 0, [['Alice', '30']])
		expect(next.rows[0].cells[next.columns[0].id]).toBe('Alice')
		expect(next.columns[0].name).not.toBe('Alice')
	})
})

describe('insert/delete/duplicate/reorder row & column', () => {
	it('insertRow above/below and deleteRow', () => {
		const t = createEmptyTable(2, 2)
		const withAbove = insertRow(t, 0, 'above')
		expect(withAbove.rows).toHaveLength(3)
		const withBelow = insertRow(t, 0, 'below')
		expect(withBelow.rows[1].id).not.toBe(t.rows[0].id)
		const deleted = deleteRow(t, 0)
		expect(deleted.rows).toHaveLength(1)
		expect(deleted.rows[0].id).toBe(t.rows[1].id)
	})

	it('deleteRow never leaves zero rows', () => {
		const t = createEmptyTable(1, 1)
		const deleted = deleteRow(t, 0)
		expect(deleted.rows).toHaveLength(1)
	})

	it('duplicateRow copies cell values with a new id', () => {
		const t = createEmptyTable(1, 1)
		t.rows[0].cells[t.columns[0].id] = 'hello'
		const dup = duplicateRow(t, 0)
		expect(dup.rows).toHaveLength(2)
		expect(dup.rows[1].cells[t.columns[0].id]).toBe('hello')
		expect(dup.rows[1].id).not.toBe(dup.rows[0].id)
	})

	it('insertColumn left/right carries empty cells for every row, deleteColumn removes just that column', () => {
		const t = createEmptyTable(2, 3)
		const withCol = insertColumn(t, 0, 'left')
		expect(withCol.columns).toHaveLength(3)
		for (const row of withCol.rows) expect(withCol.columns[0].id in row.cells).toBe(true)
		const deleted = deleteColumn(withCol, 0)
		expect(deleted.columns).toHaveLength(2)
	})

	it('deleteColumn never leaves zero columns', () => {
		const t = createEmptyTable(1, 1)
		const deleted = deleteColumn(t, 0)
		expect(deleted.columns).toHaveLength(1)
	})

	it('reorderRow / reorderColumn move the item to the target index', () => {
		const t = createEmptyTable(3, 3)
		const ids = t.rows.map((r) => r.id)
		const reordered = reorderRow(t, 0, 2)
		expect(reordered.rows.map((r) => r.id)).toEqual([ids[1], ids[2], ids[0]])
		const colIds = t.columns.map((c) => c.id)
		const colReordered = reorderColumn(t, 2, 0)
		expect(colReordered.columns.map((c) => c.id)).toEqual([colIds[2], colIds[0], colIds[1]])
	})
})

describe('sortByColumn', () => {
	it('sorts text ascending/descending, stable on ties', () => {
		const t = createEmptyTable(1, 3)
		const col = t.columns[0].id
		t.rows[0].cells[col] = 'b'
		t.rows[1].cells[col] = 'a'
		t.rows[2].cells[col] = 'a'
		const asc = sortByColumn(t, 0, 'asc')
		expect(asc.rows.map((r) => r.cells[col])).toEqual(['a', 'a', 'b'])
		expect(asc.rows[0].id).toBe(t.rows[1].id) // stable: original row 1 before row 2
		const desc = sortByColumn(t, 0, 'desc')
		expect(desc.rows.map((r) => r.cells[col])).toEqual(['b', 'a', 'a'])
	})

	it('sorts a number column numerically, not lexicographically', () => {
		const t = createEmptyTable(1, 3)
		const col = t.columns[0].id
		t.columns[0].type = 'number'
		t.rows[0].cells[col] = '10'
		t.rows[1].cells[col] = '2'
		t.rows[2].cells[col] = '1'
		const asc = sortByColumn(t, 0, 'asc')
		expect(asc.rows.map((r) => r.cells[col])).toEqual(['1', '2', '10'])
	})
})

describe('column type conversion', () => {
	it('converts text to number, keeping only what parses', () => {
		expect(convertCellValue('42', 'number')).toBe('42')
		expect(convertCellValue('not a number', 'number')).toBe('')
	})

	it('converts to checkbox from common truthy spellings', () => {
		expect(convertCellValue('x', 'checkbox')).toBe('true')
		expect(convertCellValue('Yes', 'checkbox')).toBe('true')
		expect(convertCellValue('no', 'checkbox')).toBe('')
	})

	it('setColumnType auto-creates a status option for an existing value instead of dropping it', () => {
		const t = createEmptyTable(1, 1)
		t.rows[0].cells[t.columns[0].id] = 'Shipped'
		const next = setColumnType(t, 0, 'status')
		const opt = next.columns[0].options?.find((o) => o.label === 'Shipped')
		expect(opt).toBeTruthy()
		expect(next.rows[0].cells[next.columns[0].id]).toBe(opt!.id)
	})

	it('setColumnType status -> text reads back the option label, not its id', () => {
		const t = createEmptyTable(1, 1)
		t.columns[0].type = 'status'
		t.columns[0].options = [{ id: 'opt1', label: 'Done', color: 'green' }]
		t.rows[0].cells[t.columns[0].id] = 'opt1'
		const next = setColumnType(t, 0, 'text')
		expect(next.rows[0].cells[next.columns[0].id]).toBe('Done')
	})
})

describe('export', () => {
	it('toCSV / toMarkdown include the header and render checkbox/status cells as display text', () => {
		const t = createEmptyTable(2, 1)
		t.columns[1].type = 'checkbox'
		t.rows[0].cells[t.columns[1].id] = 'true'
		const csv = toCSV(t)
		expect(csv.split('\n')[0]).toBe(`${t.columns[0].name},${t.columns[1].name}`)
		expect(csv).toContain('x')
		const md = toMarkdown(t)
		expect(md.split('\n')[0]).toContain(t.columns[0].name)
		expect(md.split('\n')[1]).toMatch(/^\|( --- \|)+$/)
	})
})

describe('autofit math', () => {
	it('computeAutoFitWidth clamps to min/max and adds padding', () => {
		expect(computeAutoFitWidth([10, 50, 20], { padding: 10, min: 20, max: 200 })).toBe(60)
		expect(computeAutoFitWidth([5], { padding: 10, min: 40, max: 200 })).toBe(40)
		expect(computeAutoFitWidth([1000], { padding: 10, min: 40, max: 200 })).toBe(200)
	})

	it('computeAutoFitRowHeight clamps and pads similarly', () => {
		expect(computeAutoFitRowHeight([40], { padding: 8, min: 24, max: 300 })).toBe(48)
		expect(computeAutoFitRowHeight([], { padding: 8, min: 24, max: 300 })).toBe(24)
	})
})

describe('withTableDefaults (migration)', () => {
	it('fills a missing/empty table with a default grid', () => {
		expect(withTableDefaults(undefined).columns.length).toBeGreaterThan(0)
		expect(withTableDefaults({ columns: [] }).rows.length).toBeGreaterThan(0)
	})

	it('fills missing column/row fields on a partial old table without dropping data', () => {
		const partial = {
			columns: [{ id: 'c1', name: 'Name' } as any],
			rows: [{ id: 'r1', cells: { c1: 'Ada' } } as any],
		}
		const t = withTableDefaults(partial)
		expect(t.columns[0].width).toBeGreaterThan(0)
		expect(t.columns[0].type).toBe('text')
		expect(t.rows[0].cells.c1).toBe('Ada')
		expect(t.headerRow).toBe(true)
	})
})
