/** ECharts option from a table. The chart node renders it. Tests check the option only. */

import { parseTable } from './tableOps'
import type { Table } from './tableOps'

/** Chart kinds the chart card supports. The card search deep entries ("Chart · Line", …)
 *  are built from this list instead of a hand list. */
export const CHART_KINDS = [
	{ id: 'bar', label: 'Bar' },
	{ id: 'hbar', label: 'Bar (horizontal)' },
	{ id: 'line', label: 'Line' },
	{ id: 'area', label: 'Area' },
	{ id: 'scatter', label: 'Scatter' },
	{ id: 'pie', label: 'Pie' },
	{ id: 'donut', label: 'Donut' },
	{ id: 'histogram', label: 'Histogram' },
	{ id: 'heatmap', label: 'Heatmap' },
] as const

export type ChartKind = (typeof CHART_KINDS)[number]['id']
export const CHART_KIND_IDS: string[] = CHART_KINDS.map((k) => k.id)

export type Aggregate = 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max'
export type Sort = 'none' | 'x' | 'value-asc' | 'value-desc'

export interface ChartSpec {
	kind: ChartKind | string
	/** Category / x column (scatter: a numeric x column). */
	x: string
	/** Value column(s); one series each, unless `series` splits them further. */
	y: string[]
	/** Split into one series per distinct value of this column ("long" data). */
	series?: string
	/** Combine rows sharing the same x (and series) before drawing. */
	aggregate?: Aggregate
	/** Stack series on top of each other (bar / hbar / area). */
	stack?: boolean
	/** With 2+ series, plot the first on the left axis and the rest on the right. */
	dual?: boolean
	sort?: Sort
	/** Keep only the top N categories by value. */
	top?: number
	/** Sum whatever `top` drops into a trailing "Other" category (instead of dropping it). */
	otherRow?: boolean
	/** Histogram bucket count. */
	bins?: number
	title?: string
	xLabel?: string
	yLabel?: string
	/** Show a value label on each mark. */
	labels?: boolean
	/** Smooth the line/area curve. */
	smooth?: boolean
}

/** Theme colours the client passes in from tldraw's current theme (see
 * `client/pipeline/nodes/types/DataNodes.tsx`'s `getChartTheme`). Omit for plain defaults
 * (used by tests, which don't care about colour). */
export interface ChartTheme {
	/** Ordered series colours, e.g. blue/orange/green/violet/red/light-blue/yellow/grey. */
	palette?: string[]
	/** Axis label and title text colour. */
	text?: string
	/** Axis line colour. */
	axis?: string
	/** Grid / split-line colour. */
	split?: string
}

const SAMPLE_LIMIT = 5000

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

/** Number columns first, then the rest — for the Y column picker. */
export function columnsNumberFirst(table: Table): string[] {
	const numeric = new Set(numericColumns(table))
	return [...table.headers].sort((a, b) => Number(numeric.has(b)) - Number(numeric.has(a)))
}

function toNumber(value: string | undefined): number {
	const n = Number((value ?? '').trim().replace(/,/g, ''))
	return Number.isFinite(n) ? n : NaN
}

function isDateLike(value: string): boolean {
	const v = value.trim()
	if (!v || Number.isFinite(Number(v))) return false
	const t = Date.parse(v)
	return Number.isFinite(t)
}

/** Natural ordering for category labels: numeric, then date, then alphabetic. */
function naturalCategoryOrder(values: string[]): (a: string, b: string) => number {
	const nonEmpty = values.filter((v) => v.trim() !== '')
	if (nonEmpty.length && nonEmpty.every((v) => Number.isFinite(Number(v.trim())))) {
		return (a, b) => Number(a) - Number(b)
	}
	if (nonEmpty.length && nonEmpty.every(isDateLike)) {
		return (a, b) => Date.parse(a) - Date.parse(b)
	}
	return (a, b) => a.localeCompare(b)
}

function aggregateValues(values: number[], agg: Aggregate): number {
	if (!values.length) return 0
	switch (agg) {
		case 'avg':
			return values.reduce((a, b) => a + b, 0) / values.length
		case 'count':
			return values.length
		case 'min':
			return Math.min(...values)
		case 'max':
			return Math.max(...values)
		default:
			return values.reduce((a, b) => a + b, 0)
	}
}

/** Evenly sample `rows` down to `limit`, keeping order. Returns the original total when
 * sampling happened (null otherwise), for the "showing N of M points" subtitle. */
function sampleRows(rows: string[][], limit = SAMPLE_LIMIT): { rows: string[][]; sampledFrom: number | null } {
	if (rows.length <= limit) return { rows, sampledFrom: null }
	const step = rows.length / limit
	const sampled: string[][] = []
	for (let i = 0; i < limit; i++) sampled.push(rows[Math.min(rows.length - 1, Math.floor(i * step))])
	return { rows: sampled, sampledFrom: rows.length }
}

function titleBlock(spec: ChartSpec, theme: ChartTheme, sampledFrom: number | null) {
	const subtext = sampledFrom != null ? `showing ${SAMPLE_LIMIT.toLocaleString()} of ${sampledFrom.toLocaleString()} points` : undefined
	if (!spec.title && !subtext) return {}
	return {
		title: {
			text: spec.title || undefined,
			subtext,
			textStyle: theme.text ? { color: theme.text } : undefined,
			subtextStyle: theme.text ? { color: theme.text } : undefined,
		},
	}
}

function axisTheme(theme: ChartTheme) {
	return {
		axisLine: theme.axis ? { lineStyle: { color: theme.axis } } : undefined,
		axisLabel: theme.text ? { color: theme.text } : undefined,
		splitLine: theme.split ? { lineStyle: { color: theme.split } } : undefined,
	}
}

function categoryAxis(name: string | undefined, data: string[], theme: ChartTheme) {
	return { type: 'category', name, nameLocation: 'middle', nameGap: 28, data, ...axisTheme(theme) }
}

function valueAxis(name: string | undefined, theme: ChartTheme) {
	return { type: 'value', name, nameLocation: 'middle', nameGap: 36, ...axisTheme(theme) }
}

/**
 * Build the ECharts option for one chart spec. Pure; `theme` is optional (plain colours when
 * omitted, which is what the tests use).
 */
/**
 * ECharts option for one chart spec, without `undefined` values: ECharts treats an explicit
 * `undefined` as a real setting (a pie with `radius: undefined` draws empty slices).
 */
export function buildChart(table: Table, spec: ChartSpec, theme: ChartTheme = {}): Record<string, unknown> {
	return dropUndefined(buildChartRaw(table, spec, theme)) as Record<string, unknown>
}

function dropUndefined(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(dropUndefined)
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {}
		for (const [key, v] of Object.entries(value)) if (v !== undefined) out[key] = dropUndefined(v)
		return out
	}
	return value
}

function buildChartRaw(table: Table, spec: ChartSpec, theme: ChartTheme = {}): Record<string, unknown> {
	const xIndex = table.headers.indexOf(spec.x)
	const seriesIndex = spec.series ? table.headers.indexOf(spec.series) : -1
	const yIndexes = spec.y.map((col) => table.headers.indexOf(col))
	const aggregate = spec.aggregate ?? 'none'
	const base = {
		animation: false,
		color: theme.palette,
		...titleBlock(spec, theme, null),
	}

	if (spec.kind === 'histogram') {
		const yIndex = yIndexes[0] ?? -1
		const values = table.rows
			.map((row) => row[yIndex])
			.filter((v) => (v ?? '').trim() !== '')
			.map((v) => toNumber(v))
			.filter((n) => Number.isFinite(n))
		const bins = Math.max(1, spec.bins ?? 10)
		const min = values.length ? Math.min(...values) : 0
		const max = values.length ? Math.max(...values) : 1
		const size = max > min ? (max - min) / bins : 1
		const counts = new Array(bins).fill(0)
		for (const v of values) {
			const idx = size > 0 ? Math.min(bins - 1, Math.floor((v - min) / size)) : 0
			counts[idx]++
		}
		const labels = Array.from({ length: bins }, (_, i) => {
			const lo = min + i * size
			const hi = min + (i + 1) * size
			return `${round2(lo)}–${round2(hi)}`
		})
		return {
			...base,
			tooltip: { trigger: 'axis' },
			xAxis: categoryAxis(spec.xLabel, labels, theme),
			yAxis: valueAxis(spec.yLabel, theme),
			series: [
				{
					type: 'bar',
					name: spec.y[0] ?? 'count',
					data: counts,
					label: spec.labels ? { show: true, position: 'top' } : undefined,
				},
			],
		}
	}

	if (spec.kind === 'heatmap') {
		const xCats = uniqueInOrder(table.rows.map((row) => row[xIndex] ?? ''))
		const yCats = spec.series ? uniqueInOrder(table.rows.map((row) => row[seriesIndex] ?? '')) : spec.y
		const valueIndex = yIndexes[0] ?? -1
		const grid: Record<string, number[]> = {}
		for (let r = 0; r < table.rows.length; r++) {
			const row = table.rows[r]
			const xi = xCats.indexOf(row[xIndex] ?? '')
			if (xi < 0) continue
			if (spec.series) {
				const yi = yCats.indexOf(row[seriesIndex] ?? '')
				if (yi < 0) continue
				const key = `${xi}:${yi}`
				;(grid[key] ??= []).push(toNumber(row[valueIndex]))
			} else {
				for (let yi = 0; yi < spec.y.length; yi++) {
					const key = `${xi}:${yi}`
					;(grid[key] ??= []).push(toNumber(row[yIndexes[yi]]))
				}
			}
		}
		const data: [number, number, number][] = []
		let maxValue = 0
		for (const [key, values] of Object.entries(grid)) {
			const [xi, yi] = key.split(':').map(Number)
			const value = aggregateValues(values.filter(Number.isFinite), aggregate === 'none' ? 'sum' : aggregate)
			data.push([xi, yi, round2(value)])
			if (value > maxValue) maxValue = value
		}
		return {
			...base,
			tooltip: {},
			xAxis: categoryAxis(spec.xLabel, xCats, theme),
			yAxis: categoryAxis(spec.yLabel, yCats, theme),
			visualMap: { min: 0, max: maxValue || 1, calculable: true, orient: 'horizontal', bottom: 0 },
			series: [
				{
					type: 'heatmap',
					data,
					label: spec.labels ? { show: true } : undefined,
				},
			],
		}
	}

	if (spec.kind === 'scatter') {
		const { rows, sampledFrom } = sampleRows(table.rows)
		const seriesNames = spec.series ? uniqueInOrder(rows.map((row) => row[seriesIndex] ?? '')) : spec.y.length ? spec.y : ['series']
		const yIndex = yIndexes[0] ?? -1
		const series = seriesNames.map((name) => ({
			type: 'scatter',
			name,
			data: rows
				.filter((row) => !spec.series || (row[seriesIndex] ?? '') === name)
				.map((row) => [toNumber(row[xIndex]), toNumber(row[yIndex])])
				.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
			label: spec.labels ? { show: true, position: 'top' } : undefined,
		}))
		return {
			...base,
			...titleBlock(spec, theme, sampledFrom),
			tooltip: { trigger: 'item' },
			...(seriesNames.length > 1 ? { legend: {} } : {}),
			xAxis: valueAxis(spec.xLabel ?? spec.x, theme),
			yAxis: valueAxis(spec.yLabel, theme),
			series,
		}
	}

	if (spec.kind === 'pie' || spec.kind === 'donut') {
		const groups = new Map<string, number[]>()
		const order: string[] = []
		for (const row of table.rows) {
			const key = row[xIndex] ?? ''
			if (!groups.has(key)) {
				groups.set(key, [])
				order.push(key)
			}
			groups.get(key)!.push(toNumber(row[yIndexes[0]]))
		}
		let entries = order.map((name) => ({ name, value: aggregateValues(groups.get(name)!.filter(Number.isFinite), aggregate === 'none' ? 'sum' : aggregate) }))
		entries = sortAndTop(entries, spec)
		return {
			...base,
			tooltip: { trigger: 'item' },
			legend: {},
			series: [
				{
					type: 'pie',
					radius: spec.kind === 'donut' ? ['40%', '70%'] : ['0%', '70%'],
					data: entries.map((e) => ({ name: e.name, value: round2(e.value) })),
					label: spec.labels ? { show: true } : { show: false },
				},
			],
		}
	}

	// bar / hbar / line / area: category axis + one or more series.
	const horizontal = spec.kind === 'hbar'
	const lineLike = spec.kind === 'line' || spec.kind === 'area'
	// The classic passthrough (no grouping at all) only applies when nothing asks for grouping:
	// no series split, no explicit aggregate, and no sort/top-N (which need deduped categories).
	const rawPath = !spec.series && aggregate === 'none' && (spec.sort ?? 'none') === 'none' && !spec.top

	let categories: string[]

	if (rawPath) {
		// No grouping at all (the classic bar/line/pie passthrough): one point per row, in
		// row order, exactly like the pre-WP12 behaviour.
		categories = table.rows.map((row) => row[xIndex] ?? '')
		const series = spec.y.map((col, i) => ({
			type: lineLike ? 'line' : 'bar',
			name: col,
			data: table.rows.map((row) => round2(toNumber(row[yIndexes[i]]))),
			smooth: lineLike ? !!spec.smooth : undefined,
			areaStyle: spec.kind === 'area' ? {} : undefined,
			stack: spec.stack && (spec.kind === 'bar' || spec.kind === 'hbar' || spec.kind === 'area') ? 'total' : undefined,
			yAxisIndex: spec.dual && spec.y.length > 1 && i > 0 ? 1 : 0,
			label: spec.labels ? { show: true, position: 'top' } : undefined,
		}))
		const dual = !!spec.dual && series.length > 1
		return {
			...base,
			tooltip: { trigger: 'axis' },
			...(series.length > 1 ? { legend: {} } : {}),
			xAxis: horizontal ? valueAxis(spec.xLabel, theme) : categoryAxis(spec.xLabel, categories, theme),
			yAxis: horizontal
				? categoryAxis(spec.yLabel, categories, theme)
				: dual
					? [valueAxis(spec.yLabel, theme), valueAxis(undefined, theme)]
					: valueAxis(spec.yLabel, theme),
			series,
		}
	}

	// Grouped path: series + aggregate (long data), or an explicit aggregate on its own.
	const seriesValues = spec.series ? uniqueInOrder(table.rows.map((row) => row[seriesIndex] ?? '')) : null
	const yCols = spec.y.length ? spec.y : ['']
	const seriesNames = seriesValues ?? yCols

	const buckets = new Map<string, Map<string, number[]>>() // category -> seriesName -> values
	const categoryOrder: string[] = []
	for (const row of table.rows) {
		const cat = row[xIndex] ?? ''
		if (!buckets.has(cat)) {
			buckets.set(cat, new Map())
			categoryOrder.push(cat)
		}
		const perSeries = buckets.get(cat)!
		if (seriesValues) {
			const name = row[seriesIndex] ?? ''
			const value = toNumber(row[yIndexes[0]])
			if (Number.isFinite(value)) (perSeries.get(name) ?? perSeries.set(name, []).get(name)!).push(value)
		} else {
			for (let i = 0; i < yCols.length; i++) {
				const value = toNumber(row[yIndexes[i]])
				if (Number.isFinite(value)) (perSeries.get(yCols[i]) ?? perSeries.set(yCols[i], []).get(yCols[i])!).push(value)
			}
		}
	}

	const effectiveAgg: Aggregate = aggregate === 'none' ? 'sum' : aggregate
	const rankValue = (cat: string) => {
		const perSeries = buckets.get(cat)
		if (!perSeries) return 0
		let total = 0
		for (const values of perSeries.values()) total += aggregateValues(values, effectiveAgg)
		return total
	}

	let { kept, other } = applyTopN(categoryOrder, rankValue, spec)
	kept = applySort(kept, rankValue, spec)
	categories = other != null ? [...kept, other] : kept

	const series = seriesNames.map((name, i) => ({
		type: lineLike ? 'line' : 'bar',
		name,
		data: categories.map((cat) => {
			if (cat === other) {
				// Sum of every dropped category's value for this series.
				const dropped = categoryOrder.filter((c) => !kept.includes(c) && c !== other)
				let total = 0
				for (const c of dropped) {
					const values = buckets.get(c)?.get(name)
					if (values) total += aggregateValues(values, effectiveAgg)
				}
				return round2(total)
			}
			const values = buckets.get(cat)?.get(name)
			return values ? round2(aggregateValues(values, effectiveAgg)) : 0
		}),
		smooth: lineLike ? !!spec.smooth : undefined,
		areaStyle: spec.kind === 'area' ? {} : undefined,
		stack: spec.stack && (spec.kind === 'bar' || spec.kind === 'hbar' || spec.kind === 'area') ? 'total' : undefined,
		yAxisIndex: spec.dual && seriesNames.length > 1 && i > 0 ? 1 : 0,
		label: spec.labels ? { show: true, position: 'top' } : undefined,
	}))
	const dual = !!spec.dual && series.length > 1
	return {
		...base,
		tooltip: { trigger: 'axis' },
		...(series.length > 1 ? { legend: {} } : {}),
		xAxis: horizontal ? valueAxis(spec.xLabel, theme) : categoryAxis(spec.xLabel, categories, theme),
		yAxis: horizontal
			? categoryAxis(spec.yLabel, categories, theme)
			: dual
				? [valueAxis(spec.yLabel, theme), valueAxis(undefined, theme)]
				: valueAxis(spec.yLabel, theme),
		series,
	}
}

function round2(n: number): number {
	return Math.round(n * 100) / 100
}

function uniqueInOrder(values: string[]): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const v of values) {
		if (!seen.has(v)) {
			seen.add(v)
			out.push(v)
		}
	}
	return out
}

/** Keep the top `spec.top` categories by `rankValue`; the rest either dropped or merged into
 * an "Other" bucket (`spec.otherRow`). Returns the surviving categories in their *original*
 * encounter order (sorting happens afterwards, in `applySort`), plus the "Other" label (or
 * null when there's nothing left over, or no `top` set). */
function applyTopN(
	categories: string[],
	rankValue: (c: string) => number,
	spec: ChartSpec
): { kept: string[]; other: string | null } {
	if (!spec.top || spec.top <= 0 || spec.top >= categories.length) return { kept: categories, other: null }
	const ranked = [...categories].sort((a, b) => rankValue(b) - rankValue(a))
	const keepSet = new Set(ranked.slice(0, spec.top))
	const kept = categories.filter((c) => keepSet.has(c))
	const dropped = categories.filter((c) => !keepSet.has(c))
	return { kept, other: dropped.length && spec.otherRow ? 'Other' : null }
}

function applySort(categories: string[], rankValue: (c: string) => number, spec: ChartSpec): string[] {
	const sort = spec.sort ?? 'none'
	if (sort === 'value-asc') return [...categories].sort((a, b) => rankValue(a) - rankValue(b))
	if (sort === 'value-desc') return [...categories].sort((a, b) => rankValue(b) - rankValue(a))
	if (sort === 'x') return [...categories].sort(naturalCategoryOrder(categories))
	return categories
}

function sortAndTop(entries: { name: string; value: number }[], spec: ChartSpec) {
	const rankValue = (name: string) => entries.find((e) => e.name === name)?.value ?? 0
	const names = entries.map((e) => e.name)
	const { kept, other } = applyTopN(names, rankValue, { ...spec, sort: spec.sort ?? 'value-desc' })
	const ordered = applySort(kept, rankValue, { ...spec, sort: spec.sort ?? 'value-desc' })
	const result = ordered.map((name) => entries.find((e) => e.name === name)!)
	if (other) {
		const dropped = entries.filter((e) => !kept.includes(e.name))
		result.push({ name: other, value: dropped.reduce((s, e) => s + e.value, 0) })
	}
	return result
}

/**
 * Legacy signature, kept working for whatever still calls it directly: one series per y
 * column, no grouping — the exact pre-WP12 behaviour (see `buildChart`'s "rawPath").
 */
export function chartOption(text: string, format: string, kind: string, xCol: string, yCols: string[], dualScale = false) {
	const table = parseTable(text, format)
	const columns = resolveColumns(table, xCol, yCols)
	return buildChart(table, { kind, x: columns.xCol, y: columns.yCols, dual: dualScale, aggregate: 'none' })
}
