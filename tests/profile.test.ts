import { describe, expect, it } from 'vitest'
import { profileTable } from '../shared/profile'
import { parseTable } from '../shared/tableOps'

function table(csv: string) {
	return parseTable(csv, 'csv')
}

describe('profileTable', () => {
	it('detects number, integer, text, boolean and date columns', () => {
		const t = table('n,score,active,joined,note\na,3,true,2024-01-01,hi\nb,4.5,false,2024-02-01,yo')
		const profiles = profileTable(t)
		expect(profiles.find((p) => p.name === 'n')?.type).toBe('text')
		expect(profiles.find((p) => p.name === 'score')?.type).toBe('number')
		expect(profiles.find((p) => p.name === 'active')?.type).toBe('boolean')
		expect(profiles.find((p) => p.name === 'joined')?.type).toBe('date')
	})

	it('treats an all-integer column as integer, not number', () => {
		const t = table('n\n3\n4\n5')
		expect(profileTable(t)[0].type).toBe('integer')
	})

	it('computes filled %, empty count and distinct count', () => {
		const t = table('v,x\na,1\na,2\n,3\nb,4')
		const p = profileTable(t).find((col) => col.name === 'v')!
		expect(p.rowCount).toBe(4)
		expect(p.emptyCount).toBe(1)
		expect(p.filledPct).toBe(75)
		expect(p.distinctCount).toBe(2)
	})

	it('computes min/max/mean for numbers', () => {
		const t = table('v\n1\n2\n3\n4')
		const p = profileTable(t)[0]
		expect(p.min).toBe('1')
		expect(p.max).toBe('4')
		expect(p.mean).toBe(2.5)
	})

	it('computes min/max for dates', () => {
		const t = table('d\n2024-03-01\n2024-01-15\n2024-02-10')
		const p = profileTable(t)[0]
		expect(p.min).toBe('2024-01-15')
		expect(p.max).toBe('2024-03-01')
	})

	it('returns the top N values by frequency, ties broken alphabetically', () => {
		const t = table('v\nb\na\na\nb\nc')
		const top = profileTable(t, 2)[0].top
		expect(top).toEqual([
			{ value: 'a', count: 2 },
			{ value: 'b', count: 2 },
		])
	})

	it('builds a 12-bucket histogram for numeric columns', () => {
		const t = table('v\n0\n10\n20\n30\n40\n50\n60\n70\n80\n90\n100\n110')
		const hist = profileTable(t)[0].histogram
		expect(hist).toHaveLength(12)
		expect(hist!.reduce((s, n) => s + n, 0)).toBe(12)
	})

	it('has no min/max/mean/histogram for a text column', () => {
		const t = table('v\nfoo\nbar')
		const p = profileTable(t)[0]
		expect(p.min).toBeUndefined()
		expect(p.mean).toBeUndefined()
		expect(p.histogram).toBeUndefined()
	})

	it('treats an all-empty column as text with 0% filled', () => {
		const t = table('v,x\n,1\n,2')
		const p = profileTable(t).find((col) => col.name === 'v')!
		expect(p.type).toBe('text')
		expect(p.filledPct).toBe(0)
	})
})
