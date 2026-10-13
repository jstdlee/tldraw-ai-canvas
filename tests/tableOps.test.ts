import { describe, expect, it } from 'vitest'
import { opSpec, runTable, TABLE_OPS, type TableJob } from '../shared/tableOps'

const CSV = 'name,city,score\nAda,Paris,3\nLin,Oslo,5\nBea,Paris,7'

function job(patch: Partial<TableJob>): TableJob {
	return {
		format: 'auto',
		op: 'select',
		columns: '',
		column: '',
		as: '',
		expr: '',
		sep: '',
		pattern: '',
		with: '',
		name: '',
		extra: '',
		...patch,
	}
}

describe('opSpec / TABLE_OPS', () => {
	it('finds a spec by id and hides the old join alias', () => {
		expect(opSpec('filter')?.label).toBe('Filter rows')
		expect(opSpec('join')?.hidden).toBe(true)
		expect(opSpec('nope')).toBeUndefined()
	})
})

describe('auto format detection', () => {
	it('detects TSV from a tab in the first line, else CSV', () => {
		expect(runTable('a\tb\n1\t2', job({ op: 'select', columns: 'b' }))).toBe('b\n2')
		expect(runTable('a,b\n1,2', job({ op: 'select', columns: 'b' }))).toBe('b\n2')
	})

	// WP26: runTable now reads every table through shared/tableText.ts's parseTableText, which
	// always auto-detects — a saved node's `format` field (kept only for old canvases) no longer
	// forces anything, so a stored 'tsv' on data that is actually CSV still works.
	it('the stored format field no longer forces parsing (WP26: always auto)', () => {
		expect(runTable('a,b\n1,2', job({ format: 'tsv', op: 'select', columns: 'b' }))).toBe('b\n2')
	})
})

describe('new column ops', () => {
	it('drop removes the named columns', () => {
		expect(runTable(CSV, job({ op: 'drop', columns: 'city' }))).toBe('name,score\nAda,3\nLin,5\nBea,7')
	})

	it('rename renames one column', () => {
		expect(runTable(CSV, job({ op: 'rename', column: 'city', name: 'town' }))).toContain('name,town,score')
	})
})

describe('filter rows', () => {
	it('compares text and numbers, and supports empty checks', () => {
		expect(runTable(CSV, job({ op: 'filter', column: 'city', as: '=', with: 'Paris' }))).toContain('Ada')
		expect(runTable(CSV, job({ op: 'filter', column: 'score', as: '>', with: '4' }))).not.toContain('Ada,Paris,3')
		expect(runTable(CSV, job({ op: 'filter', column: 'city', as: 'notempty' }))).toContain('Lin')
	})

	it('names the operation and missing column in its error', () => {
		expect(() => runTable(CSV, job({ op: 'filter', column: '' }))).toThrow(/Filter rows: choose a column/)
		expect(() => runTable(CSV, job({ op: 'rename', column: 'nme', name: 'x' }))).toThrow(/No column named nme/)
	})
})

describe('head and replicate', () => {
	it('head keeps first or last N rows', () => {
		expect(runTable(CSV, job({ op: 'head', with: '1' }))).toBe('name,city,score\nAda,Paris,3')
		expect(runTable(CSV, job({ op: 'head', with: '-1' }))).toBe('name,city,score\nBea,Paris,7')
	})

	it('replicate repeats each row in place, or the whole table', () => {
		const each = runTable('n\na\nb', job({ op: 'replicate', with: '2', as: 'each' }))
		expect(each).toBe('n\na\na\nb\nb')
		const table = runTable('n\na\nb', job({ op: 'replicate', with: '2', as: 'table' }))
		expect(table).toBe('n\na\nb\na\nb')
	})
})

describe('fill', () => {
	it('fills down and up, and with a fixed value', () => {
		expect(runTable('n,v\na,1\nb,\nc,3', job({ op: 'fill', columns: 'v', as: 'down' }))).toBe('n,v\na,1\nb,1\nc,3')
		expect(runTable('n,v\na,\nb,2', job({ op: 'fill', columns: 'v', as: 'up' }))).toBe('n,v\na,2\nb,2')
		expect(runTable('n,v\na,\nb,2', job({ op: 'fill', columns: 'v', as: 'value', with: 'x' }))).toBe('n,v\na,x\nb,2')
	})
})

describe('split', () => {
	it('splits a column into numbered parts', () => {
		expect(runTable('full\na-b\nc-d-e', job({ op: 'split', column: 'full', sep: '-', name: 'part' }))).toBe(
			'part_1,part_2,part_3\na,b,\nc,d,e'
		)
	})
})

describe('append', () => {
	it('matches columns by name and fills missing with empty', () => {
		const out = runTable('a,b\n1,2', job({ op: 'append' }), 'b,c\n9,8')
		expect(out).toBe('a,b\n1,2\n,9')
	})

	it('errors when the second table is missing', () => {
		expect(() => runTable('a\n1', job({ op: 'append' }))).toThrow(/wire the second table/)
	})
})

describe('lookup', () => {
	const left = 'id,name\n1,Ada\n2,Lin'
	const right = 'id,city\n1,Paris\n3,Oslo'

	it('inner join drops unmatched rows', () => {
		const out = runTable(left, job({ op: 'lookup', column: 'id', as: 'inner' }), right)
		expect(out).toBe('id,name,city\n1,Ada,Paris')
	})

	it('left join keeps unmatched rows with empty cells', () => {
		const out = runTable(left, job({ op: 'lookup', column: 'id', as: 'left' }), right)
		expect(out).toBe('id,name,city\n1,Ada,Paris\n2,Lin,')
	})

	it('errors naming the missing right-side key', () => {
		expect(() => runTable(left, job({ op: 'lookup', column: 'id', with: 'nope' }), right)).toThrow(/no column named nope/)
	})
})

describe('every visible op has a spec entry', () => {
	it('covers the table', () => {
		for (const id of [
			'select', 'drop', 'rename', 'filter', 'regexp', 'sort', 'dedupe', 'head', 'replicate', 'convert', 'replace',
			'fill', 'split', 'formula', 'concat', 'newcol', 'datepart', 'bin', 'case', 'rank', 'cumsum', 'pct', 'append',
			'lookup', 'groupby', 'pivot', 'unpivot',
		]) {
			expect(TABLE_OPS.some((spec) => spec.id === id)).toBe(true)
		}
	})
})

describe('New column ops (WP11 Part B)', () => {
	it('datepart adds a date part column', () => {
		const data = 'name,joined\nAda,2024-03-14\nLin,2024-07-01'
		expect(runTable(data, job({ op: 'datepart', column: 'joined', as: 'month', name: 'month' }))).toBe(
			'name,joined,month\nAda,2024-03-14,3\nLin,2024-07-01,7'
		)
	})

	it('bin buckets numbers by a fixed size', () => {
		const data = 'score\n3\n15\n55'
		expect(runTable(data, job({ op: 'bin', column: 'score', with: '10,50', name: 'bucket' }))).toBe(
			'score,bucket\n3,<10\n15,10–50\n55,50+'
		)
	})

	it('bin accepts explicit edges', () => {
		const data = 'score\n5\n25\n75'
		expect(runTable(data, job({ op: 'bin', column: 'score', with: '0,10,50,100', name: 'bucket' }))).toBe(
			'score,bucket\n5,0–10\n25,10–50\n75,50–100'
		)
	})

	it('case maps values with a default', () => {
		const data = 'status\nA\nB\nZ'
		const pattern = JSON.stringify([
			{ from: 'A', to: 'Active' },
			{ from: 'B', to: 'Blocked' },
		])
		expect(runTable(data, job({ op: 'case', column: 'status', pattern, with: 'Unknown', name: 'label' }))).toBe(
			'status,label\nA,Active\nB,Blocked\nZ,Unknown'
		)
	})

	it('rank orders rows, highest first by default', () => {
		const data = 'name,score\nAda,3\nLin,9\nBea,5'
		expect(runTable(data, job({ op: 'rank', column: 'score', name: 'rank' }))).toBe(
			'name,score,rank\nAda,3,3\nLin,9,1\nBea,5,2'
		)
	})

	it('cumsum keeps a running total, optionally per group', () => {
		const data = 'g,v\na,1\na,2\nb,5'
		expect(runTable(data, job({ op: 'cumsum', column: 'v', name: 'total' }))).toBe('g,v,total\na,1,1\na,2,3\nb,5,8')
		expect(runTable(data, job({ op: 'cumsum', column: 'v', with: 'g', name: 'total' }))).toBe('g,v,total\na,1,1\na,2,3\nb,5,5')
	})

	it('pct computes percent of total, optionally per group', () => {
		const data = 'g,v\na,1\na,3\nb,4'
		expect(runTable(data, job({ op: 'pct', column: 'v', name: 'pct' }))).toBe('g,v,pct\na,1,12.5\na,3,37.5\nb,4,50')
	})
})

describe('Group and summarise (WP11 Part C)', () => {
	it('accepts multiple group columns and new summary functions', () => {
		const data = 'region,month,score\nE,1,3\nE,1,7\nW,1,5'
		expect(runTable(data, job({ op: 'groupby', column: 'region,month', columns: 'score:sum,score:count_distinct' }))).toBe(
			'region,month,sum_score,count_distinct_score\nE,1,10,2\nW,1,5,1'
		)
	})

	it('median, first and last', () => {
		const data = 'g,v\na,1\na,2\na,3'
		expect(runTable(data, job({ op: 'groupby', column: 'g', columns: 'v:median,v:first,v:last' }))).toBe(
			'g,median_v,first_v,last_v\na,2,1,3'
		)
	})

	it('accepts an alias with col:fn:alias', () => {
		const data = 'g,v\na,1\na,3'
		expect(runTable(data, job({ op: 'groupby', column: 'g', columns: 'v:sum:total' }))).toBe('g,total\na,4')
	})
})

describe('Pivot totals and unpivot (WP11 Part D)', () => {
	it('pivot can fill empty cells and add totals', () => {
		const data = 'name,q,score\nAda,q1,3\nAda,q2,5\nLin,q1,4'
		const out = runTable(data, job({ op: 'pivot', column: 'name', columns: 'q', extra: 'score', as: 'sum', with: '0', totals: true }))
		expect(out).toBe('name,q1,q2,Total\nAda,3,5,8\nLin,4,0,4\nTotal,7,5,12')
	})

	it('unpivot turns value columns into key/value rows', () => {
		const data = 'name,q1,q2\nAda,3,5\nLin,4,6'
		const out = runTable(data, job({ op: 'unpivot', columns: 'name', columns2: 'q1,q2', name: 'quarter', as: 'score' }))
		expect(out).toBe('name,quarter,score\nAda,q1,3\nAda,q2,5\nLin,q1,4\nLin,q2,6')
	})
})

describe('WP27 Part F: DataPipe skip rows', () => {
	it('skip_first defaults to 1 row when "with" is empty', () => {
		expect(runTable(CSV, job({ op: 'skip_first' }))).toBe('name,city,score\nLin,Oslo,5\nBea,Paris,7')
	})

	it('skip_first skips N rows', () => {
		expect(runTable(CSV, job({ op: 'skip_first', with: '2' }))).toBe('name,city,score\nBea,Paris,7')
	})

	it('skip_first rejects a negative or non-numeric count', () => {
		expect(() => runTable(CSV, job({ op: 'skip_first', with: '-1' }))).toThrow()
		expect(() => runTable(CSV, job({ op: 'skip_first', with: 'abc' }))).toThrow()
	})

	it('skip_regex removes rows where any cell matches, when no column is chosen', () => {
		expect(runTable(CSV, job({ op: 'skip_regex', pattern: 'Paris' }))).toBe('name,city,score\nLin,Oslo,5')
	})

	it('skip_regex can target one column', () => {
		expect(runTable(CSV, job({ op: 'skip_regex', pattern: '^A', column: 'name' }))).toBe('name,city,score\nLin,Oslo,5\nBea,Paris,7')
	})

	it('skip_regex is case-sensitive by default, case-insensitive with the flag', () => {
		expect(runTable(CSV, job({ op: 'skip_regex', pattern: 'ada', column: 'name' }))).toBe(
			'name,city,score\nAda,Paris,3\nLin,Oslo,5\nBea,Paris,7'
		)
		expect(runTable(CSV, job({ op: 'skip_regex', pattern: 'ada', column: 'name', totals: true }))).toBe(
			'name,city,score\nLin,Oslo,5\nBea,Paris,7'
		)
	})

	it('skip_regex requires a pattern and surfaces a clear error for an invalid one', () => {
		expect(() => runTable(CSV, job({ op: 'skip_regex' }))).toThrow(/pattern/i)
		expect(() => runTable(CSV, job({ op: 'skip_regex', pattern: '(' }))).toThrow(/invalid pattern/i)
	})
})
