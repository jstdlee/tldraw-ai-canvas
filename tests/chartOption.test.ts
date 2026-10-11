import { describe, expect, it } from 'vitest'
import { buildChart, CHART_KINDS, chartOption, resolveColumns } from '../shared/chartOption'
import type { Table } from '../shared/tableOps'

function series(option: Record<string, unknown>): any[] {
	return option.series as any[]
}

describe('CHART_KINDS', () => {
	it('covers every kind the card supports', () => {
		expect(CHART_KINDS.map((k) => k.id)).toEqual([
			'bar', 'hbar', 'line', 'area', 'scatter', 'pie', 'donut', 'histogram', 'heatmap',
		])
	})
})

describe('buildChart: each kind produces the right series type', () => {
	const table: Table = {
		headers: ['month', 'amount'],
		rows: [
			['Jan', '10'],
			['Feb', '20'],
			['Mar', '30'],
		],
	}

	it('bar: category x-axis, bar series', () => {
		const option = buildChart(table, { kind: 'bar', x: 'month', y: ['amount'] })
		expect(series(option)[0].type).toBe('bar')
		expect((option.xAxis as any).type).toBe('category')
		expect((option.yAxis as any).type).toBe('value')
	})

	it('hbar: value x-axis, category y-axis, bar series', () => {
		const option = buildChart(table, { kind: 'hbar', x: 'month', y: ['amount'] })
		expect(series(option)[0].type).toBe('bar')
		expect((option.xAxis as any).type).toBe('value')
		expect((option.yAxis as any).type).toBe('category')
	})

	it('line: line series, no area style', () => {
		const option = buildChart(table, { kind: 'line', x: 'month', y: ['amount'] })
		expect(series(option)[0].type).toBe('line')
		expect(series(option)[0].areaStyle).toBeUndefined()
	})

	it('area: line series with an area style', () => {
		const option = buildChart(table, { kind: 'area', x: 'month', y: ['amount'] })
		expect(series(option)[0].type).toBe('line')
		expect(series(option)[0].areaStyle).toBeTruthy()
	})

	it('scatter: numeric axes, scatter series of [x, y] pairs', () => {
		const t: Table = { headers: ['a', 'b'], rows: [['1', '2'], ['3', '4']] }
		const option = buildChart(t, { kind: 'scatter', x: 'a', y: ['b'] })
		expect(series(option)[0].type).toBe('scatter')
		expect((option.xAxis as any).type).toBe('value')
		expect(series(option)[0].data).toEqual([[1, 2], [3, 4]])
	})

	it('pie: pie series with a full radius', () => {
		const option = buildChart(table, { kind: 'pie', x: 'month', y: ['amount'] })
		expect(series(option)[0].type).toBe('pie')
		expect(series(option)[0].radius).toEqual(['0%', '70%'])
	})

	it('donut: pie series with a radius range', () => {
		const option = buildChart(table, { kind: 'donut', x: 'month', y: ['amount'] })
		expect(series(option)[0].type).toBe('pie')
		expect(series(option)[0].radius).toEqual(['40%', '70%'])
	})

	it('histogram: bar series over bucket labels', () => {
		const t: Table = { headers: ['v'], rows: [['1'], ['2'], ['3'], ['4'], ['5']] }
		const option = buildChart(t, { kind: 'histogram', x: 'v', y: ['v'], bins: 5 })
		expect(series(option)[0].type).toBe('bar')
		expect((option.xAxis as any).data.length).toBe(5)
	})

	it('heatmap: heatmap series with a visualMap', () => {
		const t: Table = {
			headers: ['x', 'y', 'v'],
			rows: [
				['a', 'p', '1'],
				['a', 'q', '2'],
				['b', 'p', '3'],
			],
		}
		const option = buildChart(t, { kind: 'heatmap', x: 'x', y: ['v'], series: 'y' })
		expect(series(option)[0].type).toBe('heatmap')
		expect(option.visualMap).toBeTruthy()
	})
})

describe('buildChart: series split ("long" data)', () => {
	const table: Table = {
		headers: ['region', 'month', 'amount'],
		rows: [
			['east', 'Jan', '10'],
			['west', 'Jan', '5'],
			['east', 'Feb', '20'],
			['west', 'Feb', '15'],
		],
	}

	it('one series per distinct value of the split column', () => {
		const option = buildChart(table, { kind: 'line', x: 'month', y: ['amount'], series: 'region' })
		const names = series(option).map((s) => s.name)
		expect(names.sort()).toEqual(['east', 'west'])
	})

	it('each series only carries its own rows, aligned to the shared categories', () => {
		const option = buildChart(table, { kind: 'bar', x: 'month', y: ['amount'], series: 'region' })
		const east = series(option).find((s) => s.name === 'east')
		const west = series(option).find((s) => s.name === 'west')
		expect(east.data).toEqual([10, 20])
		expect(west.data).toEqual([5, 15])
	})
})

describe('buildChart: aggregate', () => {
	const table: Table = {
		headers: ['team', 'score'],
		rows: [
			['a', '10'],
			['a', '20'],
			['a', '30'],
			['b', '5'],
		],
	}

	it('sum', () => {
		const option = buildChart(table, { kind: 'bar', x: 'team', y: ['score'], aggregate: 'sum' })
		expect(series(option)[0].data).toEqual([60, 5])
	})

	it('avg', () => {
		const option = buildChart(table, { kind: 'bar', x: 'team', y: ['score'], aggregate: 'avg' })
		expect(series(option)[0].data).toEqual([20, 5])
	})

	it('count', () => {
		const option = buildChart(table, { kind: 'bar', x: 'team', y: ['score'], aggregate: 'count' })
		expect(series(option)[0].data).toEqual([3, 1])
	})

	it('min / max', () => {
		const min = buildChart(table, { kind: 'bar', x: 'team', y: ['score'], aggregate: 'min' })
		const max = buildChart(table, { kind: 'bar', x: 'team', y: ['score'], aggregate: 'max' })
		expect(series(min)[0].data).toEqual([10, 5])
		expect(series(max)[0].data).toEqual([30, 5])
	})
})

describe('buildChart: stack', () => {
	const table: Table = {
		headers: ['region', 'month', 'amount'],
		rows: [
			['east', 'Jan', '10'],
			['west', 'Jan', '5'],
		],
	}

	it('stacks bar/area series when requested', () => {
		const option = buildChart(table, { kind: 'bar', x: 'month', y: ['amount'], series: 'region', stack: true })
		for (const s of series(option)) expect(s.stack).toBe('total')
	})

	it('does not stack by default', () => {
		const option = buildChart(table, { kind: 'bar', x: 'month', y: ['amount'], series: 'region' })
		for (const s of series(option)) expect(s.stack).toBeUndefined()
	})

	it('pie ignores stack entirely (no such concept)', () => {
		const option = buildChart(table, { kind: 'pie', x: 'month', y: ['amount'] })
		expect(series(option)[0].stack).toBeUndefined()
	})
})

describe('buildChart: sort + top N + Other', () => {
	const table: Table = {
		headers: ['country', 'pop'],
		rows: [
			['a', '10'],
			['b', '50'],
			['c', '30'],
			['d', '5'],
			['e', '40'],
		],
	}

	it('sort value-desc orders categories by value', () => {
		const option = buildChart(table, { kind: 'bar', x: 'country', y: ['pop'], sort: 'value-desc' })
		expect((option.xAxis as any).data).toEqual(['b', 'e', 'c', 'a', 'd'])
	})

	it('sort value-asc orders ascending', () => {
		const option = buildChart(table, { kind: 'bar', x: 'country', y: ['pop'], sort: 'value-asc' })
		expect((option.xAxis as any).data).toEqual(['d', 'a', 'c', 'e', 'b'])
	})

	it('top N drops the rest when otherRow is off', () => {
		const option = buildChart(table, { kind: 'bar', x: 'country', y: ['pop'], top: 2, sort: 'value-desc' })
		expect((option.xAxis as any).data).toEqual(['b', 'e'])
	})

	it('top N sums the rest into "Other" when otherRow is on', () => {
		const option = buildChart(table, { kind: 'bar', x: 'country', y: ['pop'], top: 2, otherRow: true, sort: 'value-desc' })
		const cats = (option.xAxis as any).data as string[]
		expect(cats).toEqual(['b', 'e', 'Other'])
		expect(series(option)[0].data[2]).toBe(10 + 30 + 5) // a + c + d
	})

	it('pie supports the same top N + Other', () => {
		const option = buildChart(table, { kind: 'pie', x: 'country', y: ['pop'], top: 2, otherRow: true })
		const names = series(option)[0].data.map((d: any) => d.name)
		expect(names).toEqual(['b', 'e', 'Other'])
	})
})

describe('buildChart: histogram buckets', () => {
	it('buckets numeric values into the requested bin count', () => {
		const table: Table = { headers: ['v'], rows: Array.from({ length: 20 }, (_, i) => [String(i)]) }
		const option = buildChart(table, { kind: 'histogram', x: 'v', y: ['v'], bins: 4 })
		const counts = series(option)[0].data as number[]
		expect(counts.length).toBe(4)
		expect(counts.reduce((a, b) => a + b, 0)).toBe(20)
	})

	it('ignores non-numeric cells', () => {
		const table: Table = { headers: ['v'], rows: [['1'], ['x'], ['2'], ['3'], [''], ['4']] }
		const option = buildChart(table, { kind: 'histogram', x: 'v', y: ['v'], bins: 2 })
		const counts = series(option)[0].data as number[]
		expect(counts.reduce((a, b) => a + b, 0)).toBe(4)
	})
})

describe('buildChart: date sort', () => {
	it('sorts date-like x values chronologically, not alphabetically', () => {
		const table: Table = {
			headers: ['day', 'n'],
			rows: [
				['2024-03-01', '3'],
				['2024-01-01', '1'],
				['2024-02-01', '2'],
			],
		}
		const option = buildChart(table, { kind: 'line', x: 'day', y: ['n'], sort: 'x' })
		expect((option.xAxis as any).data).toEqual(['2024-01-01', '2024-02-01', '2024-03-01'])
	})
})

describe('backward compatibility', () => {
	it('resolveColumns still snaps missing columns', () => {
		const table: Table = { headers: ['name', 'score'], rows: [['Ada', '3']] }
		expect(resolveColumns(table, 'missing', ['missing'])).toEqual({ xCol: 'name', yCols: ['score'] })
	})

	it('the legacy chartOption() wrapper reproduces the old bar/line/pie behaviour', () => {
		const text = 'name,score\nAda,3\nLin,5'
		const option = chartOption(text, 'csv', 'bar', 'name', ['score'], false)
		expect(series(option)[0].type).toBe('bar')
		expect((option.xAxis as any).data).toEqual(['Ada', 'Lin'])
		expect(series(option)[0].data).toEqual([3, 5])
	})

	it('the legacy pie path still works', () => {
		const text = 'name,score\nAda,3\nLin,5'
		const option = chartOption(text, 'csv', 'pie', 'name', ['score'], false)
		expect(series(option)[0].type).toBe('pie')
	})

	it('dualScale still puts the first series on the left axis and the rest on the right', () => {
		const text = 'name,a,b\nAda,3,30\nLin,5,50'
		const option = chartOption(text, 'csv', 'line', 'name', ['a', 'b'], true)
		expect(Array.isArray(option.yAxis)).toBe(true)
		expect(series(option)[0].yAxisIndex).toBe(0)
		expect(series(option)[1].yAxisIndex).toBe(1)
	})
})

describe('buildChart output', () => {
	it('has no undefined values (ECharts treats them as settings)', () => {
		const table = { headers: ['region', 'amount'], rows: [['N', '10'], ['S', '5']] }
		const hasUndefined = (v: unknown): boolean =>
			v === undefined || (!!v && typeof v === 'object' && Object.values(v).some(hasUndefined))
		for (const kind of ['bar', 'line', 'area', 'pie', 'donut', 'histogram', 'scatter', 'hbar'] as const) {
			const option = buildChart(table, { kind, x: 'region', y: ['amount'] })
			expect(hasUndefined(option)).toBe(false)
		}
		const pie = buildChart(table, { kind: 'pie', x: 'region', y: ['amount'] }) as { series: { radius?: unknown }[] }
		expect(pie.series[0].radius).toEqual(['0%', '70%'])
	})
})
