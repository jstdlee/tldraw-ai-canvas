import { describe, expect, it } from 'vitest'
import { chartOption } from '../shared/chartOption'
import { FEATURE_ROWS } from '../shared/featureList'
import { concatMemberText } from '../shared/groupText'
import { freeModels, type HubModel } from '../shared/modelPick'
import { previewReplace, searchHits } from '../shared/searchOps'
import { runTable, type TableJob } from '../shared/tableOps'

const CSV = 'name,score\nada,9\nbea,4'

function job(patch: Partial<TableJob>): TableJob {
	return {
		format: 'csv',
		op: 'select',
		columns: 'name,score',
		column: 'name',
		as: 'upper',
		expr: '',
		sep: ' ',
		pattern: 'a',
		with: 'A',
		name: 'next',
		extra: '',
		...patch,
	}
}

function hub(id: string, price: number, patch: Partial<HubModel> = {}): HubModel {
	return {
		id,
		name: id,
		promptPrice: price,
		completionPrice: price,
		input: ['text'],
		output: ['text'],
		reasoning: false,
		free: price === 0,
		source: 'test',
		...patch,
	}
}

describe('table operations', () => {
	it('selects columns, builds a column, and replaces with a regexp', () => {
		expect(runTable(CSV, job({ op: 'select', columns: 'name' }))).toBe('name\nada\nbea')
		expect(runTable(CSV, job({ op: 'newcol', expr: 'upper(name)', name: 'label' }))).toContain('ADA')
		expect(runTable(CSV, job({ op: 'replace', column: 'name', pattern: 'a', with: 'A' }))).toContain('AdA')
		expect(runTable(CSV, job({ op: 'regexp', column: 'name', pattern: '^b' }))).not.toContain('ada')
		expect(runTable('a\tb\n1\t2', job({ format: 'tsv', op: 'select', columns: 'b' }))).toBe('b\n2')
	})

	it('groups and aggregates (sum, count, avg)', () => {
		const data = 'city,score\nParis,3\nOslo,5\nParis,7'
		expect(runTable(data, job({ op: 'groupby', column: 'city', columns: 'score:sum' }))).toBe('city,sum_score\nParis,10\nOslo,5')
		expect(runTable(data, job({ op: 'groupby', column: 'city', columns: '*:count' }))).toBe('city,count_*\nParis,2\nOslo,1')
	})

	it('pivots rows into columns', () => {
		const data = 'name,q,score\nAda,q1,3\nAda,q2,5\nLin,q1,4'
		const out = runTable(data, job({ op: 'pivot', column: 'name', columns: 'q', extra: 'score', as: 'sum' }))
		expect(out.split('\n')[0]).toBe('name,q1,q2')
		expect(out).toContain('Ada,3,5')
		expect(out).toContain('Lin,4,')
	})

	it('dedupes and sorts', () => {
		expect(runTable('n\na\nb\na', job({ op: 'dedupe', columns: 'n' }))).toBe('n\na\nb')
		expect(runTable('n,s\na,2\nb,1', job({ op: 'sort', columns: 's', as: 'desc' }))).toBe('n,s\na,2\nb,1')
	})
})

describe('search and group text', () => {
	it('finds a case-free match and previews a replace', () => {
		const query = { text: 'h', regexp: false, caseSensitive: false, component: '', asset: '' }
		expect(searchHits('Hello', query)).toEqual([{ index: 0, length: 1 }])
		expect(previewReplace('aba', { ...query, text: 'a' }, 'A')).toEqual({ next: 'AbA', count: 2 })
	})

	it('joins member text with new lines', () => {
		expect(concatMemberText(['one  ', '', 'two\n'])).toBe('one\ntwo')
	})
})

describe('model lists', () => {
	it('keeps only free models', () => {
		const models = [hub('cheap', 0), hub('mid', 2), hub('costly', 9)]
		expect(freeModels(models).map((model) => model.id)).toEqual(['cheap'])
	})
})

describe('chart option', () => {
	it('builds a bar series and does not animate', () => {
		const option = chartOption(CSV, 'csv', 'bar', 'name', 'score') as {
			animation: boolean
			series: { type: string; data: number[] }[]
		}
		expect(option.animation).toBe(false)
		expect(option.series[0]?.type).toBe('bar')
		expect(option.series[0]?.data).toEqual([9, 4])
	})
})

describe('feature list', () => {
	it('compares this app with tldraw', () => {
		expect(FEATURE_ROWS.length).toBeGreaterThan(10)
		expect(FEATURE_ROWS.some((row) => /pandas/i.test(row.here))).toBe(true)
		expect(FEATURE_ROWS.some((row) => /backup folder/i.test(row.here))).toBe(true)
	})
})

