import { describe, expect, it } from 'vitest'
import { getCardDocs, searchCards } from '../shared/cardSearch'

/** WP40 follow-up: "Table" (blank + the 4 templates) must show up in the same Ctrl+P / Insert
 * palette search every node card uses, without colliding with DataPipe (whose own node type id
 * is literally "table" — see shared/cardSearch.ts's tableOpDocs). */
describe('cardSearch: table insert docs (WP40)', () => {
	it('has one blank + four template docs, all with a unique id and insertTable set', () => {
		const tableDocs = getCardDocs().filter((d) => d.insertTable)
		expect(tableDocs.length).toBe(5)
		const ids = new Set(tableDocs.map((d) => d.id))
		expect(ids.size).toBe(5)
		expect(tableDocs.map((d) => d.insertTable).sort()).toEqual(
			['blank', 'checklist', 'comparison', 'issue-list', 'pr-list'].sort()
		)
	})

	it('does not collide with the DataPipe node (its node type id is also "table")', () => {
		const dataPipeDoc = getCardDocs().find((d) => d.id === 'table')
		expect(dataPipeDoc).toBeTruthy()
		expect(dataPipeDoc!.insertTable).toBeUndefined()
		// every table-insert doc uses the canvas-table sentinel type, never the real node type
		for (const doc of getCardDocs().filter((d) => d.insertTable)) {
			expect(doc.type).toBe('canvas-table')
			expect(doc.id).not.toBe('table')
		}
	})

	it('searching "table" surfaces both the DataPipe card and the canvas table docs', () => {
		const results = searchCards('table', getCardDocs())
		const ids = results.map((r) => r.doc.id)
		expect(ids).toContain('table')
		expect(ids.some((id) => id.startsWith('canvas-table:'))).toBe(true)
	})

	it('searching "issue list" finds the Issue list template', () => {
		const results = searchCards('issue list', getCardDocs())
		expect(results[0]?.doc.id).toBe('canvas-table:issue-list')
	})
})
