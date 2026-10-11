import { useMemo, useRef, useState } from 'react'
import { T, useEditor } from 'tldraw'
import { categoryOf } from '../../../../shared/nodeGroups'
import { DbConn, DuckDbConn, PostgresConn } from '../../../../shared/dbConn'
import { buildLoadPlan, LoadMode } from '../../../../shared/dbLoadRows'
import { DB_SOURCES, DbSourceId } from '../../../../shared/dbSources'
import { parseCsv } from '../../../../shared/pgImport'
import { summarizeScript } from '../../../../shared/sqlStatements'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX } from '../../constants'
import { currentRunSignal, startExecution } from '../../execution/executionState'
import { isAbortError } from '../../../../shared/abort'
import { ShapePort } from '../../ports/Port'
import { storeFile, loadFileBytes } from '../../fileStore'
import { describeTables, openDatabase, runSqlCsv, schemaText, type SqlTableInfo } from '../../sqlJs'
import { runSql as runPgliteSql } from '../../pg'
import { hiddenDedicatedPortIds, hiddenFieldKeys } from '../fieldVisibility'
import { NodeShape } from '../NodeShapeUtil'
import { isInputWired } from '../nodePorts'
import { UiButton, UiCheckbox, UiEmpty, UiSecretInput, UiSegmented, UiTable, UiTextArea, UiTextInput } from '../../../ui'
import { IconAlert, IconDatabase, IconTable, IconUpload } from '../../../ui/icons'
import { NodeSelect, PgliteMemoryWarning, PortRow, stopEvent, useInputConnected, WireField, WireFieldHeader } from './fields'
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

type DbSource = DbSourceId

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
	/** JSON list of { name, columns, rows } from the last open (SQLite source only). */
	tables: T.string,
	lastOutput: T.string.nullable(),
	lastInfo: T.string,
	error: T.string.nullable(),
	/** SQL editor height, in lines. Default 5; the results area grows to fill the rest. */
	editorRows: T.number.optional(),
	/** Which database this card talks to. Missing/old cards keep acting like 'sqlite'. */
	source: T.string.optional(),
	/** JSON `DbConn` (shared/dbConn.ts) for the postgres/duckdb sources. Never a raw password. */
	conn: T.string.optional(),
	/** JSON `SchemaTable[]` (server/db.ts) from the last Test connection / schema browse. */
	extTables: T.string.nullable().optional(),
	/** JSON `{ results, ms }` from the last /api/db/query run (postgres/duckdb only). */
	extResults: T.string.nullable().optional(),
	/** CREATE-TABLE-like text for the AI helpers, from the last schema browse. */
	lastSchemaText: T.string.nullable().optional(),
	/** Where a wired `rows` CSV input is loaded (postgres/duckdb only). */
	targetTable: T.string.optional(),
	loadMode: T.string.optional(),
	upsertKey: T.string.optional(),
})

const SQL_EDITOR_DEFAULT_LINES = 5
const SQL_EDITOR_MIN_LINES = 3
const SQL_EDITOR_MAX_LINES = 20
/** Approximate px per line of the mono SQL editor at the card's default font. */
const SQL_LINE_PX = 19
const SQL_EDITOR_PADDING_PX = 16
const DRAG_HANDLE_PX = 10
const RESULTS_DEFAULT_PX = 220

function sourceOf(node: DatabaseNode): DbSource {
	return (node.source as DbSource) || 'sqlite'
}

function isExternal(source: DbSource): source is 'postgres' | 'duckdb' {
	return source === 'postgres' || source === 'duckdb'
}

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

interface ExtSchemaTable {
	schema: string
	name: string
	columns: { name: string; type: string }[]
	rows?: number
}

function extTablesList(node: DatabaseNode): ExtSchemaTable[] {
	if (!node.extTables) return []
	try {
		return JSON.parse(node.extTables) as ExtSchemaTable[]
	} catch {
		return []
	}
}

interface ExtQueryResultRow {
	columns: string[]
	rows: unknown[][]
	rowCount: number
	truncated: boolean
	command: string
	affected?: number
}

function extResultsList(node: DatabaseNode): { results: ExtQueryResultRow[]; ms: number } | null {
	if (!node.extResults) return null
	try {
		return JSON.parse(node.extResults) as { results: ExtQueryResultRow[]; ms: number }
	} catch {
		return null
	}
}

function parseConn(node: DatabaseNode): DbConn | null {
	if (!node.conn) return null
	try {
		return JSON.parse(node.conn) as DbConn
	} catch {
		return null
	}
}

function defaultConn(source: 'postgres' | 'duckdb'): DbConn {
	return source === 'postgres'
		? { kind: 'postgres', host: 'localhost', port: 5432 }
		: { kind: 'duckdb', path: ':memory:' }
}

function connOf(node: DatabaseNode, source: 'postgres' | 'duckdb'): DbConn {
	const parsed = parseConn(node)
	return parsed && parsed.kind === source ? parsed : defaultConn(source)
}

/** Where DatabaseNode's rows land, so ports and body height agree with the rendered rows. */
function layout(node: DatabaseNode, sqlWired: boolean) {
	const source = sourceOf(node)
	const external = isExternal(source)
	const tables = external ? extTablesList(node) : tablesList(node)
	const tablesRows = tables.length > 0 ? Math.min(6, tables.length) : 0
	let row = 0
	row++ // source selector
	if (source === 'sqlite') row++ // upload button
	if (external) row += 3 // connection fields + test connection row
	const tablesRow = tablesRows > 0 ? row : null
	row += tablesRows
	const sqlRow = row++
	// The editor + its drag handle only render when the port is not wired.
	const sqlExtraPx = sqlWired ? 0 : editorHeightPx(node) + DRAG_HANDLE_PX
	row++ // write summary / risky confirm line
	if (external) row += 2 // rows -> table panel (header + controls)
	const hintRow = row++
	return { tablesRow, tablesRows, sqlRow, sqlExtraPx, hintRow, rowsCount: row }
}

// ---------------------------------------------------------------------------
// Server API (postgres/duckdb): thin fetch wrappers around server/db.ts's routes.
// ---------------------------------------------------------------------------

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
	const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
	const data = await res.json().catch(() => ({}))
	if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText)
	return data as T
}

function dbTest(conn: DbConn) {
	return postJson<{ ok: true; version: string; normalizedConn?: DbConn }>('/api/db/test', { conn })
}
function dbSchema(conn: DbConn, signal?: AbortSignal) {
	return postJson<{ tables: ExtSchemaTable[]; normalizedConn?: DbConn }>('/api/db/schema', { conn }, signal)
}
function dbQuery(conn: DbConn, sql: string, opts: { transaction?: boolean; signal?: AbortSignal } = {}) {
	return postJson<{ results: ExtQueryResultRow[]; ms: number; normalizedConn?: DbConn }>(
		'/api/db/query',
		{
			conn,
			sql,
			transaction: opts.transaction,
		},
		opts.signal
	)
}

function escapeCsvCell(value: unknown): string {
	if (value == null) return ''
	const s = String(value)
	return s.includes('"') || s.includes('\n') || s.includes(',') ? `"${s.replace(/"/g, '""')}"` : s
}

/** The last SELECT-like result as CSV (for the `output` port); otherwise a per-statement summary. */
function resultsToOutputText(results: ExtQueryResultRow[]): string {
	const last = results[results.length - 1]
	if (last && last.columns.length) {
		const header = last.columns.join(',')
		const rows = last.rows.map((row) => row.map(escapeCsvCell).join(','))
		return [header, ...rows].join('\n')
	}
	return results
		.map((r) => `${r.command}: ${r.affected ?? r.rowCount ?? 0} row${(r.affected ?? r.rowCount ?? 0) === 1 ? '' : 's'}`)
		.join('\n')
}

function extSchemaToText(tables: ExtSchemaTable[]): string {
	return tables
		.map((t) => `CREATE TABLE ${t.schema}.${t.name} (${t.columns.map((c) => `${c.name} ${c.type}`).join(', ')});`)
		.join('\n')
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
	resultKeys = ['lastOutput', 'lastInfo', 'error', 'tables', 'extTables', 'extResults', 'lastSchemaText'] as const
	getDefault(): DatabaseNode {
		return {
			type: 'database',
			fileUrl: '',
			fileName: '',
			fileSize: 0,
			sql: '',
			tables: '',
			lastOutput: null,
			lastInfo: '',
			error: null,
			source: 'sqlite',
		}
	}
	getBodyHeightPx(shape: NodeShape, node: DatabaseNode) {
		const sqlWired = isInputWired(this.editor, shape.id, 'sql')
		const { rowsCount, sqlExtraPx } = layout(node, sqlWired)
		return getNodeRowHeightPx(shape.props.fontSize) * rowsCount + sqlExtraPx + RESULTS_DEFAULT_PX
	}
	getPorts(shape: NodeShape, node: DatabaseNode): Record<string, ShapePort> {
		const sqlWired = isInputWired(this.editor, shape.id, 'sql')
		const { sqlRow } = layout(node, sqlWired)
		const width = this.getWidthPx(shape, node)
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const hiddenPorts = hiddenDedicatedPortIds(node)
		const ports: Record<string, ShapePort> = {
			sql: end('sql', sqlRow, rowPx),
			output: out('output', 0, width),
			schema: out('schema', 1, width),
		}
		if (!hiddenPorts.has('rows')) ports.rows = end('rows', sqlRow + 1, rowPx)
		return ports
	}
	async execute(shape: NodeShape, node: DatabaseNode, inputs: InputValues): Promise<ExecutionResult> {
		const source = sourceOf(node)
		try {
			const sql = getInputText(inputs, 'sql') || node.sql
			if (isExternal(source)) return await this.executeExternal(shape, node, source, sql, inputs)
			if (source === 'pglite') {
				if (!sql.trim()) throw new Error('Type a SQL query')
				const output = await runPgliteSql(sql, null)
				updateNode<DatabaseNode>(this.editor, shape, (n) => ({ ...n, error: null, lastOutput: output.slice(0, 200_000), lastInfo: '' }), false)
				return { output, schema: null }
			}
			// sqlite (default / legacy cards)
			if (!node.fileUrl) throw new Error('Upload a .sqlite or .db file first')
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
			updateNode<DatabaseNode>(this.editor, shape, (n) => ({ ...n, error: isAbortError(error) ? null : (error as Error).message }), false)
			throw error
		}
	}
	private async executeExternal(
		shape: NodeShape,
		node: DatabaseNode,
		source: 'postgres' | 'duckdb',
		sql: string,
		inputs: InputValues
	): Promise<ExecutionResult> {
		const signal = currentRunSignal(this.editor)
		const conn = connOf(node, source)
		const rowsInput = getInputText(inputs, 'rows')
		let loadSummary = ''
		if (rowsInput && rowsInput.trim()) {
			const plan = buildLoadPlan(parseCsv(rowsInput), node.targetTable || '', (node.loadMode as LoadMode) || 'insert', node.upsertKey || undefined)
			await dbQuery(conn, plan.statements.join(';\n'), { transaction: true, signal })
			loadSummary = `Loaded ${plan.rowCount} row${plan.rowCount === 1 ? '' : 's'} into ${plan.table}\n\n`
		}
		if (!sql.trim() && !loadSummary) throw new Error('Type a SQL statement, or wire rows to load into a table')
		const queryResult = sql.trim() ? await dbQuery(conn, sql, { signal }) : { results: [], ms: 0 }
		const schemaResult = await dbSchema(conn, signal).catch(() => ({ tables: [] as ExtSchemaTable[] }))
		const schemaOut = extSchemaToText(schemaResult.tables)
		// The output stays pure CSV so DataPipe and Chart can read it; the load note goes to lastInfo.
		const output = resultsToOutputText(queryResult.results)
		updateNode<DatabaseNode>(
			this.editor,
			shape,
			(n) => ({
				...n,
				error: null,
				lastOutput: output.slice(0, 200_000),
				lastInfo: loadSummary.trim(),
				extResults: JSON.stringify(queryResult),
				extTables: JSON.stringify(schemaResult.tables),
				lastSchemaText: schemaOut,
			}),
			false
		)
		return { output, schema: schemaOut }
	}
	getOutputInfo(shape: NodeShape, node: DatabaseNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		return {
			output: { value: node.lastOutput ?? null, isOutOfDate, dataType: 'text' },
			schema: { value: node.lastSchemaText ?? null, isOutOfDate, dataType: 'text' },
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

const SOURCE_OPTIONS = DB_SOURCES.map((s) => ({ value: s.id, label: s.label }))

function DatabaseComponent({ shape, node }: NodeComponentProps<DatabaseNode>) {
	const editor = useEditor()
	const fileRef = useRef<HTMLInputElement>(null)
	const [busy, setBusy] = useState(false)
	const [pastedUrl, setPastedUrl] = useState('')
	const [testing, setTesting] = useState(false)
	const [testStatus, setTestStatus] = useState<{ ok: boolean; text: string } | null>(null)
	const [armedSql, setArmedSql] = useState<string | null>(null)
	const sqlWired = useInputConnected(shape.id, 'sql')
	const rowsWired = useInputConnected(shape.id, 'rows')
	const set = (patch: Partial<DatabaseNode>) => updateNode<DatabaseNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const source = sourceOf(node)
	const external = isExternal(source)
	const hiddenFields = hiddenFieldKeys(node)

	const runNow = () => startExecution(editor, new Set([shape.id]))
	const summary = useMemo(() => (node.sql.trim() ? summarizeScript(node.sql) : null), [node.sql])
	const risky = summary?.risky.some((r) => r.risky) ?? false
	const runClicked = () => {
		if (risky && armedSql !== node.sql) {
			setArmedSql(node.sql)
			return
		}
		runNow()
	}

	// --- SQLite -------------------------------------------------------------
	const openFile = async (file: File) => {
		setBusy(true)
		try {
			const stored = await storeFile(file)
			const bytes = await loadFileBytes(stored.url)
			const db = await openDatabase(bytes)
			openDbs.set(stored.url, Promise.resolve(db))
			const tableInfo = describeTables(db)
			set({ fileUrl: stored.url, fileName: file.name, fileSize: file.size, tables: JSON.stringify(tableInfo), error: null })
		} catch (error) {
			set({ error: (error as Error).message })
		} finally {
			setBusy(false)
			if (fileRef.current) fileRef.current.value = ''
		}
	}
	const saveSqliteFile = async () => {
		if (!node.fileUrl) return
		setBusy(true)
		try {
			const db = await getOpenDb(node.fileUrl)
			const bytes = db.export()
			const file = new File([bytes as BlobPart], node.fileName || 'database.sqlite', { type: 'application/x-sqlite3' })
			const stored = await storeFile(file)
			openDbs.set(stored.url, Promise.resolve(db))
			set({ fileUrl: stored.url, fileSize: bytes.byteLength })
		} catch (error) {
			set({ error: (error as Error).message })
		} finally {
			setBusy(false)
		}
	}
	const downloadSqliteFile = async () => {
		if (!node.fileUrl) return
		const db = await getOpenDb(node.fileUrl)
		const bytes = db.export()
		const blob = new Blob([bytes as BlobPart], { type: 'application/x-sqlite3' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = node.fileName || 'database.sqlite'
		a.click()
		URL.revokeObjectURL(url)
	}

	// --- Postgres / DuckDB connection ----------------------------------------
	const conn = external ? connOf(node, source) : null
	const saveConn = (patch: Partial<PostgresConn> & Partial<DuckDbConn>) => {
		if (!conn) return
		set({ conn: JSON.stringify({ ...conn, ...patch }) })
	}
	const adoptConn = (normalized: DbConn | undefined, fallback: DbConn) => set({ conn: JSON.stringify(normalized ?? fallback) })
	const testConnection = async () => {
		if (!conn) return
		setTesting(true)
		setTestStatus(null)
		try {
			const started = performance.now()
			const result = await dbTest(conn)
			const ms = performance.now() - started
			if (result.normalizedConn) adoptConn(result.normalizedConn, conn)
			setTestStatus({ ok: true, text: `${result.version} · ${ms.toFixed(1)} ms` })
			const schema = await dbSchema(result.normalizedConn ?? conn)
			set({ extTables: JSON.stringify(schema.tables), lastSchemaText: extSchemaToText(schema.tables), error: null })
		} catch (error) {
			setTestStatus({ ok: false, text: (error as Error).message })
		} finally {
			setTesting(false)
		}
	}
	const applyPastedUrl = async () => {
		if (!pastedUrl.trim()) return
		setTesting(true)
		setTestStatus(null)
		try {
			const result = await dbTest({ kind: 'postgres', url: pastedUrl.trim() })
			if (result.normalizedConn) {
				set({ conn: JSON.stringify(result.normalizedConn) })
				setPastedUrl('')
				setTestStatus({ ok: true, text: result.version })
			}
		} catch (error) {
			setTestStatus({ ok: false, text: (error as Error).message })
		} finally {
			setTesting(false)
		}
	}

	const sqliteTables = source === 'sqlite' ? tablesList(node) : []
	const extTables = external ? extTablesList(node) : []
	const extResults = external ? extResultsList(node) : null
	const sqliteHasWrites = source === 'sqlite' && (summary?.writes ?? 0) > 0

	const pickSqliteTable = (name: string) => {
		set({ sql: `SELECT * FROM "${name}" LIMIT 100;` })
		editor.timers.setTimeout(runNow, 0)
	}
	const pickExtTable = (t: ExtSchemaTable) => {
		const ref = t.schema && t.schema !== 'public' && t.schema !== 'main' ? `"${t.schema}"."${t.name}"` : `"${t.name}"`
		set({ sql: `SELECT * FROM ${ref} LIMIT 100;` })
		editor.timers.setTimeout(runNow, 0)
	}

	const preview = source === 'sqlite' && node.lastOutput ? parseCsvPreview(node.lastOutput) : null

	return (
		<>
			<WireField shapeId={shape.id} fieldKey="source" label="Source">
				<UiSegmented value={source} options={SOURCE_OPTIONS} onChange={(value) => set({ source: value })} />
			</WireField>

			{source === 'sqlite' && (
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
					{node.fileUrl && sqliteHasWrites && (
						<>
							<UiButton size="sm" variant="low" label="Save file" disabled={busy} onClick={() => void saveSqliteFile()} />
							<UiButton size="sm" variant="low" label="Download" disabled={busy} onClick={() => void downloadSqliteFile()} />
						</>
					)}
				</NodeRow>
			)}

			{external && conn && (
				<div onPointerDown={stopEvent}>
					{source === 'postgres' && (
						<>
							<NodeRow>
								<UiTextInput placeholder="postgres://user:pass@host:5432/db" value={pastedUrl} onChange={setPastedUrl} />
								<UiButton size="sm" variant="low" label="Use" disabled={testing} onClick={() => void applyPastedUrl()} />
							</NodeRow>
							<NodeRow>
								<UiTextInput placeholder="Host" value={(conn as PostgresConn).host ?? ''} onChange={(host) => saveConn({ host })} />
								<UiTextInput placeholder="Port" value={String((conn as PostgresConn).port ?? '')} onChange={(port) => saveConn({ port: Number(port) || undefined })} />
								<UiTextInput placeholder="Database" value={(conn as PostgresConn).database ?? ''} onChange={(database) => saveConn({ database })} />
							</NodeRow>
							<NodeRow>
								<UiTextInput placeholder="User" value={(conn as PostgresConn).user ?? ''} onChange={(user) => saveConn({ user })} />
								<UiSecretInput value={(conn as PostgresConn).passwordRef} onChange={(ref) => saveConn({ passwordRef: ref })} placeholder="Password (optional)" />
								<UiCheckbox label="SSL" checked={!!(conn as PostgresConn).ssl} onChange={(ssl) => saveConn({ ssl })} />
							</NodeRow>
						</>
					)}
					{source === 'duckdb' && (
						<NodeRow>
							<UiTextInput placeholder="/home/you/data/sales.duckdb or :memory:" value={(conn as DuckDbConn).path} onChange={(path) => saveConn({ path })} />
							<UiCheckbox label="read-only" checked={!!(conn as DuckDbConn).readOnly} onChange={(readOnly) => saveConn({ readOnly })} />
						</NodeRow>
					)}
					<NodeRow>
						<UiButton size="sm" variant="low" label={testing ? 'Testing…' : 'Test connection'} disabled={testing} onClick={() => void testConnection()} />
						{testStatus && (
							<span className={testStatus.ok ? 'NodeHint' : 'ChatNode-error'}>
								{testStatus.ok ? '✓ ' : ''}
								{testStatus.text}
							</span>
						)}
					</NodeRow>
				</div>
			)}

			{sqliteTables.length > 0 && (
				<div className="NodeScroll" style={{ maxHeight: getNodeRowHeightPx(shape.props.fontSize) * 6, overflowY: 'auto' }} onPointerDown={stopEvent}>
					{sqliteTables.map((t) => (
						<NodeRow key={t.name} className="DatabaseNode-table" onClick={() => pickSqliteTable(t.name)}>
							<IconTable size={14} />
							<span title={t.columns.join(', ')}>{t.name}</span>
							<span className="NodeHint">{t.rows.toLocaleString()} {t.rows === 1 ? 'row' : 'rows'}</span>
						</NodeRow>
					))}
				</div>
			)}
			{extTables.length > 0 && (
				<div className="NodeScroll" style={{ maxHeight: getNodeRowHeightPx(shape.props.fontSize) * 6, overflowY: 'auto' }} onPointerDown={stopEvent}>
					{extTables.map((t) => (
						<NodeRow key={`${t.schema}.${t.name}`} className="DatabaseNode-table" onClick={() => pickExtTable(t)}>
							<IconTable size={14} />
							<span title={t.columns.map((c) => `${c.name} ${c.type}`).join(', ')}>
								{t.schema && t.schema !== 'public' && t.schema !== 'main' ? `${t.schema}.${t.name}` : t.name}
							</span>
							{t.rows != null && (
								<span className="NodeHint">~{t.rows.toLocaleString()} {t.rows === 1 ? 'row' : 'rows'}</span>
							)}
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
							onChange={(sql) => {
								set({ sql })
								setArmedSql(null)
							}}
							onKeyDown={(e) => {
								if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runClicked()
							}}
						/>
					</div>
					<SqlEditorDragHandle node={node} set={set} />
				</>
			)}

			{summary && summary.count > 0 && (
				<NodeRow>
					<span className="NodeHint">
						{summary.count} statement{summary.count === 1 ? '' : 's'}
						{summary.writes > 0 ? ` · ${summary.writes} write${summary.writes === 1 ? '' : 's'}` : ''}
					</span>
					{risky && armedSql === node.sql ? (
						<UiButton size="sm" variant="low" icon={<IconAlert />} label="Run anyway" onClick={runNow} />
					) : (
						<UiButton size="sm" variant="low" label="Run" onClick={runClicked} />
					)}
				</NodeRow>
			)}
			{risky && armedSql !== node.sql && summary && (
				<NodeRow>
					<span className="ChatNode-error">
						{summary.risky.find((r) => r.risky)?.reason ?? 'Risky statement'} — press Run again to confirm.
					</span>
				</NodeRow>
			)}

			{external && !hiddenFields.has('targetTable') && (
				<>
					<WireFieldHeader shapeId={shape.id} fieldKey="targetTable" label="Load rows into" dataType="text" />
					<NodeRow>
						<PortRow shapeId={shape.id} portId="rows" label="Rows" dataType="text" hint="wire CSV rows to load" />
					</NodeRow>
					{rowsWired && (
						<NodeRow>
							<UiTextInput placeholder="Target table" value={node.targetTable ?? ''} onChange={(targetTable) => set({ targetTable })} />
							<NodeSelect
								className="NodeField-select"
								value={node.loadMode ?? 'insert'}
								onPointerDown={stopEvent}
								onChange={(e) => set({ loadMode: e.target.value })}
							>
								<option value="insert">Insert</option>
								<option value="upsert">Upsert on key</option>
								<option value="replace">Replace table</option>
							</NodeSelect>
							{!hiddenFields.has('upsertKey') && (
								<UiTextInput placeholder="Key column" value={node.upsertKey ?? ''} onChange={(upsertKey) => set({ upsertKey })} />
							)}
						</NodeRow>
					)}
				</>
			)}

			{source === 'pglite' && <PgliteMemoryWarning />}
			<div className="NodeHint">
				{source === 'sqlite'
					? 'Changes stay in memory; use Save file to write them back, or Download a copy.'
					: source === 'pglite'
						? 'Built-in Postgres, saved in this browser.'
						: 'Runs against the external database you configured above.'}
			</div>
			<div className="NodeGrow DatabaseNode-results" onPointerDown={stopEvent}>
				{external && extResults ? (
					<ExtResultsView result={extResults} />
				) : preview ? (
					<>
						<UiTable columns={preview.headers} rows={preview.rows} maxRows={50} />
						<div className="NodeHint">{node.lastInfo}</div>
					</>
				) : node.lastOutput ? (
					<div className="NodeScroll" style={{ whiteSpace: 'pre-wrap' }}>
						{node.lastOutput}
					</div>
				) : (
					<UiEmpty text="Press Run to see the result" />
				)}
			</div>
		</>
	)
}

function ExtResultsView({ result }: { result: { results: ExtQueryResultRow[]; ms: number } }) {
	const last = result.results[result.results.length - 1]
	return (
		<>
			{result.results.map((r, i) => (
				<div key={i} className="NodeHint">
					{r.command}
					{r.affected != null ? `: ${r.affected} row${r.affected === 1 ? '' : 's'} affected` : `: ${r.rowCount} row${r.rowCount === 1 ? '' : 's'}`}
				</div>
			))}
			<div className="NodeHint">{result.ms.toFixed(1)} ms</div>
			{last && last.columns.length > 0 ? (
				<UiTable columns={last.columns} rows={last.rows.map((row) => row.map((v) => String(v ?? '')))} maxRows={50} />
			) : (
				<UiEmpty text="No rows to show (the script only wrote data)" />
			)}
			{last?.truncated && <div className="NodeHint">first 10,000 rows</div>}
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
