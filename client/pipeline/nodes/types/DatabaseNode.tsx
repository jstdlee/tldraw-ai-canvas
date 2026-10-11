import { useRef, useState } from 'react'
import { T, useEditor } from 'tldraw'
import { categoryOf } from '../../../../shared/nodeGroups'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX } from '../../constants'
import { startExecution } from '../../execution/executionState'
import { ShapePort } from '../../ports/Port'
import { storeFile, loadFileBytes } from '../../fileStore'
import { describeTables, openDatabase, runSqlCsv, schemaText, type SqlTableInfo } from '../../sqlJs'
import { NodeShape } from '../NodeShapeUtil'
import { getNodeInputPortValues, isInputWired } from '../nodePorts'
import { UiButton, UiEmpty, UiTable, UiTextArea } from '../../../ui'
import { IconDatabase, IconTable, IconUpload } from '../../../ui/icons'
import { PortRow, stopEvent, useInputConnected } from './fields'
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
function out(id: string, index: number, width: number): ShapePort {
	return { id, x: width, y: NODE_HEADER_HEIGHT_PX / 2 + index * 20, terminal: 'start', dataType: 'text' }
}

// One opened sql.js Database per fileUrl, so re-running a query does not re-parse the file.
const openDbs = new Map<string, Promise<import('sql.js').Database>>()

function getOpenDb(fileUrl: string): Promise<import('sql.js').Database> {
	let opening = openDbs.get(fileUrl)
	if (!opening) {
		opening = loadFileBytes(fileUrl).then((bytes) => openDatabase(bytes))
		openDbs.set(fileUrl, opening)
	}
	return opening
}

export type DatabaseNode = T.TypeOf<typeof DatabaseNode>
export const DatabaseNode = T.object({
	type: T.literal('database'),
	fileUrl: T.string,
	fileName: T.string,
	fileSize: T.number,
	sql: T.string,
	/** JSON list of { name, columns, rows } from the last open. */
	tables: T.string,
	lastOutput: T.string.nullable(),
	lastInfo: T.string,
	error: T.string.nullable(),
	/** SQL editor height, in lines. Default 5; the results area grows to fill the rest. */
	editorRows: T.number.optional(),
})

const SQL_EDITOR_DEFAULT_LINES = 5
const SQL_EDITOR_MIN_LINES = 3
const SQL_EDITOR_MAX_LINES = 20
/** Approximate px per line of the mono SQL editor at the card's default font. */
const SQL_LINE_PX = 19
const SQL_EDITOR_PADDING_PX = 16
const DRAG_HANDLE_PX = 10
const RESULTS_DEFAULT_PX = 220

function editorHeightPx(node: DatabaseNode) {
	return (node.editorRows ?? SQL_EDITOR_DEFAULT_LINES) * SQL_LINE_PX + SQL_EDITOR_PADDING_PX
}

function tablesList(node: DatabaseNode): SqlTableInfo[] {
	if (!node.tables) return []
	try {
		return JSON.parse(node.tables) as SqlTableInfo[]
	} catch {
		return []
	}
}

/** Where DatabaseNode's rows land, so ports and body height agree with the rendered rows. */
function layout(node: DatabaseNode, sqlWired: boolean) {
	const tables = tablesList(node)
	const tablesRows = tables.length > 0 ? Math.min(6, tables.length) : 0
	let row = 0
	const uploadRow = row++
	const tablesRow = tablesRows > 0 ? row : null
	row += tablesRows
	const sqlRow = row++
	// The editor + its drag handle only render when the port is not wired.
	const sqlExtraPx = sqlWired ? 0 : editorHeightPx(node) + DRAG_HANDLE_PX
	const hintRow = row++
	return { uploadRow, tablesRow, tablesRows, sqlRow, sqlExtraPx, hintRow, rowsCount: row }
}

export class DatabaseNodeDefinition extends NodeDefinition<DatabaseNode> {
	static type = 'database'
	static validator = DatabaseNode
	title = 'Database'
	heading = 'Database'
	icon = <IconDatabase />
	category = categoryOf('database')
	override showsOutput = true
	override defaultWidthPx = 480
	getDefault(): DatabaseNode {
		return { type: 'database', fileUrl: '', fileName: '', fileSize: 0, sql: '', tables: '', lastOutput: null, lastInfo: '', error: null }
	}
	getBodyHeightPx(shape: NodeShape, node: DatabaseNode) {
		const sqlWired = isInputWired(this.editor, shape.id, 'sql')
		const { rowsCount, sqlExtraPx } = layout(node, sqlWired)
		// Rows: upload button, tables panel, SQL row, hint row, then the results area, which
		// grows to fill whatever space the card is resized to.
		return getNodeRowHeightPx(shape.props.fontSize) * rowsCount + sqlExtraPx + RESULTS_DEFAULT_PX
	}
	getPorts(shape: NodeShape, node: DatabaseNode): Record<string, ShapePort> {
		const sqlWired = isInputWired(this.editor, shape.id, 'sql')
		const { sqlRow } = layout(node, sqlWired)
		const width = this.getWidthPx(shape, node)
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return { sql: end('sql', sqlRow, rowPx), output: out('output', 0, width), schema: out('schema', 1, width) }
	}
	async execute(shape: NodeShape, node: DatabaseNode, inputs: InputValues): Promise<ExecutionResult> {
		try {
			if (!node.fileUrl) throw new Error('Upload a .sqlite or .db file first')
			const sql = getInputText(inputs, 'sql') || node.sql
			if (!sql.trim()) throw new Error('Type a SQL query, or pick a table above')
			const db = await getOpenDb(node.fileUrl)
			const output = runSqlCsv(db, sql)
			const schema = schemaText(db)
			const rows = output.includes('\n') ? output.split('\n').length - 1 : output ? 0 : 0
			const cols = output.split('\n')[0]?.split(',').length ?? 0
			updateNode<DatabaseNode>(
				this.editor,
				shape,
				(n) => ({ ...n, error: null, lastOutput: output.slice(0, 200_000), lastInfo: `${rows} row${rows === 1 ? '' : 's'} × ${cols} column${cols === 1 ? '' : 's'}` }),
				false
			)
			return { output, schema }
		} catch (error) {
			updateNode<DatabaseNode>(this.editor, shape, (n) => ({ ...n, error: (error as Error).message }), false)
			throw error
		}
	}
	getOutputInfo(shape: NodeShape, node: DatabaseNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		return {
			output: { value: node.lastOutput ?? null, isOutOfDate, dataType: 'text' },
			schema: { value: null, isOutOfDate, dataType: 'text' },
		}
	}
	Component = DatabaseComponent
}

function parseCsvPreview(csv: string): { headers: string[]; rows: string[][] } {
	const lines = csv.split('\n').filter((l) => l.length)
	if (!lines.length) return { headers: [], rows: [] }
	const headers = lines[0].split(',')
	const rows = lines.slice(1, 51).map((line) => line.split(','))
	return { headers, rows }
}

function DatabaseComponent({ shape, node }: NodeComponentProps<DatabaseNode>) {
	const editor = useEditor()
	const fileRef = useRef<HTMLInputElement>(null)
	const [busy, setBusy] = useState(false)
	const sqlWired = useInputConnected(shape.id, 'sql')
	const set = (patch: Partial<DatabaseNode>) => updateNode<DatabaseNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const tables = tablesList(node)

	const openFile = async (file: File) => {
		setBusy(true)
		try {
			const stored = await storeFile(file)
			const bytes = await loadFileBytes(stored.url)
			const db = await openDatabase(bytes)
			openDbs.set(stored.url, Promise.resolve(db))
			const tableInfo = describeTables(db)
			set({
				fileUrl: stored.url,
				fileName: file.name,
				fileSize: file.size,
				tables: JSON.stringify(tableInfo),
				error: null,
			})
		} catch (error) {
			set({ error: (error as Error).message })
		} finally {
			setBusy(false)
			if (fileRef.current) fileRef.current.value = ''
		}
	}

	const runNow = () => startExecution(editor, new Set([shape.id]))

	const pickTable = (name: string) => {
		set({ sql: `SELECT * FROM "${name}" LIMIT 100;` })
		// Run after the SQL update is in the store, so the run reads the new query.
		editor.timers.setTimeout(runNow, 0)
	}

	const preview = node.lastOutput ? parseCsvPreview(node.lastOutput) : null

	return (
		<>
			<NodeRow>
				<input
					ref={fileRef}
					type="file"
					accept=".sqlite,.sqlite3,.db"
					style={{ display: 'none' }}
					onChange={(e) => {
						const file = e.currentTarget.files?.[0]
						if (file) void openFile(file)
					}}
				/>
				<UiButton
					size="sm"
					variant="low"
					icon={<IconUpload />}
					disabled={busy}
					label={busy ? 'Opening…' : node.fileName || 'Upload .sqlite / .db'}
					onClick={() => fileRef.current?.click()}
				/>
			</NodeRow>
			{tables.length > 0 && (
				<div className="NodeScroll" style={{ maxHeight: getNodeRowHeightPx(shape.props.fontSize) * 6, overflowY: 'auto' }} onPointerDown={stopEvent}>
					{tables.map((t) => (
						<NodeRow key={t.name} className="DatabaseNode-table" onClick={() => pickTable(t.name)}>
							<IconTable size={14} />
							<span title={t.columns.join(', ')}>{t.name}</span>
							<span className="NodeHint">{t.rows.toLocaleString()} {t.rows === 1 ? 'row' : 'rows'}</span>
						</NodeRow>
					))}
				</div>
			)}
			{sqlWired ? (
				<PortRow shapeId={shape.id} portId="sql" label="SQL" dataType="text" />
			) : (
				<>
					<PortRow shapeId={shape.id} portId="sql" label="SQL" dataType="text" hint="optional: overrides the editor below" />
					<div className="NodeField-block" style={{ height: editorHeightPx(node) }}>
						<UiTextArea
							className="NodeField-textarea"
							grow
							mono
							value={node.sql}
							placeholder="SELECT * FROM ..."
							onChange={(sql) => set({ sql })}
							onKeyDown={(e) => {
								if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
									runNow()
								}
							}}
						/>
					</div>
					<SqlEditorDragHandle node={node} set={set} />
				</>
			)}
			<div className="NodeHint">Changes stay in memory; the file is not modified.</div>
			<div className="NodeGrow DatabaseNode-results" onPointerDown={stopEvent}>
				{preview ? (
					<>
						<UiTable columns={preview.headers} rows={preview.rows} maxRows={50} />
						<div className="NodeHint">{node.lastInfo}</div>
					</>
				) : (
					<UiEmpty text="Press Run to see the result" />
				)}
			</div>
		</>
	)
}

/** A thin drag handle below the SQL editor; drag up/down to resize it (5 lines by default). */
function SqlEditorDragHandle({
	node,
	set,
}: {
	node: DatabaseNode
	set: (patch: Partial<DatabaseNode>) => void
}) {
	const editor = useEditor()
	const dragRef = useRef<{ startY: number; startLines: number } | null>(null)
	return (
		<div
			className="DatabaseNode-dragHandle"
			title="Drag to resize the SQL editor"
			onPointerDown={(e) => {
				e.stopPropagation()
				e.currentTarget.setPointerCapture(e.pointerId)
				dragRef.current = { startY: e.clientY, startLines: node.editorRows ?? SQL_EDITOR_DEFAULT_LINES }
			}}
			onPointerMove={(e) => {
				const drag = dragRef.current
				if (!drag) return
				const zoom = editor.getZoomLevel()
				const deltaLines = Math.round((e.clientY - drag.startY) / zoom / SQL_LINE_PX)
				const next = Math.max(SQL_EDITOR_MIN_LINES, Math.min(SQL_EDITOR_MAX_LINES, drag.startLines + deltaLines))
				if (next !== (node.editorRows ?? SQL_EDITOR_DEFAULT_LINES)) set({ editorRows: next })
			}}
			onPointerUp={(e) => {
				dragRef.current = null
				e.currentTarget.releasePointerCapture(e.pointerId)
			}}
		>
			<span />
		</div>
	)
}
