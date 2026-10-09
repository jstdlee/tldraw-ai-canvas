import { T, useEditor } from 'tldraw'
import { categoryOf } from '../../../../shared/nodeGroups'
import {
	describeSteps,
	importSql,
	makeRecipe,
	parseCsv,
	PG_TYPES,
	PgImportRecipe,
	PgType,
	suggestColumns,
} from '../../../../shared/pgImport'
import { apiHttp } from '../../api/pipelineApi'
import { runSql } from '../../pg'
import { NumberIcon } from '../../components/icons/NumberIcon'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_ROW_HEIGHT_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import { CodeArea } from '../../editors/CodeArea'
import { PortRow, stopEvent, NodeSelect } from './fields'
import {
	areAnyInputsOutOfDate,
	coerceToText,
	ExecutionResult,
	getInput,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	STOP_EXECUTION,
	updateNode,
} from './shared'

const SQL_HEIGHT = 160
const CSV_HEIGHT = 80
const WIDTH = 380

export type PostgresNode = T.TypeOf<typeof PostgresNode>
export const PostgresNode = T.object({
	type: T.literal('postgres'),
	sql: T.string,
	lastText: T.string.nullable(),
	error: T.string.nullable(),
	/** Run SQL, or import CSV by a saved recipe. */
	mode: T.string.optional(),
	/** CSV used when nothing is wired into the input. */
	csv: T.string.optional(),
	/** Fetch this URL (CSV or TSV) when the input port is empty. */
	sourceUrl: T.string.optional(),
	/** The saved import steps (JSON). Reused on every run. */
	recipe: T.string.optional(),
})

const DEFAULT_SQL = `CREATE TABLE IF NOT EXISTS notes (
  id serial PRIMARY KEY,
  body text
);
SELECT * FROM notes;
`

function readRecipe(node: PostgresNode): PgImportRecipe | null {
	if (!node.recipe) return null
	try {
		const parsed = JSON.parse(node.recipe) as PgImportRecipe
		return Array.isArray(parsed.columns) ? parsed : null
	} catch {
		return null
	}
}

function withSteps(recipe: Omit<PgImportRecipe, 'steps'>): PgImportRecipe {
	return { ...recipe, steps: describeSteps(recipe) }
}

export class PostgresNodeDefinition extends NodeDefinition<PostgresNode> {
	static type = 'postgres'
	static validator = PostgresNode
	title = 'Postgres'
	heading = 'Postgres'
	icon = <NumberIcon />
	category = categoryOf('postgres')
	resultKeys = ['lastText', 'error'] as const
	getDefault(): PostgresNode {
		return { type: 'postgres', sql: DEFAULT_SQL, lastText: null, error: null, mode: 'sql', csv: '', sourceUrl: '', recipe: '' }
	}
	override getWidthPx() {
		return WIDTH
	}
	getBodyHeightPx(_shape: NodeShape, node: PostgresNode) {
		if (node.mode === 'import') {
			const columns = readRecipe(node)?.columns.length ?? 0
			return NODE_ROW_HEIGHT_PX * (4 + columns) + CSV_HEIGHT + 56
		}
		return NODE_ROW_HEIGHT_PX * 2 + SQL_HEIGHT
	}
	getPorts(): Record<string, ShapePort> {
		const y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX + NODE_ROW_HEIGHT_PX * 0.5
		return {
			input: { id: 'input', x: 0, y, terminal: 'end', dataType: 'text' },
			output: { id: 'output', x: WIDTH, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: PostgresNode, inputs: InputValues): Promise<ExecutionResult> {
		const input = getInput(inputs, 'input')
		try {
			let text: string
			if (node.mode === 'import') {
				let source = input == null ? '' : coerceToText(input)
				if (!source.trim() && node.sourceUrl?.trim()) source = await textFromUrl(node.sourceUrl)
				if (!source.trim()) source = node.csv ?? ''
				if (!source.trim()) throw new Error('Wire CSV text, paste it, or set a URL')
				// The saved steps are reused. Without them, guess once and keep the guess.
				const recipe = readRecipe(node) ?? makeRecipe(source, 'imported')
				const { sql, rows, truncated } = importSql(source, recipe)
				await runSql(sql, null)
				const preview = await runSql(`SELECT * FROM "${recipe.table.replace(/"/g, '""')}" LIMIT 20;`, null)
				text = `Imported ${rows} row${rows === 1 ? '' : 's'} into ${recipe.table}${truncated ? ' (cut at the row limit)' : ''}\n${preview}`
				updateNode<PostgresNode>(
					this.editor,
					shape,
					(n) => ({ ...n, recipe: n.recipe || JSON.stringify(recipe), lastText: text, error: null })
				)
			} else {
				text = await runSql(node.sql, input == null ? null : coerceToText(input))
				updateNode<PostgresNode>(this.editor, shape, (n) => ({ ...n, lastText: text, error: null }))
			}
			return { output: text }
		} catch (error) {
			const message = (error as Error).message
			updateNode<PostgresNode>(this.editor, shape, (n) => ({ ...n, error: message }), false)
			return { output: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: PostgresNode, inputs: InfoValues): InfoValues {
		return {
			output: {
				value: node.lastText,
				isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
				dataType: 'text',
			},
		}
	}
	Component = PostgresNodeComponent
}

async function textFromUrl(url: string): Promise<string> {
	const trimmed = url.trim()
	if (!trimmed) throw new Error('Type a URL')
	const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
	const result = await apiHttp({ method: 'GET', url: href, extractText: true })
	if (!result.ok) throw new Error(`URL returned ${result.status}`)
	if (!result.text.trim()) throw new Error('The URL returned no text')
	return result.text
}

function PostgresNodeComponent({ shape, node }: NodeComponentProps<PostgresNode>) {
	const editor = useEditor()
	const set = (patch: Partial<PostgresNode>) => updateNode<PostgresNode>(editor, shape, (n) => ({ ...n, ...patch }))
	const importing = node.mode === 'import'
	const recipe = readRecipe(node)
	const saveRecipe = (next: Omit<PgImportRecipe, 'steps'>) => set({ recipe: JSON.stringify(withSteps(next)) })
	const guess = () => {
		const csv = node.csv ?? ''
		if (!csv.trim()) return
		saveRecipe(makeRecipe(csv, recipe?.table || 'imported', recipe?.header ?? true, recipe?.skip ?? 0))
	}
	const setColumn = (index: number, patch: { name?: string; type?: PgType }) => {
		if (!recipe) return
		saveRecipe({ ...recipe, columns: recipe.columns.map((c, i) => (i === index ? { ...c, ...patch } : c)) })
	}
	const reshape = (patch: { header?: boolean; skip?: number }) => {
		if (!recipe) return
		const header = patch.header ?? recipe.header
		const skip = Math.max(0, patch.skip ?? recipe.skip)
		const rows = parseCsv(node.csv ?? '')
		// Column names and types follow the new header and skip; the table name stays.
		saveRecipe({ ...recipe, header, skip, columns: rows.length ? suggestColumns(rows, header, skip) : recipe.columns })
	}
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label={importing ? 'CSV' : '$1'} dataType="text" hint={importing ? 'or paste below' : 'optional value'} />
			<NodeRow>
				<NodeSelect className="NodeField-select" value={importing ? 'import' : 'sql'} onPointerDown={stopEvent} onChange={(e) => set({ mode: e.target.value })}>
					<option value="sql">Run SQL</option>
					<option value="import">Import CSV</option>
				</NodeSelect>
			</NodeRow>
			{!importing && (
				<div onPointerDown={stopEvent}>
					<CodeArea lang="sql" height={SQL_HEIGHT} value={node.sql} onChange={(sql) => set({ sql })} />
				</div>
			)}
			{importing && (
				<>
					<NodeRow>
						<input
							className="NodeField-input"
							placeholder="https://example.com/data.csv"
							title="Load a CSV or TSV from a URL"
							value={node.sourceUrl ?? ''}
							onPointerDown={stopEvent}
							onKeyDown={stopEvent}
							onChange={(e) => set({ sourceUrl: e.target.value })}
						/>
						<button
							type="button"
							className="NodeField-button"
							title="Download the URL into the box below"
							onPointerDown={stopEvent}
							onClick={() => {
								void textFromUrl(node.sourceUrl ?? '')
									.then((csv) => set({ csv, error: null }))
									.catch((error) => set({ error: (error as Error).message }))
							}}
						>
							Load
						</button>
					</NodeRow>
					<textarea
						className="NodeField-textarea"
						style={{ height: CSV_HEIGHT }}
						placeholder="name,score&#10;Ada,9"
						value={node.csv ?? ''}
						onPointerDown={stopEvent}
						onKeyDown={stopEvent}
						onChange={(e) => set({ csv: e.target.value })}
					/>
					<NodeRow>
						<input
							className="NodeField-input"
							title="Table name"
							placeholder="table"
							value={recipe?.table ?? ''}
							disabled={!recipe}
							onPointerDown={stopEvent}
							onKeyDown={stopEvent}
							onChange={(e) => recipe && saveRecipe({ ...recipe, table: e.target.value })}
						/>
						<label className="NodeField-check" title="First row is the header" onPointerDown={stopEvent}>
							<input type="checkbox" checked={recipe?.header ?? true} disabled={!recipe} onChange={(e) => reshape({ header: e.target.checked })} /> header
						</label>
						<input
							className="NodeField-input"
							type="number"
							min={0}
							title="Data rows to ignore"
							value={recipe?.skip ?? 0}
							disabled={!recipe}
							onPointerDown={stopEvent}
							onKeyDown={stopEvent}
							onChange={(e) => reshape({ skip: Number(e.target.value) || 0 })}
						/>
						<button type="button" className="NodeField-button" title="Guess columns and types from the CSV" onPointerDown={stopEvent} onClick={guess}>
							Guess
						</button>
					</NodeRow>
					{recipe?.columns.map((column, index) => (
						<NodeRow key={index}>
							<input className="NodeField-input" value={column.name} onPointerDown={stopEvent} onKeyDown={stopEvent} onChange={(e) => setColumn(index, { name: e.target.value })} />
							<NodeSelect className="NodeField-select" value={column.type} onPointerDown={stopEvent} onChange={(e) => setColumn(index, { type: e.target.value as PgType })}>
								{PG_TYPES.map((type) => (
									<option key={type} value={type}>{type}</option>
								))}
							</NodeSelect>
						</NodeRow>
					))}
					<NodeRow>
						<span className="NodeHint">{recipe ? 'These steps are saved on the node. Play loads again with them.' : 'Press Guess to set the steps.'}</span>
					</NodeRow>
				</>
			)}
			{node.error && (
				<NodeRow>
					<span className="NodeStatus is-error">{node.error}</span>
				</NodeRow>
			)}
		</>
	)
}
