import { useEffect, useMemo, useRef, useState } from 'react'
import { categoryOf } from '../../../../shared/nodeGroups'
import { chartOption, resolveColumns } from '../../../../shared/chartOption'
import { detectFormat, evalFormula, formatTable, opSpec, parseTable, runTable, splitList, TABLE_OPS } from '../../../../shared/tableOps'
import type { TableJob } from '../../../../shared/tableOps'
import { profileTable } from '../../../../shared/profile'
import type { ColumnProfile } from '../../../../shared/profile'
import { createShapeId, Editor, TLShapeId, T, useEditor, useValue } from 'tldraw'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_WIDTH_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { createOrUpdateConnectionBinding } from '../../connection/ConnectionBindingUtil'
import { getNextConnectionIndex } from '../../connection/keepConnectionsAtBottom'
import { createNodeAt } from '../../placeNode'
import { readSpreadsheet } from '../../excel'
import { storeFile, loadFileBytes } from '../../fileStore'
import { sleep } from '../../utils/sleep'
import { getNodeInputPortValues, isInputWired } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import {
	UiButton,
	UiCheckbox,
	UiChip,
	UiEmpty,
	UiField,
	UiIconButton,
	UiSegmented,
	UiSelect,
	UiTable,
	UiTextArea,
	UiTextInput,
} from '../../../ui'
import { IconChevronDown, IconChevronRight, IconClose, IconGroup, IconPlus, IconTable, IconUpload } from '../../../ui/icons'
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
			text: SAMPLE,
			format: 'auto',
			op: 'select',
			columns: 'name,score',
			column: 'score',
			as: 'number',
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
		const text = getInputText(inputs, 'data') || node.text
		const extra = getInputText(inputs, 'extra')
		const job: TableJob = { ...node, extra }
		try {
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
	const inputRef = useRef<HTMLInputElement>(null)
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
			<WireField shapeId={shapeId} fieldKey={fieldKey} label={label} hint={hint}>
				<UiTextInput ref={inputRef} mono value={value} onChange={onChange} placeholder="e.g. upper(name), round(score * 1.2, 1)" />
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
	// 'regex' renders as a mono text input.
	return (
		<WireField shapeId={shapeId} fieldKey={param.field} label={param.label} hint={param.hint}>
			<UiTextInput mono value={value} onChange={onChange} placeholder={param.placeholder} />
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

	const effectiveText = useValue(
		'datapipe input text',
		() => {
			const wired = getNodeInputPortValues(editor, shape.id).data?.value
			if (typeof wired === 'string' && wired.trim()) return wired
			return node.text
		},
		[editor, shape.id, node.text]
	)
	const inputTable = useMemo(() => {
		try {
			return parseTable(effectiveText, 'auto')
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
			return parseTable(node.lastOutput, 'auto')
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
			{dataWired ? (
				<PortRow shapeId={shape.id} portId="data" label="Input" dataType="text" />
			) : (
				<NodeRow>
					<span className="NodePortLabel">Input</span>
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
				<UiSelect value={node.op} options={OP_OPTIONS} onChange={(op) => set({ op })} />
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
					<UiTable columns={preview.headers} rows={preview.rows} maxRows={50} />
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
// Chart (unchanged behaviour; still reads a CSV/TSV table).
// ---------------------------------------------------------------------------

export type ChartNode = T.TypeOf<typeof ChartNode>
export const ChartNode = T.object({
	type: T.literal('chart'),
	text: T.string,
	format: T.string,
	kind: T.string,
	xCol: T.string,
	/** Comma-separated list of y columns; one series per column. */
	yCol: T.string,
	/** With 2+ y columns, plot the first on the left axis and the rest on the right. */
	dualScale: T.boolean,
	error: T.string.nullable(),
})

export class ChartNodeDefinition extends NodeDefinition<ChartNode> {
	static type = 'chart'
	static validator = ChartNode
	title = 'Chart'
	heading = 'Chart'
	icon = icon
	category = categoryOf('chart')
	resultKeys = ['error'] as const
	override showsOutput = true
	override defaultWidthPx = 440
	getDefault(): ChartNode {
		return { type: 'chart', text: SAMPLE, format: 'csv', kind: 'bar', xCol: 'name', yCol: 'score', dualScale: false, error: null }
	}
	getBodyHeightPx(shape: NodeShape) {
		// Rows: data port, text label (WP17), kind, x column, y columns, dual-axes = 6
		// (kind/x column split onto their own rows), then the chart area.
		return getNodeRowHeightPx(shape.props.fontSize) * 6 + 264
	}
	getPorts(shape: NodeShape, node: ChartNode): Record<string, ShapePort> {
		return { data: end('data', 0, getNodeRowHeightPx(shape.props.fontSize)), output: out(this.getWidthPx(shape, node)) }
	}
	async execute(shape: NodeShape, node: ChartNode, inputs: InputValues): Promise<ExecutionResult> {
		const text = getInputText(inputs, 'data') || node.text
		chartOption(text, node.format, node.kind, node.xCol, splitList(node.yCol), node.dualScale)
		updateNode<ChartNode>(this.editor, shape, (n) => ({ ...n, text, error: null }), false)
		return { output: text }
	}
	getOutputInfo(shape: NodeShape, node: ChartNode, inputs: InfoValues): InfoValues {
		return info(shape, node.text, inputs)
	}
	Component = ChartComponent
}

const icon = <span className="NodeShape-emoji">▦</span>

function ChartComponent({ shape, node }: NodeComponentProps<ChartNode>) {
	const editor = useEditor()
	const ref = useRef<HTMLDivElement>(null)
	const set = (patch: Partial<ChartNode>) => updateNode<ChartNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	// Prefer the wired table. The sample text on the node is only a fallback.
	const source = useValue(
		'chart source',
		() => {
			const value = getNodeInputPortValues(editor, shape.id).data?.value
			if (typeof value === 'string' && value.trim()) return value
			return node.text
		},
		[editor, shape.id, node.text]
	)
	const table = useMemo(() => {
		try {
			return parseTable(source, node.format)
		} catch {
			return { headers: [] as string[], rows: [] as string[][] }
		}
	}, [source, node.format])
	const columns = resolveColumns(table, node.xCol, splitList(node.yCol))
	const ySelected = splitList(node.yCol)
	// First render with this data (or new columns): snap the stored columns to real headers.
	useEffect(() => {
		if (table.headers.length === 0) return
		const patch: Partial<ChartNode> = {}
		if (columns.xCol !== node.xCol) patch.xCol = columns.xCol
		const joined = columns.yCols.join(',')
		if (joined !== node.yCol) patch.yCol = joined
		if (Object.keys(patch).length > 0) set(patch)
	}, [table, node.xCol, node.yCol])
	useEffect(() => {
		const host = ref.current
		if (!host) return
		let dead = false
		let observer: ResizeObserver | null = null
		let chart: { dispose: () => void; setOption: (option: object) => void; resize: () => void } | null = null
		void import('echarts').then((mod) => {
			if (dead) return
			chart = mod.init(host)
			try {
				chart.setOption(chartOption(source, node.format, node.kind, node.xCol, splitList(node.yCol), node.dualScale))
			} catch (error) {
				set({ error: (error as Error).message })
			}
			chart.resize()
			// The card can be resized or change its text size. The chart follows the area it has.
			observer = new ResizeObserver(() => chart?.resize())
			observer.observe(host)
		})
		return () => {
			dead = true
			observer?.disconnect()
			chart?.dispose()
		}
	}, [source, node.format, node.kind, node.xCol, node.yCol, node.dualScale])
	return (
		<div className="ChartNode">
			<PortRow shapeId={shape.id} portId="data" label="Table" dataType="text" />
			<WireFieldHeader shapeId={shape.id} fieldKey="text" label="Text" />
			<WireField shapeId={shape.id} fieldKey="kind" label="Kind">
				<NodeSelect className="NodeField-select" value={node.kind} onPointerDown={stopEvent} onChange={(e) => set({ kind: e.target.value })}>
					<option value="bar">Bar</option>
					<option value="line">Line</option>
					<option value="pie">Pie</option>
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
					options={table.headers.map((header) => ({
						value: header,
						label: header,
						disabled: header === columns.xCol,
					}))}
					onChange={(next) => set({ yCol: next.filter((col) => col !== columns.xCol).join(',') })}
				/>
			</WireField>
			<WireField shapeId={shape.id} fieldKey="dualScale" label="Dual axis">
				<UiCheckbox
					checked={!!node.dualScale}
					title="First y column on the left axis, the rest on the right"
					label="Dual y-axes"
					onChange={(dualScale) => set({ dualScale })}
				/>
			</WireField>
			<div ref={ref} className="ChartNode-view" />
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
		return { type: 'profile', text: SAMPLE, format: 'auto', error: null, lastOutput: null }
	}
	getBodyHeightPx(shape: NodeShape) {
		// Header row (data port) + the format row + the header line + a scrollable column list.
		return getNodeRowHeightPx(shape.props.fontSize) * 3 + 360
	}
	getPorts(shape: NodeShape, node: ProfileNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return { data: end('data', 0, rowPx), output: out(this.getWidthPx(shape, node)) }
	}
	async execute(shape: NodeShape, node: ProfileNode, inputs: InputValues): Promise<ExecutionResult> {
		const text = getInputText(inputs, 'data') || node.text
		try {
			const table = parseTable(text, detectFormat(text, node.format))
			const profiles = profileTable(table)
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
			const output = formatTable({ headers, rows }, 'csv')
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
	const effectiveText = useValue(
		'profile input text',
		() => {
			const wired = getNodeInputPortValues(editor, shape.id).data?.value
			if (typeof wired === 'string' && wired.trim()) return wired
			return node.text
		},
		[editor, shape.id, node.text]
	)
	const table = useMemo(() => {
		try {
			return parseTable(effectiveText, detectFormat(effectiveText, node.format))
		} catch {
			return null
		}
	}, [effectiveText, node.format])
	const columns = useMemo(() => (table ? profileTable(table) : []), [table])
	const fileSize = useMemo(() => formatFileSize(new TextEncoder().encode(effectiveText).length), [effectiveText])
	return (
		<>
			{dataWired ? (
				<PortRow shapeId={shape.id} portId="data" label="Table" dataType="text" />
			) : (
				<WireFieldHeader shapeId={shape.id} fieldKey="text" label="Table" />
			)}
			{!dataWired && (
				<UiTextArea className="NodeField-textarea" mono rows={4} value={node.text} onChange={(text) => set({ text })} />
			)}
			<WireField shapeId={shape.id} fieldKey="format" label="Format">
				<UiSelect
					value={node.format}
					options={[
						{ value: 'auto', label: 'Auto' },
						{ value: 'csv', label: 'CSV' },
						{ value: 'tsv', label: 'TSV' },
					]}
					onChange={(format) => set({ format })}
				/>
			</WireField>
			{table ? (
				<>
					<div className="NodeHint">
						{table.rows.length} row{table.rows.length === 1 ? '' : 's'} × {table.headers.length} column
						{table.headers.length === 1 ? '' : 's'} · {fileSize}
					</div>
					<div className="Profile-list NodeScroll" onPointerDown={stopEvent}>
						{columns.map((column) => (
							<ProfileColumnRow key={column.name} column={column} table={table} />
						))}
					</div>
				</>
			) : (
				<UiEmpty text="Give this card a table to profile" />
			)}
		</>
	)
}
