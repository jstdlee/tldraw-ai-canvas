import { describe, expect, it } from 'vitest'
import { chartOption } from '../shared/chartOption'
import { FEATURE_ROWS } from '../shared/featureList'
import { concatMemberText } from '../shared/groupText'
import { freeModels, pickCandidates, type HubModel } from '../shared/modelPick'
import { previewReplace, searchHits } from '../shared/searchOps'
import { runTable, type TableJob } from '../shared/tableOps'
import { s3Authorization } from '../server/batchRoutes'

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

describe('model bands', () => {
	it('uses a price third and says it is not an IQ score', () => {
		const models = [hub('cheap', 0), hub('mid', 2), hub('costly', 9), hub('coder-a', 1, { name: 'coder-a' })]
		const low = pickCandidates(models, 'chat', 'low')
		expect(low[0]?.id).toBe('cheap')
		expect(low[0]?.reason).toContain('Not an IQ score.')
		expect(pickCandidates(models, 'coding', 'low').some((pick) => pick.id === 'coder-a')).toBe(true)
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
		expect(FEATURE_ROWS.some((row) => /Google Drive/i.test(row.here))).toBe(true)
	})
})

describe('s3 signature', () => {
	it('signs a put without sending the secret as a header value', () => {
		const signed = s3Authorization(
			{
				endpoint: 'https://s3.example.com',
				bucket: 'backups',
				region: 'us-east-1',
				accessKey: 'AKIA',
				secretKey: 'secret-value',
				prefix: '',
			},
			'canvas.json',
			'{}',
			new Date('2026-01-02T03:04:05.000Z')
		)
		expect(signed.url).toBe('https://s3.example.com/backups/canvas.json')
		expect(signed.headers.Authorization).toContain('AWS4-HMAC-SHA256')
		expect(signed.headers.Authorization).toContain('Credential=AKIA/')
		expect(signed.headers.Authorization).not.toContain('secret-value')
	})
})
