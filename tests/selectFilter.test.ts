import { describe, expect, it } from 'vitest'
import { filterSelectOptions, matchesSelectQuery } from '../shared/selectFilter'

describe('matchesSelectQuery', () => {
	it('matches on label, case-insensitively', () => {
		expect(matchesSelectQuery({ label: 'Filter rows' }, 'filter')).toBe(true)
		expect(matchesSelectQuery({ label: 'Filter rows' }, 'FILTER')).toBe(true)
		expect(matchesSelectQuery({ label: 'Filter rows' }, 'pivot')).toBe(false)
	})

	it('matches on hint and group text too', () => {
		expect(matchesSelectQuery({ label: 'Select', hint: 'keep some columns' }, 'columns')).toBe(true)
		expect(matchesSelectQuery({ label: 'Select', group: 'Reshape' }, 'reshape')).toBe(true)
	})

	it('treats an empty or whitespace query as matching everything', () => {
		expect(matchesSelectQuery({ label: 'Anything' }, '')).toBe(true)
		expect(matchesSelectQuery({ label: 'Anything' }, '   ')).toBe(true)
	})
})

describe('filterSelectOptions', () => {
	const options = [
		{ label: 'Filter', group: 'Reshape' },
		{ label: 'Pivot', group: 'Reshape' },
		{ label: 'Select', hint: 'keep some columns', group: 'Columns' },
	]

	it('keeps every option when the query is empty', () => {
		expect(filterSelectOptions(options, '')).toHaveLength(3)
	})

	it('keeps only matching options, in order', () => {
		expect(filterSelectOptions(options, 'reshape').map((o) => o.label)).toEqual(['Filter', 'Pivot'])
	})

	it('matches a hint-only query', () => {
		expect(filterSelectOptions(options, 'columns').map((o) => o.label)).toEqual(['Select'])
	})
})
