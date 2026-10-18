import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { categoryOf } from '../../../../shared/nodeGroups'
import { buildChart, CHART_KINDS, columnsNumberFirst, resolveColumns } from '../../../../shared/chartOption'
import type { ChartSpec, ChartTheme } from '../../../../shared/chartOption'
import { evalFormula, opSpec, runTable, splitList, TABLE_OPS } from '../../../../shared/tableOps'
import type { TableJob } from '../../../../shared/tableOps'
import { parseTableText, toCsv } from '../../../../shared/tableText'
import { profileTable } from '../../../../shared/profile'
import type { ColumnProfile } from '../../../../shared/profile'
import { createShapeId, Editor, getColorValue, TLShapeId, T, useEditor, useValue } from 'tldraw'
import { getNodeRowHeightPx, GROW_FIELD_EXTRA_PX, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_WIDTH_PX } from '../../constants'
import { Port, ShapePort } from '../../ports/Port'
import { useFieldPortAnchors } from '../../ports/useFieldPortAnchor'
import { createOrUpdateConnectionBinding } from '../../connection/ConnectionBindingUtil'
import { getNextConnectionIndex } from '../../connection/keepConnectionsAtBottom'
import { createNodeAt } from '../../placeNode'
import { readSpreadsheet } from '../../excel'
import { storeFile, loadFileBytes } from '../../fileStore'
import { storeBlob } from '../../imageOps'
import { sleep } from '../../utils/sleep'
import { getNodeInputPortValues, getWiredSourceTitle, isInputWired } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import { hiddenFieldKeys } from '../fieldVisibility'
import { fieldPortId } from '../../../../shared/fieldOverrides'
import {
	UiButton,
	UiCheckbox,
	UiChip,
	UiEmpty,
	UiField,
	UiGrowingInput,
	UiIconButton,
	UiNumberInput,
	UiSegmented,
	UiSelect,
	UiTextArea,
	UiTextInput,
} from '../../../ui'
import { IconChevronDown, IconChevronRight, IconClose, IconGroup, IconPlus, IconTable, IconUpload } from '../../../ui/icons'
import { ExpandableTable, FieldMax, ImageZoom, TableZoom } from '../../editors/LargeEditor'
import { NodeMultiSelect, PortRow, stopEvent, NodeSelect, useInputConnected, useWireField, WireField, WireFieldHeader } from './fields'
import {
	areAnyInputsOutOfDate,
	ExecutionResult,
	getInputText,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	updateNode,
	wiredOrOwnText,
} from './shared'

const BASE = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX

function end(id: string, row: number, rowPx: number): ShapePort {
	return { id, x: 0, y: BASE + rowPx * (row + 0.5), terminal: 'end', dataType: 'text' }
}
function out(x: number = NODE_WIDTH_PX): ShapePort {
	return { id: 'output', x, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' }
}
function info(shape: NodeShape, value: string | null, inputs: InfoValues): InfoValues {
	return {
		output: {
			value,
			isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
			dataType: 'text',
		},
	}
}

const SAMPLE = 'name,city,score\nAda,Paris,3\nLin,Oslo,5'

// ---------------------------------------------------------------------------
// DataPipe (type id stays "table" so saved canvases keep loading).
// ---------------------------------------------------------------------------

export type TableNode = T.TypeOf<typeof TableNode>
export const TableNode = T.object({
	type: T.literal('table'),
	text: T.string,
	format: T.string,
	op: T.string,
	columns: T.string,
	column: T.string,
	as: T.string,
	expr: T.string,
	sep: T.string,
	pattern: T.string,
	with: T.string,
	name: T.string,
	error: T.string.nullable(),
	// New, optional (WP5): source picker, uploaded file, and the last run's preview.
	source: T.string.optional(),
	fileUrl: T.string.optional(),
	fileName: T.string.optional(),
	sheet: T.string.optional(),
	sheets: T.arrayOf(T.string).optional(),
	lastOutput: T.string.nullable().optional(),
	lastInfo: T.string.optional(),
	// New, optional (WP11): pivot's totals checkbox, and unpivot's second multi-column field.
	totals: T.boolean.optional(),
	columns2: T.string.optional(),
})

/** Where DataPipe's rows land, so ports and body height agree. */
function layout(node: TableNode, dataWired = false) {
	const spec = opSpec(node.op)
	const params = spec?.params ?? []
	let row = 0
	const dataRow = row++
	// DATA-07: the "data" port now always gets its own row (a visible dot even while unwired);
	// the Inline/File source picker is a separate row underneath, only while unwired.
	if (!dataWired) row++ // source picker row
	// The file-upload row only renders when the data port is not wired (same condition as the component).
	const fileRow = !dataWired && node.source === 'file' ? row++ : null
	const opRow = row++
	const paramStart = row
	row += params.length
	const secondRow = spec?.second ? row++ : null
	return { dataRow, fileRow, opRow, paramStart, paramCount: params.length, secondRow, rowsCount: row, spec, params }
}

export class TableNodeDefinition extends NodeDefinition<TableNode> {
	static type = 'table'
	static validator = TableNode
	title = 'DataPipe'
	heading = 'DataPipe'
	icon = <IconTable />
	category = categoryOf('table')
	// WP11: these are result fields, not settings — excluded from the input-hash cache key
	// (otherwise every run changes its own hash and the cache never hits).
	resultKeys = ['error', 'lastOutput', 'lastInfo'] as const
	override showsOutput = true
	override defaultWidthPx = 440
	getDefault(): TableNode {
		return {
			type: 'table',
			// GAPS-01: a fresh card starts empty (a placeholder explains the format), not seeded
			// with sample data — a saved canvas that already has SAMPLE in `text` keeps it as is.
			text: '',
			format: 'auto',
			op: 'select',
			columns: 'name,score',
			column: 'score',
			// DATA-08: '' (not a stale enum value meaningful only to some other op) — every op
			// that reads `as` already treats '' as "use the sensible default" (see runTable).
			as: '',
			expr: 'upper(name)',
			sep: ' ',
			pattern: 'a',
			with: 'A',
			name: 'next',
			error: null,
			source: 'inline',
			fileUrl: '',
			fileName: '',
			sheet: '',
			sheets: [],
			lastOutput: null,
			lastInfo: '',
			totals: false,
			columns2: '',
		}
	}
	getBodyHeightPx(shape: NodeShape, node: TableNode) {
		const dataWired = isInputWired(this.editor, shape.id, 'data')
		const { rowsCount, params } = layout(node, dataWired)
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		// The inline textarea only renders when the data port is not wired (same condition as the component).
		const inlineExtra = !dataWired && (node.source ?? 'inline') === 'inline' ? 90 : 0
		const descriptionExtra = 20
		// A real preview table needs room to show rows; the empty placeholder is much shorter.
		const previewExtra = node.lastOutput ? 240 : 64
		// Structured editors (formula live preview, Group's summary rows, Map values' mapping
		// rows) render more than the one row `rowsCount` budgets per param.
		const structuredExtra = params.reduce((sum, param) => {
			if (param.kind === 'formula') return sum + rowPx * 2.5
			if (param.kind === 'summaries') return sum + rowPx * 2
			if (param.kind === 'mapping') return sum + rowPx * 3
			// WP27 Part B: a plain text/regex param (pattern, with, …) wraps/grows
			// (UiGrowingInput, capped at 3 rows here — these are usually short) instead of a
			// single-line input — reserve its smaller max-rows cap.
			if (param.kind === 'text' || param.kind === 'regex') return sum + GROW_FIELD_EXTRA_PX / 2
			return sum
		}, 0)
		return rowPx * rowsCount + inlineExtra + descriptionExtra + previewExtra + structuredExtra
	}
	getPorts(shape: NodeShape, node: TableNode): Record<string, ShapePort> {
		const dataWired = isInputWired(this.editor, shape.id, 'data')
		const { dataRow, secondRow } = layout(node, dataWired)
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return {
			data: end('data', dataRow, rowPx),
			extra: end('extra', secondRow ?? dataRow, rowPx),
			output: out(this.getWidthPx(shape, node)),
		}
	}
	async execute(shape: NodeShape, node: TableNode, inputs: InputValues): Promise<ExecutionResult> {
		await sleep(30)
		const extra = getInputText(inputs, 'extra')
		try {
			// GAPS-01: resolved (and, when wired-but-empty, allowed to throw) inside the try so
			// "No table from <source>" always lands in `node.error` too, like every other
			// failure here — not just the engine's own generic run-status banner.
			const dataWired = isInputWired(this.editor, shape.id, 'data')
			const text = wiredOrOwnText(inputs, 'data', dataWired, node.text, getWiredSourceTitle(this.editor, shape.id, 'data'))
			const job: TableJob = { ...node, extra }
			const output = runTable(text, job, extra)
			const rows = output.includes('\n') ? output.split('\n').length - 1 : 0
			const cols = output.split('\n')[0]?.split(',').length ?? 0
			updateNode<TableNode>(
				this.editor,
				shape,
				(n) => ({ ...n, error: null, lastOutput: output.slice(0, 200_000), lastInfo: `${rows} row${rows === 1 ? '' : 's'} × ${cols} column${cols === 1 ? '' : 's'}` }),
				false
			)
			return { output }
		} catch (error) {
			updateNode<TableNode>(this.editor, shape, (n) => ({ ...n, error: (error as Error).message }), false)
			throw error
		}
	}
	getOutputInfo(shape: NodeShape, node: TableNode, inputs: InfoValues): InfoValues {
		return info(shape, node.lastOutput ?? null, inputs)
	}
	Component = TableComponent
}

const OP_OPTIONS = TABLE_OPS.filter((spec) => !spec.hidden).map((spec) => ({
	value: spec.id,
	label: spec.label,
	group: spec.group,
}))

/** A column picker backed by the input table's real headers, falling back to free text. Every
 * DataPipe param is wirable (WP17): `fieldKey` is its op param field, e.g. "column", "with".
 * `allowEmpty` adds a "(none)" choice, for an optional column such as cumsum/pct's group-by. */
function ColumnField({
	shapeId,
	fieldKey,
	label,
	value,
	headers,
	onChange,
	allowEmpty,
	hint,
}: {
	shapeId: TLShapeId
	fieldKey: string
	label: string
	value: string
	headers: string[]
	onChange: (value: string) => void
	allowEmpty?: boolean
	hint?: string
}) {
	if (!headers.length) {
		return (
			<WireField shapeId={shapeId} fieldKey={fieldKey} label={label} hint={hint}>
				<UiTextInput value={value} onChange={onChange} placeholder="column name" />
			</WireField>
		)
	}
	const options = allowEmpty ? [{ value: '', label: '(none)' }, ...headers.map((h) => ({ value: h, label: h }))] : headers.map((h) => ({ value: h, label: h }))
	return (
		<WireField shapeId={shapeId} fieldKey={fieldKey} label={label} hint={hint}>
			<UiSelect value={value} placeholder="Choose a column" options={options} onChange={onChange} />
		</WireField>
	)
}

function ColumnsField({
	shapeId,
	fieldKey,
	label,
	value,
	headers,
	onChange,
}: {
	shapeId: TLShapeId
	fieldKey: string
	label: string
	value: string
	headers: string[]
	onChange: (value: string) => void
}) {
	if (!headers.length) {
		return (
			<WireField shapeId={shapeId} fieldKey={fieldKey} label={label}>
				<UiTextInput value={value} onChange={onChange} placeholder="a, b, c" />
			</WireField>
		)
	}
	return (
		<WireField shapeId={shapeId} fieldKey={fieldKey} label={label}>
			<NodeMultiSelect
				emptyLabel="Choose columns"
				values={splitList(value).filter((v) => headers.includes(v))}
				options={headers.map((h) => ({ value: h, label: h }))}
				onChange={(next) => onChange(next.join(','))}
			/>
		</WireField>
	)
}

/** Insert-function menu for the formula editor, grouped the same way as the language guide
 * (WP11 Part B): Text / Number / Logic / Date. Each entry inserts "name(" plus a one-line hint. */
const FORMULA_FUNCTIONS: { value: string; label: string; group: string; hint: string }[] = [
	{ value: 'upper', label: 'upper', group: 'Text', hint: 'upper(s)' },
	{ value: 'lower', label: 'lower', group: 'Text', hint: 'lower(s)' },
	{ value: 'trim', label: 'trim', group: 'Text', hint: 'trim(s)' },
	{ value: 'len', label: 'len', group: 'Text', hint: 'len(s)' },
	{ value: 'left', label: 'left', group: 'Text', hint: 'left(s, n)' },
	{ value: 'right', label: 'right', group: 'Text', hint: 'right(s, n)' },
	{ value: 'mid', label: 'mid', group: 'Text', hint: 'mid(s, start, n)' },
	{ value: 'replace', label: 'replace', group: 'Text', hint: 'replace(s, find, with)' },
	{ value: 'contains', label: 'contains', group: 'Text', hint: 'contains(s, x)' },
	{ value: 'startswith', label: 'startswith', group: 'Text', hint: 'startswith(s, x)' },
	{ value: 'endswith', label: 'endswith', group: 'Text', hint: 'endswith(s, x)' },
	{ value: 'split', label: 'split', group: 'Text', hint: 'split(s, sep, i)' },
	{ value: 'concat', label: 'concat', group: 'Text', hint: 'concat(a, b, …)' },
	{ value: 'text', label: 'text', group: 'Text', hint: 'text(x)' },
	{ value: 'domain', label: 'domain', group: 'Text', hint: 'domain(url)' },
	{ value: 'path', label: 'path', group: 'Text', hint: 'path(url)' },
	{ value: 'number', label: 'number', group: 'Number', hint: 'number(x)' },
	{ value: 'round', label: 'round', group: 'Number', hint: 'round(x, d)' },
	{ value: 'floor', label: 'floor', group: 'Number', hint: 'floor(x)' },
	{ value: 'ceil', label: 'ceil', group: 'Number', hint: 'ceil(x)' },
	{ value: 'abs', label: 'abs', group: 'Number', hint: 'abs(x)' },
	{ value: 'min', label: 'min', group: 'Number', hint: 'min(a, b, …)' },
	{ value: 'max', label: 'max', group: 'Number', hint: 'max(a, b, …)' },
	{ value: 'pow', label: 'pow', group: 'Number', hint: 'pow(x, y)' },
	{ value: 'sqrt', label: 'sqrt', group: 'Number', hint: 'sqrt(x)' },
	{ value: 'if', label: 'if', group: 'Logic', hint: 'if(cond, a, b)' },
	{ value: 'ifs', label: 'ifs', group: 'Logic', hint: 'ifs(c1, v1, …, else)' },
	{ value: 'coalesce', label: 'coalesce', group: 'Logic', hint: 'coalesce(a, b, …)' },
	{ value: 'isempty', label: 'isempty', group: 'Logic', hint: 'isempty(x)' },
	{ value: 'date', label: 'date', group: 'Date', hint: 'date(x)' },
	{ value: 'year', label: 'year', group: 'Date', hint: 'year(x)' },
	{ value: 'month', label: 'month', group: 'Date', hint: 'month(x)' },
	{ value: 'day', label: 'day', group: 'Date', hint: 'day(x)' },
	{ value: 'weekday', label: 'weekday', group: 'Date', hint: 'weekday(x) — 1–7, Mon=1' },
	{ value: 'week', label: 'week', group: 'Date', hint: 'week(x) — ISO week' },
	{ value: 'quarter', label: 'quarter', group: 'Date', hint: 'quarter(x)' },
	{ value: 'hour', label: 'hour', group: 'Date', hint: 'hour(x)' },
	{ value: 'datediff', label: 'datediff', group: 'Date', hint: 'datediff(a, b, "day")' },
	{ value: 'dateadd', label: 'dateadd', group: 'Date', hint: 'dateadd(x, n, "day")' },
	{ value: 'today', label: 'today', group: 'Date', hint: 'today()' },
]
const FORMULA_FUNCTION_OPTIONS = FORMULA_FUNCTIONS.map((fn) => ({ value: fn.value, label: fn.label, group: fn.group, hint: fn.hint }))

/** Formula column's editor (WP11 Part B): the formula input, a column-chip row that inserts a
 * reference at the cursor, an "insert function" menu, and a live preview (first input row's
 * computed value, or the error in danger colour) debounced 200ms so typing doesn't thrash. */
function FormulaField({
	shapeId,
	fieldKey,
	label,
	value,
	headers,
	sampleRows,
	onChange,
	hint,
}: {
	shapeId: TLShapeId
	fieldKey: string
	label: string
	value: string
	headers: string[]
	sampleRows: Record<string, string>[]
	onChange: (value: string) => void
	hint?: string
}) {
	const { wired } = useWireField(shapeId, fieldKey)
	const inputRef = useRef<HTMLTextAreaElement>(null)
	const [debounced, setDebounced] = useState(value)
	useEffect(() => {
		const timer = window.setTimeout(() => setDebounced(value), 200)
		return () => window.clearTimeout(timer)
	}, [value])

	const insert = (text: string) => {
		const el = inputRef.current
		const start = el?.selectionStart ?? value.length
		const end = el?.selectionEnd ?? value.length
		const next = value.slice(0, start) + text + value.slice(end)
		onChange(next)
		requestAnimationFrame(() => {
			el?.focus()
			el?.setSelectionRange(start + text.length, start + text.length)
		})
	}
	const insertColumn = (name: string) => insert(/[^A-Za-z0-9_]/.test(name) ? `[${name}]` : name)

	// Live preview: the first 3 input rows -> their computed value, or the error (not a run
	// error — shown here in danger colour, never as the card's own error banner).
	const preview = useMemo(() => {
		if (!debounced.trim() || !sampleRows.length) return null
		const results: string[] = []
		for (const row of sampleRows.slice(0, 3)) {
			try {
				results.push(evalFormula(debounced, row))
			} catch (error) {
				return { ok: false as const, text: (error as Error).message }
			}
		}
		return { ok: true as const, text: results.map((r) => r || '(empty)').join(', ') }
	}, [debounced, sampleRows])

	return (
		<>
			<WireField shapeId={shapeId} fieldKey={fieldKey} label={label} hint={hint} grow>
				<UiGrowingInput ref={inputRef} mono value={value} onChange={onChange} placeholder="e.g. upper(name), round(score * 1.2, 1)" />
			</WireField>
			{!wired && (
				<>
					{headers.length > 0 && (
						<NodeRow className="FormulaField-chips">
							{headers.map((h) => (
								<UiChip key={h} label={h} onClick={() => insertColumn(h)} />
							))}
						</NodeRow>
					)}
					<NodeRow>
						<UiSelect
							value=""
							placeholder="Insert function…"
							options={FORMULA_FUNCTION_OPTIONS}
							onChange={(fn) => insert(`${fn}(`)}
						/>
					</NodeRow>
					{preview && (
						<div className={preview.ok ? 'NodeHint FormulaField-preview' : 'FormulaField-error'}>
							{preview.ok ? `= ${preview.text}` : preview.text}
						</div>
					)}
				</>
			)}
		</>
	)
}

const SUMMARY_FNS = [
	{ value: 'count', label: 'Count' },
	{ value: 'count_distinct', label: 'Count distinct' },
	{ value: 'sum', label: 'Sum' },
	{ value: 'avg', label: 'Average' },
	{ value: 'median', label: 'Median' },
	{ value: 'min', label: 'Min' },
	{ value: 'max', label: 'Max' },
	{ value: 'first', label: 'First' },
	{ value: 'last', label: 'Last' },
	{ value: 'list', label: 'List' },
]

interface SummaryRow {
	column: string
	fn: string
	as: string
}

function parseSummaries(value: string): SummaryRow[] {
	return splitList(value).map((spec) => {
		const [column = '*', fn = 'count', as = ''] = spec.split(':').map((s) => s.trim())
		return { column, fn, as }
	})
}

function stringifySummaries(rows: SummaryRow[]): string {
	return rows.map((r) => [r.column || '*', r.fn || 'count', r.as].filter(Boolean).join(':')).join(',')
}

/** Group and summarise's "Summaries" editor (WP11 Part C): a row per summary — column, function,
 * "as" name, remove — stored in the existing `col:fn[:alias]` text form so old canvases that
 * wrote it by hand (or just "col:fn") keep working. */
function GroupSummariesField({
	shapeId,
	fieldKey,
	label,
	value,
	headers,
	onChange,
}: {
	shapeId: TLShapeId
	fieldKey: string
	label: string
	value: string
	headers: string[]
	onChange: (value: string) => void
}) {
	const { wired } = useWireField(shapeId, fieldKey)
	const rows = parseSummaries(value)
	const set = (next: SummaryRow[]) => onChange(stringifySummaries(next))
	const columnOptions = [{ value: '*', label: '(any column)' }, ...headers.map((h) => ({ value: h, label: h }))]
	return (
		<>
			<WireFieldHeader shapeId={shapeId} fieldKey={fieldKey} label={label} />
			{!wired && (
				<>
					{rows.map((row, i) => (
						<NodeRow key={i} className="GroupSummaryRow">
							<UiSelect
								value={row.column || '*'}
								options={columnOptions}
								onChange={(column) => set(rows.map((r, j) => (j === i ? { ...r, column } : r)))}
							/>
							<UiSelect value={row.fn} options={SUMMARY_FNS} onChange={(fn) => set(rows.map((r, j) => (j === i ? { ...r, fn } : r)))} />
							<UiTextInput
								value={row.as}
								placeholder="as name"
								onChange={(as) => set(rows.map((r, j) => (j === i ? { ...r, as } : r)))}
							/>
							<UiIconButton icon={<IconClose />} title="Remove this summary" onClick={() => set(rows.filter((_, j) => j !== i))} />
						</NodeRow>
					))}
					<NodeRow>
						<UiButton
							size="sm"
							variant="low"
							icon={<IconPlus />}
							label="+ Add summary"
							onClick={() => set([...rows, { column: headers[0] ?? '*', fn: 'count', as: '' }])}
						/>
					</NodeRow>
				</>
			)}
		</>
	)
}

interface MapPair {
	from: string
	to: string
}

function parseMapping(value: string): MapPair[] {
	if (!value || !value.trim()) return []
	try {
		const parsed = JSON.parse(value)
		if (!Array.isArray(parsed)) return []
		return parsed.filter((p): p is MapPair => !!p && typeof p === 'object' && 'from' in p && 'to' in p)
	} catch {
		return []
	}
}

/** New column "Map values"' from → to rows editor (WP11 Part B), stored as a JSON array of
 * pairs in the `pattern` field. */
function CaseMappingField({
	shapeId,
	fieldKey,
	label,
	value,
	onChange,
}: {
	shapeId: TLShapeId
	fieldKey: string
	label: string
	value: string
	onChange: (value: string) => void
}) {
	const { wired } = useWireField(shapeId, fieldKey)
	const pairs = parseMapping(value)
	const set = (next: MapPair[]) => onChange(JSON.stringify(next))
	return (
		<>
			<WireFieldHeader shapeId={shapeId} fieldKey={fieldKey} label={label} />
			{!wired && (
				<>
					{pairs.map((pair, i) => (
						<NodeRow key={i} className="MappingRow">
							<UiTextInput
								value={pair.from}
								placeholder="from"
								onChange={(from) => set(pairs.map((p, j) => (j === i ? { ...p, from } : p)))}
							/>
							<span className="MappingRow-arrow">→</span>
							<UiTextInput value={pair.to} placeholder="to" onChange={(to) => set(pairs.map((p, j) => (j === i ? { ...p, to } : p)))} />
							<UiIconButton icon={<IconClose />} title="Remove this row" onClick={() => set(pairs.filter((_, j) => j !== i))} />
						</NodeRow>
					))}
					<NodeRow>
						<UiButton size="sm" variant="low" icon={<IconPlus />} label="+ Add row" onClick={() => set([...pairs, { from: '', to: '' }])} />
					</NodeRow>
				</>
			)}
		</>
	)
}

function ParamField({
	shapeId,
	param,
	node,
	headers,
	sampleRows,
	set,
}: {
	shapeId: TLShapeId
	param: ReturnType<typeof layout>['params'][number]
	node: TableNode
	headers: string[]
	sampleRows: Record<string, string>[]
	set: (patch: Partial<TableNode>) => void
}) {
	const raw = (node as unknown as Record<string, unknown>)[param.field]
	const value = typeof raw === 'string' ? raw : ''
	const onChange = (next: string) => set({ [param.field]: next } as Partial<TableNode>)
	if (param.kind === 'column') {
		return (
			<ColumnField
				shapeId={shapeId}
				fieldKey={param.field}
				label={param.label}
				value={value}
				headers={headers}
				onChange={onChange}
				allowEmpty={!param.required}
				hint={param.hint}
			/>
		)
	}
	if (param.kind === 'columns') {
		return <ColumnsField shapeId={shapeId} fieldKey={param.field} label={param.label} value={value} headers={headers} onChange={onChange} />
	}
	if (param.kind === 'enum') {
		return (
			<WireField shapeId={shapeId} fieldKey={param.field} label={param.label} hint={param.hint}>
				<UiSelect value={value || param.options?.[0]?.value || ''} options={param.options ?? []} onChange={onChange} />
			</WireField>
		)
	}
	if (param.kind === 'boolean') {
		const checked = typeof raw === 'boolean' ? raw : value === 'true'
		return (
			<WireField shapeId={shapeId} fieldKey={param.field} label={param.label} hint={param.hint}>
				<UiCheckbox checked={checked} onChange={(next) => set({ [param.field]: next } as Partial<TableNode>)} />
			</WireField>
		)
	}
	if (param.kind === 'number') {
		// The field is stored as text either way (DataPipe's own fields are all plain strings;
		// the table engine parses them), so the wirable port stays "text" too, matching nodeSpecs.
		return (
			<WireField shapeId={shapeId} fieldKey={param.field} label={param.label} hint={param.hint}>
				<UiTextInput value={value} onChange={onChange} inputMode="decimal" placeholder={param.placeholder} />
			</WireField>
		)
	}
	if (param.kind === 'formula') {
		return (
			<FormulaField
				shapeId={shapeId}
				fieldKey={param.field}
				label={param.label}
				value={value}
				headers={headers}
				sampleRows={sampleRows}
				onChange={onChange}
				hint={param.hint}
			/>
		)
	}
	if (param.kind === 'summaries') {
		return <GroupSummariesField shapeId={shapeId} fieldKey={param.field} label={param.label} value={value} headers={headers} onChange={onChange} />
	}
	if (param.kind === 'mapping') {
		return <CaseMappingField shapeId={shapeId} fieldKey={param.field} label={param.label} value={value} onChange={onChange} />
	}
	// 'regex' (and plain 'text') renders as a wrapping, growing mono field (WP27 Part B) — a
	// pattern or a long replacement/value shouldn't just cut off mid-line.
	return (
		<WireField shapeId={shapeId} fieldKey={param.field} label={param.label} hint={param.hint} grow>
			<UiGrowingInput mono maxRows={3} value={value} onChange={onChange} placeholder={param.placeholder} />
		</WireField>
	)
}

function wireOutputToInput(editor: Editor, fromShapeId: TLShapeId, toShapeId: TLShapeId) {
	const connectionId = createShapeId()
	editor.createShape({
		type: 'connection',
		id: connectionId,
		x: 0,
		y: 0,
		index: getNextConnectionIndex(editor),
	})
	createOrUpdateConnectionBinding(editor, connectionId, fromShapeId, { portId: 'output', terminal: 'start', order: 0 })
	createOrUpdateConnectionBinding(editor, connectionId, toShapeId, { portId: 'data', terminal: 'end', order: 0 })
}

function TableComponent({ shape, node }: NodeComponentProps<TableNode>) {
	const editor = useEditor()
	const fileRef = useRef<HTMLInputElement>(null)
	const [busy, setBusy] = useState(false)
	const set = (patch: Partial<TableNode>) => updateNode<TableNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const dataWired = useInputConnected(shape.id, 'data')
	const extraWired = useInputConnected(shape.id, 'extra')
	const source = node.source ?? (dataWired ? 'input' : 'inline')
	const spec = opSpec(node.op) ?? TABLE_OPS[0]

	// GAPS-01: once "data" is wired, it's the only source for the live preview below — a
	// wired-but-empty/failed value must never fall back to showing the old `text` instead.
	const effectiveText = useValue(
		'datapipe input text',
		() => {
			if (dataWired) {
				const wired = getNodeInputPortValues(editor, shape.id).data?.value
				return typeof wired === 'string' ? wired : ''
			}
			return node.text
		},
		[editor, shape.id, node.text, dataWired]
	)
	const inputTable = useMemo(() => {
		try {
			return parseTableText(effectiveText)
		} catch {
			return null
		}
	}, [effectiveText])
	const headers = inputTable?.headers ?? []
	// Formula column's live preview (WP11 Part B): the op's own input rows, before this step runs.
	const sampleRows = useMemo(() => {
		if (!inputTable) return []
		return inputTable.rows.slice(0, 3).map((row) => Object.fromEntries(inputTable.headers.map((h, i) => [h, row[i] ?? ''])))
	}, [inputTable])

	const uploadFile = async (file: File) => {
		setBusy(true)
		try {
			const stored = await storeFile(file)
			const bytes = await loadFileBytes(stored.url)
			const sheet = await readSpreadsheet(bytes, file.name)
			const firstSheet = sheet.sheets[0]
			set({
				source: 'file',
				fileUrl: stored.url,
				fileName: file.name,
				sheets: sheet.sheets,
				sheet: firstSheet,
				text: sheet.toCsv(firstSheet),
				format: 'csv',
				error: null,
			})
		} catch (error) {
			set({ error: (error as Error).message })
		} finally {
			setBusy(false)
			if (fileRef.current) fileRef.current.value = ''
		}
	}

	const chooseSheet = async (sheetName: string) => {
		if (!node.fileUrl || !node.fileName) return
		setBusy(true)
		try {
			const bytes = await loadFileBytes(node.fileUrl)
			const sheet = await readSpreadsheet(bytes, node.fileName)
			set({ sheet: sheetName, text: sheet.toCsv(sheetName) })
		} catch (error) {
			set({ error: (error as Error).message })
		} finally {
			setBusy(false)
		}
	}

	// WP11 Part F: "Add next step" opens the same grouped op list the operation picker uses,
	// instead of always chaining a bare "Keep columns" step.
	const addStep = (op: string) => {
		if (!op) return
		editor.run(() => {
			const nextShapeId = createNodeAt(
				editor,
				{
					type: 'table',
					...TableDefaultForChain(),
					op,
				},
				{ rightOf: shape.id }
			)
			wireOutputToInput(editor, shape.id, nextShapeId)
		})
	}

	const preview = useMemo(() => {
		if (!node.lastOutput) return null
		try {
			return parseTableText(node.lastOutput)
		} catch {
			return null
		}
	}, [node.lastOutput])
	// WP11 Part F: column type badges in the preview header, from shared/profile.ts.
	const previewTypes = useMemo(() => {
		if (!preview) return []
		try {
			return profileTable(preview, 0).map((p) => p.type)
		} catch {
			return []
		}
	}, [preview])

	return (
		<>
			{/* DATA-07: "data" always gets its own row with a visible, draggable port dot (it
			    used to borrow this row for the Inline/File picker while unwired, leaving "data"
			    with no dot at all in the default state — the fix Profile/Table view already
			    have). The source picker is its own row underneath, only while unwired. */}
			<PortRow shapeId={shape.id} portId="data" label="Table" dataType="text" />
			{!dataWired && (
				<NodeRow>
					<UiSegmented
						value={source === 'file' ? 'file' : 'inline'}
						options={[
							{ value: 'inline', label: 'Inline' },
							{ value: 'file', label: 'File' },
						]}
						onChange={(next) => set({ source: next })}
					/>
				</NodeRow>
			)}
			{!dataWired && source === 'inline' && (
				<UiTextArea
					className="NodeField-textarea"
					mono
					rows={4}
					value={node.text}
					placeholder="Paste a table: CSV, TSV, JSON array, or Markdown"
					onChange={(text) => set({ text })}
				/>
			)}
			{!dataWired && source === 'file' && (
				<>
					<NodeRow className="DataPipe-fileRow">
						<input
							ref={fileRef}
							type="file"
							accept=".csv,.tsv,.txt,.xls,.xlsx,.ods"
							style={{ display: 'none' }}
							onChange={(e) => {
								const file = e.currentTarget.files?.[0]
								if (file) void uploadFile(file)
							}}
						/>
						<UiButton
							size="sm"
							variant="low"
							icon={<IconUpload />}
							disabled={busy}
							label={busy ? 'Reading…' : node.fileName || 'Upload CSV, TSV, XLS, XLSX'}
							onClick={() => fileRef.current?.click()}
						/>
						{(node.sheets?.length ?? 0) > 1 && (
							<UiSelect
								value={node.sheet || node.sheets![0]}
								options={node.sheets!.map((s) => ({ value: s, label: s }))}
								onChange={(sheetName) => void chooseSheet(sheetName)}
							/>
						)}
					</NodeRow>
				</>
			)}
			<UiField label="Operation">
				{/* DATA-08: switching the operation resets "as" — its valid values are different
				    for nearly every op that reads it (condition/order/convert-to/fill-with/…),
				    so a leftover value from the previous op is never a stale, invalid choice. */}
				<UiSelect value={node.op} options={OP_OPTIONS} onChange={(op) => set({ op, as: '' })} />
			</UiField>
			<div className="NodeHint">{spec.description}</div>
			{spec.params.map((param) => (
				<ParamField key={param.field} shapeId={shape.id} param={param} node={node} headers={headers} sampleRows={sampleRows} set={set} />
			))}
			{spec.second && (
				<PortRow shapeId={shape.id} portId="extra" label={spec.second.label} dataType="text" hint={spec.second.hint} />
			)}
			{preview ? (
				<>
					{previewTypes.length > 0 && (
						<NodeRow className="DataPipe-typeBadges">
							{preview.headers.map((h, i) => (
								<UiChip key={h} label={`${h}: ${previewTypes[i]}`} />
							))}
						</NodeRow>
					)}
					<ExpandableTable title="DataPipe" columns={preview.headers} rows={preview.rows} maxRows={50} />
					<div className="NodeHint">{node.lastInfo}</div>
				</>
			) : (
				<UiEmpty text="Press Run to see the result" />
			)}
			<NodeRow>
				<UiSelect placeholder="Add next step…" value="" options={OP_OPTIONS} onChange={addStep} />
			</NodeRow>
		</>
	)
}

/** Default parameters for a freshly chained DataPipe step (Keep columns, nothing picked yet). */
function TableDefaultForChain(): Omit<TableNode, 'type'> {
	return {
		text: '',
		format: 'auto',
		op: 'select',
		columns: '',
		column: '',
		as: '',
		expr: '',
		sep: ' ',
		pattern: '',
		with: '',
		name: '',
		error: null,
		source: 'input',
		fileUrl: '',
		fileName: '',
		sheet: '',
		sheets: [],
		lastOutput: null,
		lastInfo: '',
		totals: false,
		columns2: '',
	}
}

// ---------------------------------------------------------------------------
// Chart (WP12: more kinds, series-from-a-column, aggregate, sort/top-N, titles,
// and a rendered PNG output so it can feed Output / Generate image / "Place on canvas").
// ---------------------------------------------------------------------------

export type ChartNode = T.TypeOf<typeof ChartNode>
export const ChartNode = T.object({
	type: T.literal('chart'),
	text: T.string,
	format: T.string,
	kind: T.string,
	xCol: T.string,
	/** Comma-separated list of y columns; one series per column (or per split value — see `series`). */
	yCol: T.string,
	/** With 2+ series, plot the first on the left axis and the rest on the right. */
	dualScale: T.boolean,
	error: T.string.nullable(),
	// New, optional (WP12). Saved canvases without these keep rendering the same chart: every
	// default below reproduces the old bar/line/pie passthrough behaviour exactly.
	/** Split into one series per distinct value of this column ("long" data). */
	series: T.string.optional(),
	/** 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max'. */
	aggregate: T.string.optional(),
	stack: T.boolean.optional(),
	/** 'none' | 'x' | 'value-asc' | 'value-desc'. */
	sort: T.string.optional(),
	top: T.number.optional(),
	otherRow: T.boolean.optional(),
	bins: T.number.optional(),
	title: T.string.optional(),
	xLabel: T.string.optional(),
	yLabel: T.string.optional(),
	labels: T.boolean.optional(),
	smooth: T.boolean.optional(),
	/** "Titles and labels" section open/closed. */
	titlesOpen: T.boolean.optional(),
	/** The last rendered chart, as a /api/images/… URL (the output port's value). */
	imageUrl: T.string.nullable().optional(),
})

/** Fields shown only for some chart kinds (see `fieldVisibility.ts`'s `chart` case), in the
 * order they're laid out below "Y columns". Used to keep `getBodyHeightPx` in sync with what
 * the component actually renders. */
const CHART_EXTRA_FIELDS = ['series', 'aggregate', 'stack', 'dualScale', 'sort', 'top', 'otherRow', 'bins'] as const
const CHART_TITLE_FIELDS = ['title', 'xLabel', 'yLabel', 'labels', 'smooth'] as const
const CHART_AREA_PX = 280

function chartVisibleRows(node: ChartNode) {
	const hidden = hiddenFieldKeys(node)
	return {
		extra: CHART_EXTRA_FIELDS.filter((f) => !hidden.has(f)),
		titleFields: CHART_TITLE_FIELDS.filter((f) => !hidden.has(f)),
		hidden,
	}
}

function chartSpecFrom(node: ChartNode, xCol: string, yCols: string[], series: string): ChartSpec {
	return {
		kind: node.kind,
		x: xCol,
		y: yCols,
		series: series || undefined,
		aggregate: (node.aggregate as ChartSpec['aggregate']) || 'none',
		stack: !!node.stack,
		dual: !!node.dualScale,
		sort: (node.sort as ChartSpec['sort']) || 'none',
		top: node.top || 0,
		otherRow: !!node.otherRow,
		bins: node.bins || 10,
		title: node.title || undefined,
		xLabel: node.xLabel || undefined,
		yLabel: node.yLabel || undefined,
		labels: !!node.labels,
		smooth: !!node.smooth,
	}
}

/** The palette + axis/text colours from tldraw's current theme (see `NodeShapeUtil.tsx`'s
 * `getColorValue(editor.getCurrentTheme().colors[editor.getColorMode()], …)` for the pattern),
 * so the chart looks right in both light and dark mode. */
const CHART_PALETTE_IDS = ['blue', 'orange', 'green', 'violet', 'red', 'light-blue', 'yellow', 'grey'] as const

function getChartTheme(editor: Editor): ChartTheme {
	const colors = editor.getCurrentTheme().colors[editor.getColorMode()]
	return {
		palette: CHART_PALETTE_IDS.map((id) => getColorValue(colors, id, 'solid')),
		text: colors.text,
		axis: colors.text,
		split: getColorValue(colors, 'grey', 'semi'),
	}
}

/** Render an ECharts option to a stored PNG URL, off-screen (never shown). */
/** Histograms have no X column, so X must not block picking the same column for Y. */
function chartXFor(node: ChartNode): string {
	return node.kind === 'histogram' ? '' : node.xCol
}

async function renderChartPng(option: Record<string, unknown>, width = 960, height = 600): Promise<string> {
	const mod = await import('echarts')
	// Paint the theme's own background so dark-theme text stays readable in the image.
	const background =
		getComputedStyle(document.querySelector('.tl-container') ?? document.body).getPropertyValue('--tl-color-background').trim() || '#fff'
	// Server-side SVG mode: no DOM node and no animation frame, so it renders the same whether
	// or not the page is visible (an off-screen canvas left pie charts empty).
	const chart = mod.init(null, null, { renderer: 'svg', ssr: true, width, height })
	chart.setOption({ ...option, animation: false, backgroundColor: background })
	const svg = chart.renderToSVGString()
	chart.dispose()
	const svgBlob = new Blob([svg], { type: 'image/svg+xml' })
	try {
		return await storeBlob(await svgToPng(svgBlob, width, height, 2))
	} catch {
		// Rasterizing failed (no canvas support): keep the SVG, it still shows and places fine.
		return await storeBlob(svgBlob)
	}
}

async function svgToPng(svg: Blob, width: number, height: number, scale: number): Promise<Blob> {
	const url = URL.createObjectURL(svg)
	try {
		const img = new Image()
		img.src = url
		await Promise.race([
			img.decode(),
			new Promise((_, reject) => setTimeout(() => reject(new Error('SVG decode timed out')), 5000)),
		])
		const canvas = document.createElement('canvas')
		canvas.width = width * scale
		canvas.height = height * scale
		const ctx = canvas.getContext('2d')
		if (!ctx) throw new Error('No 2D canvas')
		ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encode failed'))), 'image/png')
		)
	} finally {
		URL.revokeObjectURL(url)
	}
}

export class ChartNodeDefinition extends NodeDefinition<ChartNode> {
	static type = 'chart'
	static validator = ChartNode
	title = 'Chart'
	heading = 'Chart'
	icon = icon
	category = categoryOf('chart')
	resultKeys = ['error', 'imageUrl'] as const
	override showsOutput = true
	override defaultWidthPx = 440
	getDefault(): ChartNode {
		return {
			type: 'chart',
			// GAPS-01: a fresh card starts empty, not seeded with sample data; a saved canvas
			// that already has SAMPLE in `text` keeps it as is.
			text: '',
			format: 'csv',
			kind: 'bar',
			xCol: 'name',
			yCol: 'score',
			dualScale: false,
			error: null,
			series: '',
			aggregate: 'none',
			stack: false,
			sort: 'none',
			top: 0,
			otherRow: false,
			bins: 10,
			title: '',
			xLabel: '',
			yLabel: '',
			labels: false,
			smooth: false,
			titlesOpen: false,
			imageUrl: null,
		}
	}
	getBodyHeightPx(shape: NodeShape, node: ChartNode) {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const { extra, titleFields } = chartVisibleRows(node)
		// data, kind, x column, y columns = 4, + the "Text" header row and its placeholder
		// textarea while "data" isn't wired (WP39: the row used to be an empty header with no
		// editor underneath it — now matches Profile/Table view's own text field, and like
		// theirs, is hidden entirely once "data" is wired), then the kind-dependent extra
		// fields, the "Titles and labels" header (+ its own fields when open), then the chart
		// area — a flexible region (`.ChartNode-viewWrap`, see shell.css) that absorbs the
		// textarea's real height being taller than one nominal row, the same way Profile's does.
		const dataWired = isInputWired(this.editor, shape.id, 'data')
		const rows = 4 + (dataWired ? 0 : 1) + extra.length + 1 + (node.titlesOpen ? titleFields.length : 0)
		return rowPx * rows + CHART_AREA_PX
	}
	getPorts(shape: NodeShape, node: ChartNode): Record<string, ShapePort> {
		return {
			data: end('data', 0, getNodeRowHeightPx(shape.props.fontSize)),
			output: { ...out(this.getWidthPx(shape, node)), dataType: 'image' },
		}
	}
	async execute(shape: NodeShape, node: ChartNode, inputs: InputValues): Promise<ExecutionResult> {
		// Falls back to the node's own text if resolving the wired value itself throws (GAPS-01),
		// so the catch below always has something to store.
		let text = node.text
		try {
			const dataWired = isInputWired(this.editor, shape.id, 'data')
			text = wiredOrOwnText(inputs, 'data', dataWired, node.text, getWiredSourceTitle(this.editor, shape.id, 'data'))
			const table = parseTableText(text)
			if (table.headers.length === 0) throw new Error('No table to chart. Wire in a table, or paste one into Text.')
			// P8: a Y column explicitly named (by the user, or the default) that matches nothing
			// in the real table is an error, not a silently different chart — `resolveColumns`'s
			// own fallback below is only meant to pick a sensible column when none was named.
			const requestedY = splitList(node.yCol)
			if (requestedY.length > 0 && !requestedY.some((col) => table.headers.includes(col))) {
				throw new Error(`Chart: no column named "${requestedY.join('", "')}" for Y. Columns: ${table.headers.join(', ')}`)
			}
			const columns = resolveColumns(table, chartXFor(node), requestedY)
			const series = node.series && table.headers.includes(node.series) ? node.series : ''
			const spec = chartSpecFrom(node, columns.xCol, columns.yCols, series)
			const option = buildChart(table, spec, getChartTheme(this.editor))
			const imageUrl = await renderChartPng(option)
			updateNode<ChartNode>(this.editor, shape, (n) => ({ ...n, text, error: null, imageUrl }), false)
			return { output: imageUrl }
		} catch (error) {
			updateNode<ChartNode>(this.editor, shape, (n) => ({ ...n, text, error: (error as Error).message }), false)
			throw error
		}
	}
	getOutputInfo(shape: NodeShape, node: ChartNode, inputs: InfoValues): InfoValues {
		return {
			output: {
				value: node.imageUrl ?? null,
				isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
				dataType: 'image',
			},
		}
	}
	Component = ChartComponent
}

const icon = <span className="NodeShape-emoji">▦</span>

const AGGREGATE_OPTIONS = [
	{ value: 'none', label: 'None' },
	{ value: 'sum', label: 'Sum' },
	{ value: 'avg', label: 'Average' },
	{ value: 'count', label: 'Count' },
	{ value: 'min', label: 'Min' },
	{ value: 'max', label: 'Max' },
]

const SORT_OPTIONS = [
	{ value: 'none', label: 'None' },
	{ value: 'x', label: 'By x' },
	{ value: 'value-asc', label: 'Value ↑' },
	{ value: 'value-desc', label: 'Value ↓' },
]

/** "Titles and labels": a collapsible section, like `MoreSettingsSection` in ImageGenNode.tsx.
 * While closed, its still-wirable fields anchor their ports to the header row. */
function ChartTitlesSection({
	shape,
	node,
	set,
	fields,
}: {
	shape: NodeShape
	node: ChartNode
	set: (patch: Partial<ChartNode>) => void
	fields: readonly string[]
}) {
	const closedRef = useFieldPortAnchors<HTMLButtonElement>(shape.id, node.titlesOpen ? [] : [...fields])
	return (
		<div className="UiSection">
			<button
				ref={closedRef}
				type="button"
				className="UiSection-title"
				onPointerDown={stopEvent}
				onClick={() => set({ titlesOpen: !node.titlesOpen })}
			>
				{node.titlesOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
				Titles and labels
				{!node.titlesOpen && (
					<span className="ChartNode-toggle-ports" title="Title/label inputs (open to see them)">
						{fields.map((key) => (
							<Port key={key} shapeId={shape.id} portId={fieldPortId(key)} />
						))}
					</span>
				)}
			</button>
			{node.titlesOpen && (
				<div className="UiSection-body">
					{fields.includes('title') && (
						<WireField shapeId={shape.id} fieldKey="title" label="Title">
							<UiTextInput value={node.title ?? ''} onChange={(title) => set({ title })} />
						</WireField>
					)}
					{fields.includes('xLabel') && (
						<WireField shapeId={shape.id} fieldKey="xLabel" label="X label">
							<UiTextInput value={node.xLabel ?? ''} onChange={(xLabel) => set({ xLabel })} />
						</WireField>
					)}
					{fields.includes('yLabel') && (
						<WireField shapeId={shape.id} fieldKey="yLabel" label="Y label">
							<UiTextInput value={node.yLabel ?? ''} onChange={(yLabel) => set({ yLabel })} />
						</WireField>
					)}
					{fields.includes('labels') && (
						<WireField shapeId={shape.id} fieldKey="labels" label="Data labels">
							<UiCheckbox checked={!!node.labels} label="Show value labels" onChange={(labels) => set({ labels })} />
						</WireField>
					)}
					{fields.includes('smooth') && (
						<WireField shapeId={shape.id} fieldKey="smooth" label="Smooth">
							<UiCheckbox checked={!!node.smooth} label="Smooth curve" onChange={(smooth) => set({ smooth })} />
						</WireField>
					)}
				</div>
			)}
		</div>
	)
}

type EchartsInstance = { dispose: () => void; setOption: (option: object, notMerge?: boolean) => void; resize: () => void }

function ChartComponent({ shape, node }: NodeComponentProps<ChartNode>) {
	const editor = useEditor()
	const hostRef = useRef<HTMLDivElement | null>(null)
	const hostGenerationRef = useRef(0)
	const chartRef = useRef<EchartsInstance | null>(null)
	const chartObserverRef = useRef<ResizeObserver | null>(null)
	const applyOptionRef = useRef<(() => void) | null>(null)
	const [zoomOpen, setZoomOpen] = useState(false)
	const set = (patch: Partial<ChartNode>) => updateNode<ChartNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const dataWired = useInputConnected(shape.id, 'data')
	const sourceTitle = useValue('chart source title', () => getWiredSourceTitle(editor, shape.id, 'data'), [editor, shape.id])
	// GAPS-01: once "data" is wired, it's the only source for the live preview — a
	// wired-but-empty/failed value must never fall back to the card's own leftover text.
	const source = useValue(
		'chart source',
		() => {
			if (dataWired) {
				const value = getNodeInputPortValues(editor, shape.id).data?.value
				return typeof value === 'string' ? value : ''
			}
			return node.text
		},
		[editor, shape.id, node.text, dataWired]
	)
	const table = useMemo(() => {
		try {
			return parseTableText(source)
		} catch {
			return { headers: [] as string[], rows: [] as string[][] }
		}
	}, [source])
	const columns = resolveColumns(table, chartXFor(node), splitList(node.yCol))
	const ySelected = splitList(node.yCol)
	const yOptions = useMemo(() => columnsNumberFirst(table), [table])
	const seriesCol = node.series && table.headers.includes(node.series) ? node.series : ''
	const { titleFields, hidden } = chartVisibleRows(node)
	const theme = useValue('chart theme', () => getChartTheme(editor), [editor])

	// The chosen columns are never rewritten here: resolveColumns only picks a fallback for
	// display and rendering, so a choice made before the input arrives (or while it is briefly
	// empty) survives until the real table shows up.

	// WP25: the echarts instance itself is created once per mount, not disposed and
	// re-`import()`/`init()`-ed on every option-affecting change (every keystroke in a title
	// field, every column pick). `applyOptionRef` always holds the latest `setOption` call, so
	// whichever effect finishes last (mount, or a data/option change) can safely invoke it.
	//
	// DATA-01: the host `<div>` below only renders once there's a table and a Y column to plot,
	// so a card that mounts before its wired data arrives would never get a `ref.current` to
	// init against with a mount-only effect (an empty deps array only runs once, at that first,
	// host-less mount, and never again when the div later appears). A callback ref fixes this:
	// it fires every time the div actually attaches or detaches, by definition.
	const attachHost = useCallback((host: HTMLDivElement | null) => {
		// The host changed (or disappeared): tear down whatever was attached to the old one.
		chartObserverRef.current?.disconnect()
		chartObserverRef.current = null
		chartRef.current?.dispose()
		chartRef.current = null
		hostRef.current = host
		if (!host) return
		// React StrictMode re-invokes a ref callback (null, then the *same* host element) once
		// right after mount, to surface missing cleanup — a plain "is this still the current
		// host" check can't tell that apart from a genuinely new attach, since the element is
		// identical either way. A generation counter can: each call claims the next number, and
		// its async `init()` only runs if no *later* call has claimed one since — otherwise two
		// `echarts.init()` calls can land on the same DOM node with neither ever disposed.
		const generation = ++hostGenerationRef.current
		void import('echarts').then((mod) => {
			if (hostGenerationRef.current !== generation) return
			const chart = mod.init(host)
			chartRef.current = chart
			applyOptionRef.current?.()
			chart.resize()
			// The card can be resized or change its text size. The chart follows the area it has.
			const observer = new ResizeObserver(() => chart.resize())
			observer.observe(host)
			chartObserverRef.current = observer
		})
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	useEffect(() => {
		const spec = chartSpecFrom(node, columns.xCol, columns.yCols, seriesCol)
		const apply = () => {
			const chart = chartRef.current
			if (!chart) return
			try {
				chart.setOption(buildChart(table, spec, theme), true)
			} catch (error) {
				set({ error: (error as Error).message })
			}
		}
		applyOptionRef.current = apply
		apply()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		table,
		theme,
		node.kind,
		columns.xCol,
		columns.yCols.join(','),
		seriesCol,
		node.aggregate,
		node.stack,
		node.dualScale,
		node.sort,
		node.top,
		node.otherRow,
		node.bins,
		node.title,
		node.xLabel,
		node.yLabel,
		node.labels,
		node.smooth,
	])

	return (
		<div className="ChartNode">
			<PortRow shapeId={shape.id} portId="data" label="Table" dataType="text" />
			{/* WP39: this row used to be a bare "Text" header with no editor under it (nothing to
			 * type into, no placeholder) whenever the chart had no table to plot yet. Now matches
			 * Profile/Table view's own Text field exactly: a real textarea with the same
			 * placeholder while "data" isn't wired, hidden entirely once it is (the wired table
			 * is the only source then, same as Profile). */}
			{!dataWired && (
				<>
					<WireFieldHeader shapeId={shape.id} fieldKey="text" label="Text" />
					<UiTextArea
						className="NodeField-textarea"
						mono
						rows={4}
						value={node.text}
						placeholder="Paste a table: CSV, TSV, JSON array, or Markdown"
						onChange={(text) => set({ text })}
					/>
				</>
			)}
			<WireField shapeId={shape.id} fieldKey="kind" label="Kind">
				<NodeSelect className="NodeField-select" value={node.kind} onPointerDown={stopEvent} onChange={(e) => set({ kind: e.target.value })}>
					{CHART_KINDS.map((k) => (
						<option key={k.id} value={k.id}>
							{k.label}
						</option>
					))}
				</NodeSelect>
			</WireField>
			<WireField shapeId={shape.id} fieldKey="xCol" label="X column">
				<NodeSelect
					className="NodeField-select"
					value={columns.xCol}
					disabled={table.headers.length === 0}
					title="X column"
					onPointerDown={stopEvent}
					onChange={(e) => set({ xCol: e.target.value })}
				>
					{table.headers.map((header) => (
						<option key={header} value={header}>
							{header}
						</option>
					))}
				</NodeSelect>
			</WireField>
			<WireField shapeId={shape.id} fieldKey="yCol" label="Y columns">
				<NodeMultiSelect
					title="Y columns. Pick more than one."
					emptyLabel={table.headers.length ? 'Y columns' : 'No columns'}
					values={ySelected.filter((col) => col !== columns.xCol && table.headers.includes(col))}
					disabled={table.headers.length === 0}
					options={yOptions.map((header) => ({
						value: header,
						label: header,
						disabled: header === columns.xCol,
					}))}
					onChange={(next) => set({ yCol: next.filter((col) => col !== columns.xCol).join(',') })}
				/>
			</WireField>
			{!hidden.has('series') && (
				<WireField shapeId={shape.id} fieldKey="series" label="Split by">
					<NodeSelect className="NodeField-select" value={seriesCol} onPointerDown={stopEvent} onChange={(e) => set({ series: e.target.value })}>
						<option value="">None</option>
						{table.headers.map((header) => (
							<option key={header} value={header}>
								{header}
							</option>
						))}
					</NodeSelect>
				</WireField>
			)}
			{!hidden.has('aggregate') && (
				<WireField shapeId={shape.id} fieldKey="aggregate" label="Summary">
					<UiSelect value={node.aggregate ?? 'none'} options={AGGREGATE_OPTIONS} onChange={(aggregate) => set({ aggregate })} />
				</WireField>
			)}
			{!hidden.has('stack') && (
				<WireField shapeId={shape.id} fieldKey="stack" label="Stack">
					<UiCheckbox checked={!!node.stack} label="Stack series" onChange={(stack) => set({ stack })} />
				</WireField>
			)}
			{!hidden.has('dualScale') && (
				<WireField shapeId={shape.id} fieldKey="dualScale" label="Dual axis">
					<UiCheckbox
						checked={!!node.dualScale}
						title="First series on the left axis, the rest on the right"
						label="Dual y-axes"
						onChange={(dualScale) => set({ dualScale })}
					/>
				</WireField>
			)}
			{!hidden.has('sort') && (
				<WireField shapeId={shape.id} fieldKey="sort" label="Sort">
					<UiSelect value={node.sort ?? 'none'} options={SORT_OPTIONS} onChange={(sort) => set({ sort })} />
				</WireField>
			)}
			{!hidden.has('top') && (
				<WireField shapeId={shape.id} fieldKey="top" label="Top N" dataType="number">
					<UiNumberInput value={node.top ?? 0} min={0} placeholder="all" onChange={(top) => set({ top: top ?? 0 })} />
				</WireField>
			)}
			{!hidden.has('otherRow') && (
				<WireField shapeId={shape.id} fieldKey="otherRow" label="Other">
					<UiCheckbox checked={!!node.otherRow} label='Sum the rest into "Other"' onChange={(otherRow) => set({ otherRow })} />
				</WireField>
			)}
			{!hidden.has('bins') && (
				<WireField shapeId={shape.id} fieldKey="bins" label="Bins" dataType="number">
					<UiNumberInput value={node.bins ?? 10} min={1} onChange={(bins) => set({ bins: bins ?? 10 })} />
				</WireField>
			)}
			<ChartTitlesSection shape={shape} node={node} set={set} fields={titleFields} />
			{table.headers.length === 0 ? (
				<UiEmpty text={dataWired ? `No table from ${sourceTitle ?? 'the wired card'}` : 'Wire in a table, or paste one into Text'} />
			) : columns.yCols.length === 0 ? (
				<UiEmpty text="Pick a number column for Y" />
			) : (
				<div className="ChartNode-viewWrap">
					<div ref={attachHost} className="ChartNode-view" />
					{node.imageUrl && <FieldMax title="Open the chart" onClick={() => setZoomOpen(true)} />}
				</div>
			)}
			{zoomOpen && node.imageUrl && (
				<ImageZoom src={node.imageUrl} onClose={() => setZoomOpen(false)} editor={editor} nextTo={shape} />
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Profile (WP11 Part E): what's in a table before working on it.
// ---------------------------------------------------------------------------

export type ProfileNode = T.TypeOf<typeof ProfileNode>
export const ProfileNode = T.object({
	type: T.literal('profile'),
	text: T.string,
	format: T.string,
	error: T.string.nullable(),
	lastOutput: T.string.nullable().optional(),
})

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The Profile card's per-column stats as a table, shared by `execute` (the CSV output) and
 * the card's own full-size table view (WP23 Part D). */
function profileTableRows(profiles: ColumnProfile[]): { headers: string[]; rows: string[][] } {
	const headers = ['column', 'type', 'filled_pct', 'empty_count', 'distinct_count', 'min', 'max', 'mean', 'top']
	const rows = profiles.map((p) => [
		p.name,
		p.type,
		String(p.filledPct),
		String(p.emptyCount),
		String(p.distinctCount),
		p.min ?? '',
		p.max ?? '',
		p.mean != null ? String(p.mean) : '',
		p.top.map((t) => `${t.value} (${t.count})`).join('; '),
	])
	return { headers, rows }
}

export class ProfileNodeDefinition extends NodeDefinition<ProfileNode> {
	static type = 'profile'
	static validator = ProfileNode
	title = 'Profile'
	heading = 'Profile'
	icon = <IconGroup />
	category = categoryOf('profile')
	resultKeys = ['error', 'lastOutput'] as const
	override showsOutput = true
	override defaultWidthPx = 480
	getDefault(): ProfileNode {
		// GAPS-01: a fresh card starts empty, not seeded with sample data; a saved canvas that
		// already has SAMPLE in `text` keeps it as is.
		return { type: 'profile', text: '', format: 'auto', error: null, lastOutput: null }
	}
	getBodyHeightPx(shape: NodeShape) {
		// Data port row + (unwired: the "text" field's own label row) + the header line + a
		// scrollable column list. WP26: the per-card Format picker is gone (every table is read
		// through `parseTableText`, auto-detected), so this is one row shorter than before.
		const dataWired = isInputWired(this.editor, shape.id, 'data')
		return getNodeRowHeightPx(shape.props.fontSize) * (dataWired ? 2 : 3) + 360
	}
	getPorts(shape: NodeShape, node: ProfileNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return { data: end('data', 0, rowPx), output: out(this.getWidthPx(shape, node)) }
	}
	async execute(shape: NodeShape, node: ProfileNode, inputs: InputValues): Promise<ExecutionResult> {
		try {
			// GAPS-01: resolved inside the try so a wired-but-empty "No table from <source>"
			// lands in `node.error` too, same as any other failure here.
			const dataWired = isInputWired(this.editor, shape.id, 'data')
			const text = wiredOrOwnText(inputs, 'data', dataWired, node.text, getWiredSourceTitle(this.editor, shape.id, 'data'))
			const table = parseTableText(text)
			const { headers, rows } = profileTableRows(profileTable(table))
			const output = toCsv(headers, rows)
			updateNode<ProfileNode>(this.editor, shape, (n) => ({ ...n, error: null, lastOutput: output }), false)
			return { output }
		} catch (error) {
			updateNode<ProfileNode>(this.editor, shape, (n) => ({ ...n, error: (error as Error).message }), false)
			throw error
		}
	}
	getOutputInfo(shape: NodeShape, node: ProfileNode, inputs: InfoValues): InfoValues {
		return info(shape, node.lastOutput ?? null, inputs)
	}
	Component = ProfileComponent
}

const TYPE_COLORS: Record<string, string> = {
	number: 'var(--tl-color-selected)',
	integer: 'var(--tl-color-selected)',
	date: 'var(--tl-color-warning)',
	boolean: 'var(--tl-color-success)',
	text: 'var(--tl-color-muted-2)',
}

function MiniHistogram({ histogram }: { histogram: number[] }) {
	const max = Math.max(1, ...histogram)
	const barWidth = 100 / histogram.length
	return (
		<svg className="Profile-histogram" viewBox="0 0 100 24" preserveAspectRatio="none">
			{histogram.map((count, i) => {
				const h = (count / max) * 22
				return (
					<rect
						key={i}
						x={i * barWidth + 0.5}
						y={24 - h}
						width={Math.max(0, barWidth - 1)}
						height={h}
						fill="var(--tl-color-primary)"
					/>
				)
			})}
		</svg>
	)
}

function ProfileColumnRow({ column, table }: { column: ColumnProfile; table: { headers: string[]; rows: string[][] } }) {
	const [open, setOpen] = useState(false)
	const topN = useMemo(() => {
		if (!open) return column.top
		const index = table.headers.indexOf(column.name)
		if (index < 0) return column.top
		return profileTable(table, 10).find((p) => p.name === column.name)?.top ?? column.top
	}, [open, column, table])
	return (
		<div className="Profile-column">
			<button type="button" className="Profile-column-head" onPointerDown={stopEvent} onClick={() => setOpen((v) => !v)}>
				{open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
				<span className="Profile-column-name">{column.name}</span>
				<UiChip label={column.type} />
				<span className="Profile-column-stat">{column.filledPct}% filled</span>
				<span className="Profile-column-stat">{column.distinctCount} distinct</span>
				{(column.min != null || column.max != null) && (
					<span className="Profile-column-stat">
						{column.min} – {column.max}
					</span>
				)}
				{column.mean != null && <span className="Profile-column-stat">mean {column.mean.toFixed(2)}</span>}
			</button>
			{column.histogram && <MiniHistogram histogram={column.histogram} />}
			{open && (
				<div className="Profile-top">
					{topN.map((t) => (
						<span key={t.value} className="Profile-top-item" title={`${t.count} rows`}>
							{t.value || '(empty)'} <b>{t.count}</b>
						</span>
					))}
				</div>
			)}
			{!open && (
				<div className="Profile-top">
					{column.top.map((t) => (
						<span key={t.value} className="Profile-top-item" title={`${t.count} rows`}>
							{t.value || '(empty)'} <b>{t.count}</b>
						</span>
					))}
				</div>
			)}
		</div>
	)
}

function ProfileComponent({ shape, node }: NodeComponentProps<ProfileNode>) {
	const editor = useEditor()
	const dataWired = useInputConnected(shape.id, 'data')
	const set = (patch: Partial<ProfileNode>) => updateNode<ProfileNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const sourceTitle = useValue('profile source title', () => getWiredSourceTitle(editor, shape.id, 'data'), [editor, shape.id])
	// GAPS-01: once "data" is wired, it's the only source — a wired-but-empty/failed value must
	// never fall back to showing the old `text` instead.
	const effectiveText = useValue(
		'profile input text',
		() => {
			if (dataWired) {
				const wired = getNodeInputPortValues(editor, shape.id).data?.value
				return typeof wired === 'string' ? wired : ''
			}
			return node.text
		},
		[editor, shape.id, node.text, dataWired]
	)
	// WP26: every table arriving here (wired or pasted into Text) is read through
	// `parseTableText` — CSV, TSV, semicolon CSV, JSON, or a Markdown table, auto-detected. The
	// per-card Format picker that used to force `csv`/`tsv` is gone; `node.format` stays in the
	// schema (unused) only so an old saved canvas still loads.
	const table = useMemo(() => {
		try {
			return parseTableText(effectiveText)
		} catch {
			return null
		}
	}, [effectiveText])
	const columns = useMemo(() => (table ? profileTable(table) : []), [table])
	const fileSize = useMemo(() => formatFileSize(new TextEncoder().encode(effectiveText).length), [effectiveText])
	const [tableOpen, setTableOpen] = useState(false)
	const profileAsTable = useMemo(() => profileTableRows(columns), [columns])
	return (
		<>
			{/* WP21 follow-up: "data" is a dedicated port, separate from the wirable "text"
			    field below — its own row/anchor must always render, not just while wired
			    (it used to borrow the "text" field's row when unwired, leaving "data" with
			    no visible dot at all in the default state). */}
			<PortRow shapeId={shape.id} portId="data" label="Table" dataType="text" />
			{!dataWired && (
				<>
					<WireFieldHeader shapeId={shape.id} fieldKey="text" label="Text" />
					<UiTextArea
						className="NodeField-textarea"
						mono
						rows={4}
						value={node.text}
						placeholder="Paste a table: CSV, TSV, JSON array, or Markdown"
						onChange={(text) => set({ text })}
					/>
				</>
			)}
			{table ? (
				<>
					<div className="NodeHint Profile-hint">
						<span>
							{table.rows.length} row{table.rows.length === 1 ? '' : 's'} × {table.headers.length} column
							{table.headers.length === 1 ? '' : 's'} · {fileSize}
						</span>
						<FieldMax title="Open the full profile table" onClick={() => setTableOpen(true)} />
					</div>
					<div className="Profile-list NodeScroll" onPointerDown={stopEvent}>
						{columns.map((column) => (
							<ProfileColumnRow key={column.name} column={column} table={table} />
						))}
					</div>
					{tableOpen && (
						<TableZoom
							title="Profile"
							columns={profileAsTable.headers}
							rows={profileAsTable.rows}
							onClose={() => setTableOpen(false)}
						/>
					)}
				</>
			) : (
				<UiEmpty text={dataWired ? `No table from ${sourceTitle ?? 'the wired card'}` : 'Give this card a table to profile'} />
			)}
		</>
	)
}
