import { useEffect, useRef, useState } from 'react'
import { sqliteFileToPgStatements } from '../../sqliteWasm'
import { categoryOf } from '../../../../shared/nodeGroups'
import { chartOption } from '../../../../shared/chartOption'
import { runTable, TableJob } from '../../../../shared/tableOps'
import { T, useEditor } from 'tldraw'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_ROW_HEIGHT_PX, NODE_WIDTH_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { runSql } from '../../pg'
import { sleep } from '../../utils/sleep'
import { NodeShape } from '../NodeShapeUtil'
import { PortRow, stopEvent } from './fields'
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

const icon = <span className="NodeShape-emoji">▦</span>
const BASE = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX

function end(id: string, row: number): ShapePort {
	return { id, x: 0, y: BASE + NODE_ROW_HEIGHT_PX * (row + 0.5), terminal: 'end', dataType: 'text' }
}
function out(): ShapePort {
	return { id: 'output', x: NODE_WIDTH_PX, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' }
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
})

const OPS = ['select', 'convert', 'formula', 'concat', 'replace', 'join', 'regexp', 'newcol', 'groupby', 'pivot', 'dedupe', 'sort'] as const

export class TableNodeDefinition extends NodeDefinition<TableNode> {
	static type = 'table'
	static validator = TableNode
	title = 'Table'
	heading = 'Table'
	icon = icon
	category = categoryOf('table')
	getDefault(): TableNode {
		return {
			type: 'table',
			text: SAMPLE,
			format: 'csv',
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
		}
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 8
	}
	getPorts(): Record<string, ShapePort> {
		return { data: end('data', 0), extra: end('extra', 1), output: out() }
	}
	async execute(shape: NodeShape, node: TableNode, inputs: InputValues): Promise<ExecutionResult> {
		await sleep(30)
		const text = getInputText(inputs, 'data') || node.text
		const job: TableJob = { ...node, extra: getInputText(inputs, 'extra') }
		try {
			const output = runTable(text, job)
			updateNode<TableNode>(this.editor, shape, (n) => ({ ...n, error: null }), false)
			return { output }
		} catch (error) {
			updateNode<TableNode>(this.editor, shape, (n) => ({ ...n, error: (error as Error).message }), false)
			throw error
		}
	}
	getOutputInfo(shape: NodeShape, _node: TableNode, inputs: InfoValues): InfoValues {
		return info(shape, null, inputs)
	}
	Component = TableComponent
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
	return (
		<NodeRow>
			<span className="NodeInputRow-label">{label}</span>
			<input className="NodeField-input" value={value} onPointerDown={stopEvent} onKeyDown={stopEvent} onChange={(e) => onChange(e.target.value)} />
		</NodeRow>
	)
}

function TableComponent({ shape, node }: NodeComponentProps<TableNode>) {
	const editor = useEditor()
	const set = (patch: Partial<TableNode>) => updateNode<TableNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	return (
		<>
			<PortRow shapeId={shape.id} portId="data" label="CSV / TSV" dataType="text" />
			<PortRow shapeId={shape.id} portId="extra" label="New values" dataType="text" hint="one line per row" />
			<NodeRow>
				<select className="NodeField-select" value={node.format} onPointerDown={stopEvent} onChange={(e) => set({ format: e.target.value })}>
					<option value="csv">CSV</option>
					<option value="tsv">TSV</option>
				</select>
				<select className="NodeField-select" value={node.op} onPointerDown={stopEvent} onChange={(e) => set({ op: e.target.value })}>
					{OPS.map((op) => (
						<option key={op} value={op}>
							{op}
						</option>
					))}
				</select>
			</NodeRow>
			<Field label="Columns" value={node.columns} onChange={(columns) => set({ columns })} />
			<Field label="Column" value={node.column} onChange={(column) => set({ column })} />
			<Field label="As / expr" value={node.op === 'formula' || node.op === 'newcol' ? node.expr : node.as} onChange={(value) => set(node.op === 'formula' || node.op === 'newcol' ? { expr: value } : { as: value })} />
			<Field label="Pattern" value={node.pattern} onChange={(pattern) => set({ pattern })} />
			<Field label="With / sep" value={node.op === 'replace' ? node.with : node.sep} onChange={(value) => set(node.op === 'replace' ? { with: value } : { sep: value })} />
			<Field label="New name" value={node.name} onChange={(name) => set({ name })} />
			{node.error && <NodeRow><span className="NodeStatus is-error">{node.error}</span></NodeRow>}
		</>
	)
}

export type ChartNode = T.TypeOf<typeof ChartNode>
export const ChartNode = T.object({
	type: T.literal('chart'),
	text: T.string,
	format: T.string,
	kind: T.string,
	xCol: T.string,
	yCol: T.string,
	error: T.string.nullable(),
})

export class ChartNodeDefinition extends NodeDefinition<ChartNode> {
	static type = 'chart'
	static validator = ChartNode
	title = 'Chart'
	heading = 'Chart'
	icon = icon
	category = categoryOf('chart')
	getDefault(): ChartNode {
		return { type: 'chart', text: SAMPLE, format: 'csv', kind: 'bar', xCol: 'name', yCol: 'score', error: null }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 3 + 220
	}
	getPorts(): Record<string, ShapePort> {
		return { data: end('data', 0), output: out() }
	}
	async execute(shape: NodeShape, node: ChartNode, inputs: InputValues): Promise<ExecutionResult> {
		const text = getInputText(inputs, 'data') || node.text
		chartOption(text, node.format, node.kind, node.xCol, node.yCol)
		updateNode<ChartNode>(this.editor, shape, (n) => ({ ...n, text, error: null }), false)
		return { output: text }
	}
	getOutputInfo(shape: NodeShape, node: ChartNode, inputs: InfoValues): InfoValues {
		return info(shape, node.text, inputs)
	}
	Component = ChartComponent
}

function ChartComponent({ shape, node }: NodeComponentProps<ChartNode>) {
	const editor = useEditor()
	const ref = useRef<HTMLDivElement>(null)
	const set = (patch: Partial<ChartNode>) => updateNode<ChartNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
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
				chart.setOption(chartOption(node.text, node.format, node.kind, node.xCol, node.yCol))
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
	}, [node.text, node.format, node.kind, node.xCol, node.yCol])
	return (
		<div className="ChartNode">
			<PortRow shapeId={shape.id} portId="data" label="Table" dataType="text" />
			<NodeRow>
				<select className="NodeField-select" value={node.kind} onPointerDown={stopEvent} onChange={(e) => set({ kind: e.target.value })}>
					<option value="bar">Bar</option>
					<option value="line">Line</option>
					<option value="pie">Pie</option>
				</select>
				<input className="NodeField-input" value={node.xCol} onPointerDown={stopEvent} onKeyDown={stopEvent} onChange={(e) => set({ xCol: e.target.value })} />
				<input className="NodeField-input" value={node.yCol} onPointerDown={stopEvent} onKeyDown={stopEvent} onChange={(e) => set({ yCol: e.target.value })} />
			</NodeRow>
			<div ref={ref} className="ChartNode-view" />
			{node.error && <span className="NodeStatus is-error">{node.error}</span>}
		</div>
	)
}

export type SqliteNode = T.TypeOf<typeof SqliteNode>
export const SqliteNode = T.object({
	type: T.literal('sqlite_in'),
	path: T.string,
	/** The converted Postgres (CREATE + INSERT) from the last imported file. Replayed on run. */
	imported: T.string,
	/** Summary of the last import, e.g. "3 tables, 1,204 rows". */
	importInfo: T.string,
	sql: T.string,
	ask: T.string,
	error: T.string.nullable(),
})

export class SqliteNodeDefinition extends NodeDefinition<SqliteNode> {
	static type = 'sqlite_in'
	static validator = SqliteNode
	title = 'SQLite import'
	heading = 'SQLite'
	icon = icon
	category = categoryOf('sqlite_in')
	getDefault(): SqliteNode {
		return { type: 'sqlite_in', path: '', imported: '', importInfo: '', sql: 'SELECT 1 AS ready;', ask: '', error: null }
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX * 5 + 96
	}
	getPorts(): Record<string, ShapePort> {
		return { input: end('input', 0), output: out() }
	}
	async execute(shape: NodeShape, node: SqliteNode, inputs: InputValues): Promise<ExecutionResult> {
		const extra = getInputText(inputs, 'input')
		let sql = node.sql
		if (extra) sql = sql.replaceAll('$input', extra.replace(/'/g, "''"))
		// The imported file's schema and rows load first, then the node's own query runs.
		const full = node.imported ? `${node.imported}\n${sql}` : sql
		const output = await runSql(full)
		updateNode<SqliteNode>(this.editor, shape, (n) => ({ ...n, error: null }), false)
		return { output }
	}
	getOutputInfo(shape: NodeShape, _node: SqliteNode, inputs: InfoValues): InfoValues {
		return info(shape, null, inputs)
	}
	Component = SqliteComponent
}

function SqliteComponent({ shape, node }: NodeComponentProps<SqliteNode>) {
	const editor = useEditor()
	const fileRef = useRef<HTMLInputElement>(null)
	const [busy, setBusy] = useState(false)
	const set = (patch: Partial<SqliteNode>) => updateNode<SqliteNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const ask = async () => {
		const { apiGenerateText } = await import('../../api/pipelineApi')
		const { text } = await apiGenerateText({
			temperature: 0.1,
			system: 'Write one SQLite-compatible SQL statement for PGlite. SQL only.',
			prompt: node.ask || 'Show the tables',
		})
		set({ sql: text.replace(/```sql|```/g, '').trim() })
	}
	const importFile = async (file: File) => {
		setBusy(true)
		try {
			const bytes = new Uint8Array(await file.arrayBuffer())
			const { tables, rows, statements } = await sqliteFileToPgStatements(bytes)
			set({ imported: statements.join('\n'), importInfo: `${tables} table${tables === 1 ? '' : 's'}, ${rows.toLocaleString()} rows`, path: file.name, error: null })
		} catch (e) {
			set({ error: (e as Error).message, imported: '', importInfo: '' })
		} finally {
			setBusy(false)
			if (fileRef.current) fileRef.current.value = ''
		}
	}
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label="Value" dataType="text" hint="replaces $input" />
			<NodeRow>
				<input
					ref={fileRef}
					type="file"
					accept=".sqlite,.sqlite3,.db"
					style={{ display: 'none' }}
					onChange={(e) => {
						const file = e.currentTarget.files?.[0]
						if (file) void importFile(file)
					}}
				/>
				<button type="button" className="NodeField-button" disabled={busy} onPointerDown={stopEvent} onClick={() => fileRef.current?.click()}>
					{busy ? 'Importing…' : node.imported ? `Re-import ${node.path || 'file'}` : 'Import .sqlite / .db file'}
				</button>
			</NodeRow>
			{node.importInfo && (
				<NodeRow>
					<span className="NodeHint">{node.importInfo} — replayed on every run.</span>
				</NodeRow>
			)}
			<Field label="Ask" value={node.ask} onChange={(ask) => set({ ask })} />
			<NodeRow>
				<button type="button" className="NodeField-button" onPointerDown={stopEvent} onClick={() => void ask()}>
					Ask AI for SQL
				</button>
			</NodeRow>
			<textarea className="NodeField-textarea" value={node.sql} onPointerDown={stopEvent} onKeyDown={stopEvent} onChange={(e) => set({ sql: e.target.value })} />
			{node.error && <span className="NodeStatus is-error">{node.error}</span>}
		</>
	)
}
