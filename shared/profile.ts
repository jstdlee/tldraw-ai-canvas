/** Column statistics for the Profile card (WP11 Part E): what's in a table before working on it.
 * Pure, tested in Node (tests/profile.test.ts). No tldraw import. */

import type { Table } from './tableOps'

export type ColumnType = 'number' | 'integer' | 'date' | 'boolean' | 'text'

export interface TopValue {
	value: string
	count: number
}

export interface ColumnProfile {
	name: string
	type: ColumnType
	rowCount: number
	filledPct: number
	emptyCount: number
	distinctCount: number
	min?: string
	max?: string
	mean?: number
	top: TopValue[]
	/** 12 evenly-sized buckets from min to max, counts only — numbers/integers only. */
	histogram?: number[]
}

const NUMERIC_RE = /^-?\d+(\.\d+)?$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?)?$/

function isNumericLike(value: string): boolean {
	return NUMERIC_RE.test(value.trim().replace(/,/g, ''))
}

function toNum(value: string): number {
	return Number(value.trim().replace(/,/g, ''))
}

function isDateLike(value: string): boolean {
	const v = value.trim()
	if (!DATE_RE.test(v)) return false
	return !Number.isNaN(new Date(v).getTime())
}

function detectType(values: string[]): ColumnType {
	const nonEmpty = values.filter((v) => v.trim() !== '')
	if (!nonEmpty.length) return 'text'
	if (nonEmpty.every((v) => /^(true|false)$/i.test(v.trim()))) return 'boolean'
	if (nonEmpty.every(isNumericLike)) {
		return nonEmpty.every((v) => Number.isInteger(toNum(v))) ? 'integer' : 'number'
	}
	if (nonEmpty.every(isDateLike)) return 'date'
	return 'text'
}

function topValues(values: string[], n: number): TopValue[] {
	const counts = new Map<string, number>()
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
	return [...counts.entries()]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
		.slice(0, n)
}

function numberHistogram(nums: number[], buckets = 12): number[] {
	if (!nums.length) return []
	const min = Math.min(...nums)
	const max = Math.max(...nums)
	const counts = new Array(buckets).fill(0)
	if (min === max) {
		counts[0] = nums.length
		return counts
	}
	const size = (max - min) / buckets
	for (const n of nums) {
		const index = Math.min(buckets - 1, Math.floor((n - min) / size))
		counts[index]++
	}
	return counts
}

/** Profiles every column of `table`: type, fill rate, distinct count, min/max/mean, top values
 * and (for numbers) a 12-bucket histogram. `topN` controls how many top values are kept
 * (3 by default; the card asks for 10 when a row is expanded). */
export function profileTable(table: Table, topN = 3): ColumnProfile[] {
	const rowCount = table.rows.length
	return table.headers.map((name, index) => {
		const values = table.rows.map((row) => row[index] ?? '')
		const nonEmpty = values.filter((v) => v.trim() !== '')
		const type = detectType(values)
		const distinctCount = new Set(nonEmpty).size
		const profile: ColumnProfile = {
			name,
			type,
			rowCount,
			filledPct: rowCount ? Math.round((nonEmpty.length / rowCount) * 1000) / 10 : 0,
			emptyCount: rowCount - nonEmpty.length,
			distinctCount,
			top: topValues(nonEmpty, topN),
		}
		if (type === 'number' || type === 'integer') {
			const nums = nonEmpty.map(toNum)
			if (nums.length) {
				profile.min = String(Math.min(...nums))
				profile.max = String(Math.max(...nums))
				profile.mean = nums.reduce((s, n) => s + n, 0) / nums.length
				profile.histogram = numberHistogram(nums)
			}
		} else if (type === 'date') {
			const times = nonEmpty.map((v) => new Date(v).getTime())
			if (times.length) {
				profile.min = new Date(Math.min(...times)).toISOString().slice(0, 10)
				profile.max = new Date(Math.max(...times)).toISOString().slice(0, 10)
			}
		}
		return profile
	})
}
