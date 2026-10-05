/** ECharts option from a table. The chart node renders it. Tests check the option only. */

import { parseTable } from './tableOps'

export function chartOption(text: string, format: string, kind: string, xCol: string, yCol: string) {
	const table = parseTable(text, format)
	const xIndex = Math.max(0, table.headers.indexOf(xCol))
	const yIndex = table.headers.indexOf(yCol) >= 0 ? table.headers.indexOf(yCol) : Math.min(1, table.headers.length - 1)
	const labels = table.rows.map((row) => row[xIndex] ?? '')
	const values = table.rows.map((row) => Number(row[yIndex] ?? ''))
	if (kind === 'pie') {
		return {
			animation: false,
			series: [
				{
					type: 'pie',
					data: labels.map((name, index) => ({ name, value: values[index] })),
				},
			],
		}
	}
	return {
		animation: false,
		tooltip: { trigger: 'axis' },
		xAxis: { type: 'category', data: labels },
		yAxis: { type: 'value' },
		series: [{ type: kind === 'line' ? 'line' : 'bar', data: values }],
	}
}
