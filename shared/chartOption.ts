/** ECharts option from a table. The chart node renders it. Tests check the option only. */

import { parseTable } from './tableOps'
import type { Table } from './tableOps'

/** Columns whose non-empty cells all parse as numbers (and at least one cell is filled). */
function numericColumns(table: Table): string[] {
	return table.headers.filter((_, index) => {
		let seen = false
		for (const row of table.rows) {
			const value = (row[index] ?? '').trim()
			if (value === '') continue
			if (!Number.isFinite(Number(value))) return false
			seen = true
		}
		return seen
	})
}

export interface ChartColumns {
	xCol: string
	yCols: string[]
}

/**
 * Snap the requested columns to the table: a missing x becomes the first header,
 * missing (or exhausted) y picks become the first numeric column. The x column is
 * never also a y series.
 */
export function resolveColumns(table: Table, xCol: string, yCols: string[]): ChartColumns {
	const x = table.headers.includes(xCol) ? xCol : (table.headers[0] ?? '')
	const picked = yCols.filter((col) => col !== x && table.headers.includes(col))
	const fallback = numericColumns(table).find((col) => col !== x) ?? table.headers.find((col) => col !== x) ?? x
	return { xCol: x, yCols: picked.length > 0 ? picked : [fallback] }
}

/**
 * Build the ECharts option. One series per y column; with `dualScale` and 2+
 * columns the first column uses the left axis and the rest the right one.
 * Pie charts use the first y column only.
 */
export function chartOption(text: string, format: string, kind: string, xCol: string, yCols: string[], dualScale = false) {
	const table = parseTable(text, format)
	const columns = resolveColumns(table, xCol, yCols)
	const xIndex = table.headers.indexOf(columns.xCol)
	const labels = table.rows.map((row) => row[xIndex] ?? '')
	if (kind === 'pie') {
		const yIndex = table.headers.indexOf(columns.yCols[0])
		return {
			animation: false,
			series: [
				{
					type: 'pie',
					data: labels.map((name, index) => ({ name, value: Number(table.rows[index]?.[yIndex] ?? '') })),
				},
			],
		}
	}
	const type = kind === 'line' ? 'line' : 'bar'
	const dual = dualScale && columns.yCols.length > 1
	return {
		animation: false,
		tooltip: { trigger: 'axis' },
		...(columns.yCols.length > 1 ? { legend: {} } : {}),
		xAxis: { type: 'category', data: labels },
		yAxis: dual ? [{ type: 'value' }, { type: 'value' }] : { type: 'value' },
		series: columns.yCols.map((col, index) => {
			const yIndex = table.headers.indexOf(col)
			return {
				type,
				name: col,
				data: table.rows.map((row) => Number(row[yIndex] ?? '')),
				yAxisIndex: dual && index > 0 ? 1 : 0,
			}
		}),
	}
}
