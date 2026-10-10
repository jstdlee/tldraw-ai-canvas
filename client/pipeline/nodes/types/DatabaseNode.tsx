import { useRef, useState } from 'react'
import { T, useEditor } from 'tldraw'
import { categoryOf } from '../../../../shared/nodeGroups'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_ROW_HEIGHT_PX } from '../../constants'
import { startExecution } from '../../execution/executionState'
import { ShapePort } from '../../ports/Port'
import { storeFile, loadFileBytes } from '../../fileStore'
import { describeTables, openDatabase, runSqlCsv, schemaText, type SqlTableInfo } from '../../sqlJs'
import { NodeShape } from '../NodeShapeUtil'
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

function end(id: string, row: number): ShapePort {
	return { id, x: 0, y: BASE + NODE_ROW_HEIGHT_PX * (row + 0.5), terminal: 'end', dataType: 'text' }
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
})

function tablesList(node: DatabaseNode): SqlTableInfo[] {
	if (!node.tables) return []
	try {
		return JSON.parse(node.tables) as SqlTableInfo[]
	} catch {
		return []
	}
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
	getBodyHeightPx(_shape: NodeShape, node: DatabaseNode) {
		const tables = tablesList(node)
		const tablesRows = Math.min(6, Math.max(1, tables.length))
		// Rows: upload button, tables panel, sql editor (5 rows), hint = roughly 2 + tablesRows + 5 + 1, plus preview.
		return NODE_ROW_HEIGHT_PX * (2 + tablesRows + (node.error ? 1 : 0)) + 100 + 240
	}
	getPorts(shape: NodeShape, node: DatabaseNode): Record<string, ShapePort> {
		const width = this.getWidthPx(shape, node)
		return { sql: end('sql', 0), output: out('output', 0, width), schema: out('schema', 1, width) }
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
				<div className="NodeScroll" style={{ maxHeight: NODE_ROW_HEIGHT_PX * 6, overflowY: 'auto' }} onPointerDown={stopEvent}>
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
					<UiTextArea
						className="NodeField-textarea"
						mono
						rows={5}
						value={node.sql}
						placeholder="SELECT * FROM ..."
						onChange={(sql) => set({ sql })}
						onKeyDown={(e) => {
							if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
								runNow()
							}
						}}
					/>
				</>
			)}
			<div className="NodeHint">Changes stay in memory; the file is not modified.</div>
			{node.error && (
				<NodeRow>
					<span className="NodeStatus is-error">{node.error}</span>
				</NodeRow>
			)}
			{preview ? (
				<>
					<UiTable columns={preview.headers} rows={preview.rows} maxRows={50} />
					<div className="NodeHint">{node.lastInfo}</div>
				</>
			) : (
				<UiEmpty text="Press Run to see the result" />
			)}
		</>
	)
}
