import { useEffect, useMemo, useRef, useState } from 'react'
import { categoryOf } from '../../../../shared/nodeGroups'
import { chartOption, resolveColumns } from '../../../../shared/chartOption'
import { opSpec, parseTable, runTable, splitList, TABLE_OPS } from '../../../../shared/tableOps'
import type { TableJob } from '../../../../shared/tableOps'
import { createShapeId, Editor, TLShapeId, T, useEditor, useValue } from 'tldraw'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_ROW_HEIGHT_PX, NODE_WIDTH_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { createOrUpdateConnectionBinding } from '../../connection/ConnectionBindingUtil'
import { getNextConnectionIndex } from '../../connection/keepConnectionsAtBottom'
import { createNodeAt } from '../../placeNode'
import { readSpreadsheet } from '../../excel'
import { storeFile, loadFileBytes } from '../../fileStore'
import { sleep } from '../../utils/sleep'
import { getNodeInputPortValues, isInputWired } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import { UiButton, UiCheckbox, UiEmpty, UiField, UiSegmented, UiSelect, UiTable, UiTextArea, UiTextInput } from '../../../ui'
import { IconPlus, IconTable, IconUpload } from '../../../ui/icons'
import { NodeMultiSelect, PortRow, stopEvent, NodeSelect, useInputConnected } from './fields'
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

function end(id: string, row: number): ShapePort {
	return { id, x: 0, y: BASE + NODE_ROW_HEIGHT_PX * (row + 0.5), terminal: 'end', dataType: 'text' }
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
		}
	}
	getBodyHeightPx(shape: NodeShape, node: TableNode) {
		const dataWired = isInputWired(this.editor, shape.id, 'data')
		const { rowsCount } = layout(node, dataWired)
		// The inline textarea only renders when the data port is not wired (same condition as the component).
		const inlineExtra = !dataWired && (node.source ?? 'inline') === 'inline' ? 90 : 0
		const descriptionExtra = 20
		// A real preview table needs room to show rows; the empty placeholder is much shorter.
		const previewExtra = node.lastOutput ? 240 : 64
		return NODE_ROW_HEIGHT_PX * rowsCount + inlineExtra + descriptionExtra + previewExtra
	}
	getPorts(shape: NodeShape, node: TableNode): Record<string, ShapePort> {
		const dataWired = isInputWired(this.editor, shape.id, 'data')
		const { dataRow, secondRow } = layout(node, dataWired)
		return {
			data: end('data', dataRow),
			extra: end('extra', secondRow ?? dataRow),
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

/** A column picker backed by the input table's real headers, falling back to free text. */
function ColumnField({
	label,
	value,
	headers,
	onChange,
}: {
	label: string
	value: string
	headers: string[]
	onChange: (value: string) => void
}) {
	if (!headers.length) {
		return (
			<UiField label={label}>
				<UiTextInput value={value} onChange={onChange} placeholder="column name" />
			</UiField>
		)
	}
	return (
		<UiField label={label}>
			<UiSelect
				value={value}
				placeholder="Choose a column"
				options={headers.map((h) => ({ value: h, label: h }))}
				onChange={onChange}
			/>
		</UiField>
	)
}

function ColumnsField({
	label,
	value,
	headers,
	onChange,
}: {
	label: string
	value: string
	headers: string[]
	onChange: (value: string) => void
}) {
	if (!headers.length) {
		return (
			<UiField label={label}>
				<UiTextInput value={value} onChange={onChange} placeholder="a, b, c" />
			</UiField>
		)
	}
	return (
		<UiField label={label}>
			<NodeMultiSelect
				emptyLabel="Choose columns"
				values={splitList(value).filter((v) => headers.includes(v))}
				options={headers.map((h) => ({ value: h, label: h }))}
				onChange={(next) => onChange(next.join(','))}
			/>
		</UiField>
	)
}

function ParamField({
	param,
	node,
	headers,
	set,
}: {
	param: ReturnType<typeof layout>['params'][number]
	node: TableNode
	headers: string[]
	set: (patch: Partial<TableNode>) => void
}) {
	const value = (node as unknown as Record<string, string>)[param.field] ?? ''
	const onChange = (next: string) => set({ [param.field]: next } as Partial<TableNode>)
	if (param.kind === 'column') return <ColumnField label={param.label} value={value} headers={headers} onChange={onChange} />
	if (param.kind === 'columns') return <ColumnsField label={param.label} value={value} headers={headers} onChange={onChange} />
	if (param.kind === 'enum') {
		return (
			<UiField label={param.label} hint={param.hint}>
				<UiSelect value={value || param.options?.[0]?.value || ''} options={param.options ?? []} onChange={onChange} />
			</UiField>
		)
	}
	if (param.kind === 'number') {
		return (
			<UiField label={param.label} hint={param.hint}>
				<UiTextInput value={value} onChange={onChange} inputMode="decimal" placeholder={param.placeholder} />
			</UiField>
		)
	}
	// 'formula' and 'regex' both render as a mono text input.
	return (
		<UiField label={param.label} hint={param.hint}>
			<UiTextInput mono value={value} onChange={onChange} placeholder={param.placeholder} />
		</UiField>
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
	const headers = useMemo(() => {
		try {
			return parseTable(effectiveText, 'auto').headers
		} catch {
			return []
		}
	}, [effectiveText])

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

	const addStep = () => {
		editor.run(() => {
			const nextShapeId = createNodeAt(
				editor,
				{
					type: 'table',
					...TableDefaultForChain(),
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
				<ParamField key={param.field} param={param} node={node} headers={headers} set={set} />
			))}
			{spec.second && (
				<PortRow shapeId={shape.id} portId="extra" label={spec.second.label} dataType="text" hint={spec.second.hint} />
			)}
			{preview ? (
				<>
					<UiTable columns={preview.headers} rows={preview.rows} maxRows={50} />
					<div className="NodeHint">{node.lastInfo}</div>
				</>
			) : (
				<UiEmpty text="Press Run to see the result" />
			)}
			<NodeRow>
				<UiButton size="sm" variant="low" icon={<IconPlus />} label="Add next step" onClick={addStep} />
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
	override showsOutput = true
	override defaultWidthPx = 440
	getDefault(): ChartNode {
		return { type: 'chart', text: SAMPLE, format: 'csv', kind: 'bar', xCol: 'name', yCol: 'score', dualScale: false, error: null }
	}
	getBodyHeightPx() {
		// Rows: data port, kind/x column, y columns, dual-axes = 4, then the chart area.
		return NODE_ROW_HEIGHT_PX * 4 + 264
	}
	getPorts(shape: NodeShape, node: ChartNode): Record<string, ShapePort> {
		return { data: end('data', 0), output: out(this.getWidthPx(shape, node)) }
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
			<NodeRow>
				<NodeSelect className="NodeField-select" value={node.kind} onPointerDown={stopEvent} onChange={(e) => set({ kind: e.target.value })}>
					<option value="bar">Bar</option>
					<option value="line">Line</option>
					<option value="pie">Pie</option>
				</NodeSelect>
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
			</NodeRow>
			<NodeRow>
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
			</NodeRow>
			<NodeRow>
				<UiCheckbox
					checked={!!node.dualScale}
					title="First y column on the left axis, the rest on the right"
					label="Dual y-axes"
					onChange={(dualScale) => set({ dualScale })}
				/>
			</NodeRow>
			<div ref={ref} className="ChartNode-view" />
		</div>
	)
}
