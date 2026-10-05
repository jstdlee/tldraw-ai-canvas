import { T, useEditor } from 'tldraw'
import { categoryOf } from '../../../../shared/nodeGroups'
import { runSql } from '../../pg'
import { NumberIcon } from '../../components/icons/NumberIcon'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_ROW_HEIGHT_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import { CodeArea } from '../../editors/CodeArea'
import { PortRow, stopEvent } from './fields'
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
const RESULT_HEIGHT = 110
const WIDTH = 380

export type PostgresNode = T.TypeOf<typeof PostgresNode>
export const PostgresNode = T.object({
	type: T.literal('postgres'),
	sql: T.string,
	lastText: T.string.nullable(),
	error: T.string.nullable(),
})

const DEFAULT_SQL = `CREATE TABLE IF NOT EXISTS notes (
  id serial PRIMARY KEY,
  body text
);
SELECT * FROM notes;
`

export class PostgresNodeDefinition extends NodeDefinition<PostgresNode> {
	static type = 'postgres'
	static validator = PostgresNode
	title = 'Postgres'
	heading = 'Postgres'
	icon = <NumberIcon />
	category = categoryOf('postgres')
	resultKeys = ['lastText', 'error'] as const
	getDefault(): PostgresNode {
		return { type: 'postgres', sql: DEFAULT_SQL, lastText: null, error: null }
	}
	override getWidthPx() {
		return WIDTH
	}
	getBodyHeightPx() {
		return NODE_ROW_HEIGHT_PX + SQL_HEIGHT
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
			const text = await runSql(node.sql, input == null ? null : coerceToText(input))
			updateNode<PostgresNode>(this.editor, shape, (n) => ({ ...n, lastText: text, error: null }))
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

function PostgresNodeComponent({ shape, node }: NodeComponentProps<PostgresNode>) {
	const editor = useEditor()
	const set = (patch: Partial<PostgresNode>) => updateNode<PostgresNode>(editor, shape, (n) => ({ ...n, ...patch }))
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label="$1" dataType="text" hint="optional value" />
			<div onPointerDown={stopEvent}>
				<CodeArea lang="sql" height={SQL_HEIGHT} value={node.sql} onChange={(sql) => set({ sql })} />
			</div>
			{node.error && (
				<NodeRow>
					<span className="NodeStatus is-error">{node.error}</span>
				</NodeRow>
			)}
		</>
	)
}
