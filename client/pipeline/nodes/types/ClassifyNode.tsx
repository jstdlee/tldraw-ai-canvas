import { T, useEditor } from 'tldraw'
import { isAbortError } from '../../../../shared/abort'
import { classifyWithRetry, parseLabels } from '../../../../shared/classify'
import { categoryOf } from '../../../../shared/nodeGroups'
import { tryTable } from '../../../../shared/retrieval'
import { toCsv } from '../../../../shared/tableText'
import { apiGenerateText } from '../../api/pipelineApi'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX } from '../../constants'
import { currentRunSignal } from '../../execution/executionState'
import { ShapePort } from '../../ports/Port'
import { isInputWired } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import { IconTag, UiCheckbox, UiTextArea, UiTextInput } from '../../../ui'
import { AiStatusRow, ModelPickRow, modelPort } from './aiCardParts'
import { NodeTextResult, OutputPortRow, PortRow, useInputConnected, WireField, WireFieldHeader } from './fields'
import {
	areAnyInputsOutOfDate,
	ExecutionResult,
	getInputText,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	updateNode,
} from './shared'

/**
 * WP50 Classify: put a text (or each row of a table column) into one or more of the user's
 * labels. The model answers in JSON; the reply is validated and asked again once when it is
 * wrong (`shared/classify.ts`). Table input gets `label` and `confidence` columns added.
 */
export type ClassifyNode = T.TypeOf<typeof ClassifyNode>
export const ClassifyNode = T.object({
	type: T.literal('classify'),
	input: T.string,
	labels: T.string,
	multiLabel: T.boolean,
	/** Table input: the column to classify. Blank = a text-like column. */
	column: T.string,
	model: T.string,
	lastLabel: T.string.nullable(),
	lastTable: T.string.nullable(),
	lastInfo: T.string.optional(),
	error: T.string.nullable(),
})

const INPUT_PX = 72
const LABELS_PX = 88
const RESULT_PX = 96
/** One model call per row; a bigger table is a sign the user wants a filter first. */
export const CLASSIFY_MAX_ROWS = 500

const TEXT_COLUMNS = ['text', 'content', 'body', 'message', 'comment', 'review', 'title', 'description']

/** The column to classify: the named one, else a text-like name, else the longest column. */
export function pickClassifyColumn(headers: string[], rows: string[][], wanted: string): number {
	const lower = headers.map((h) => h.trim().toLowerCase())
	if (wanted.trim()) {
		const at = lower.indexOf(wanted.trim().toLowerCase())
		if (at < 0) throw new Error(`The table has no column "${wanted.trim()}". Columns: ${headers.join(', ')}.`)
		return at
	}
	const named = lower.findIndex((h) => TEXT_COLUMNS.includes(h))
	if (named >= 0) return named
	let best = 0
	let bestSize = -1
	headers.forEach((_h, c) => {
		const size = rows.reduce((sum, row) => sum + (row[c] ?? '').length, 0)
		if (size > bestSize) {
			bestSize = size
			best = c
		}
	})
	return best
}

export class ClassifyNodeDefinition extends NodeDefinition<ClassifyNode> {
	static type = 'classify'
	static validator = ClassifyNode
	title = 'Classify'
	heading = 'Classify'
	icon = <IconTag />
	category = categoryOf('classify')
	override defaultWidthPx = 380
	override showsOutput = true
	resultKeys = ['lastLabel', 'lastTable', 'lastInfo', 'error'] as const
	getDefault(): ClassifyNode {
		return {
			type: 'classify',
			input: '',
			labels: 'positive: happy, praising\nneutral\nnegative: unhappy, complaining',
			multiLabel: false,
			column: '',
			model: '',
			lastLabel: null,
			lastTable: null,
			lastInfo: '',
			error: null,
		}
	}
	getBodyHeightPx(shape: NodeShape, _node: ClassifyNode) {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const inputPx = isInputWired(this.editor, shape.id, 'input') ? 0 : INPUT_PX
		const labelsPx = isInputWired(this.editor, shape.id, 'field:labels') ? 0 : LABELS_PX
		// input, labels header, multi-label, column, model, status, label out, table out.
		return rowPx * 8 + inputPx + labelsPx + RESULT_PX
	}
	getPorts(shape: NodeShape, node: ClassifyNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const base = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
		const inputPx = isInputWired(this.editor, shape.id, 'input') ? 0 : INPUT_PX
		const labelsPx = isInputWired(this.editor, shape.id, 'field:labels') ? 0 : LABELS_PX
		const modelY = base + rowPx * 4 + inputPx + labelsPx
		const outY = modelY + rowPx * 2 + RESULT_PX
		const width = this.getWidthPx(shape, node)
		return {
			input: { id: 'input', x: 0, y: base + rowPx * 0.5, terminal: 'end', dataType: 'text' },
			model: modelPort(modelY + rowPx * 0.5),
			label: { id: 'label', x: width, y: outY + rowPx * 0.5, terminal: 'start', dataType: 'text' },
			table: { id: 'table', x: width, y: outY + rowPx * 1.5, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: ClassifyNode, inputs: InputValues): Promise<ExecutionResult> {
		const signal = currentRunSignal(this.editor)
		try {
			const text = isInputWired(this.editor, shape.id, 'input') ? getInputText(inputs, 'input') : node.input
			if (!text.trim()) throw new Error('Nothing to classify. Type text, or wire text or a table into Input.')
			const labels = parseLabels(node.labels)
			if (labels.length < (node.multiLabel ? 1 : 2)) {
				throw new Error(node.multiLabel ? 'Add at least one label, one per line.' : 'Add at least two labels, one per line.')
			}
			const model = getInputText(inputs, 'model').trim() || node.model || undefined
			const generate = async (prompt: string) =>
				(
					await apiGenerateText(
						{ prompt, model, system: 'You are a careful text classifier. Reply with JSON only.', temperature: 0 },
						signal
					)
				).text
			const table = tryTable(text)
			let label: string
			let tableCsv: string
			let info: string
			if (table) {
				if (table.rows.length > CLASSIFY_MAX_ROWS) {
					throw new Error(`The table has ${table.rows.length} rows; Classify takes up to ${CLASSIFY_MAX_ROWS}. Filter it first.`)
				}
				const col = pickClassifyColumn(table.headers, table.rows, node.column)
				const labelCol = table.headers.findIndex((h) => h.trim().toLowerCase() === 'label')
				const confCol = table.headers.findIndex((h) => h.trim().toLowerCase() === 'confidence')
				const headers = [...table.headers]
				if (labelCol < 0) headers.push('label')
				if (confCol < 0) headers.push('confidence')
				const rows: unknown[][] = []
				const perRow: string[] = []
				for (let i = 0; i < table.rows.length; i++) {
					const row = table.rows[i]
					const cell = (row[col] ?? '').trim()
					const result = cell ? await classifyWithRetry(cell, labels, node.multiLabel, generate) : null
					const value = result ? result.labels.join(', ') : ''
					perRow.push(value)
					const out: unknown[] = [...row]
					while (out.length < table.headers.length) out.push('')
					if (labelCol >= 0) out[labelCol] = value
					else out.push(value)
					if (confCol >= 0) out[confCol] = result ? result.confidence : ''
					else out.push(result ? result.confidence : '')
					rows.push(out)
					if (i % 5 === 4) {
						updateNode<ClassifyNode>(this.editor, shape, (n) => ({ ...n, lastInfo: `Classified ${i + 1} of ${table.rows.length} rows…` }), false)
					}
				}
				label = perRow.join('\n')
				tableCsv = toCsv(headers, rows)
				info = `${table.rows.length} rows · column "${table.headers[col]}"`
			} else {
				const result = await classifyWithRetry(text.trim(), labels, node.multiLabel, generate)
				label = result.labels.join(', ')
				tableCsv = toCsv(['input', 'label', 'confidence'], [[text.trim(), label, result.confidence]])
				info = `Confidence ${Math.round(result.confidence * 100)} %`
			}
			updateNode<ClassifyNode>(
				this.editor,
				shape,
				(n) => ({ ...n, lastLabel: label, lastTable: tableCsv, lastInfo: info, error: null }),
				false
			)
			return { label, table: tableCsv }
		} catch (e) {
			if (!isAbortError(e)) updateNode<ClassifyNode>(this.editor, shape, (n) => ({ ...n, error: (e as Error).message }), false)
			throw e
		}
	}
	getOutputInfo(shape: NodeShape, node: ClassifyNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		return {
			label: { value: node.lastLabel, isOutOfDate, dataType: 'text' },
			table: { value: node.lastTable, isOutOfDate, dataType: 'text' },
		}
	}
	Component = ClassifyNodeComponent
}

function ClassifyNodeComponent({ shape, node }: NodeComponentProps<ClassifyNode>) {
	const editor = useEditor()
	const inputWired = useInputConnected(shape.id, 'input')
	const modelWired = useInputConnected(shape.id, 'model')
	const labelsWired = useInputConnected(shape.id, 'field:labels')
	const set = (patch: Partial<ClassifyNode>, outOfDate = true) =>
		updateNode<ClassifyNode>(editor, shape, (n) => ({ ...n, ...patch }), outOfDate)
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label="Input" dataType="text" hint="text or a table" />
			{!inputWired && (
				<div className="NodeField-block" style={{ height: INPUT_PX }}>
					<UiTextArea
						className="NodeField-textarea"
						grow
						placeholder="Text to classify, or a table (CSV) to classify row by row"
						value={node.input}
						onChange={(input) => set({ input })}
					/>
				</div>
			)}
			<WireFieldHeader shapeId={shape.id} fieldKey="labels" label="Labels" hint="one per line, label: description" />
			{!labelsWired && (
				<div className="NodeField-block" style={{ height: LABELS_PX }}>
					<UiTextArea
						className="NodeField-textarea"
						grow
						mono
						placeholder={'spam: unwanted ads\nnot spam'}
						value={node.labels}
						onChange={(labels) => set({ labels })}
					/>
				</div>
			)}
			<WireField shapeId={shape.id} fieldKey="multiLabel" label="Multi-label">
				<UiCheckbox checked={node.multiLabel} label="Allow more than one label" onChange={(multiLabel) => set({ multiLabel })} />
			</WireField>
			<WireField shapeId={shape.id} fieldKey="column" label="Column" hint="table input">
				<UiTextInput placeholder="auto (text column)" value={node.column} onChange={(column) => set({ column })} />
			</WireField>
			<ModelPickRow shapeId={shape.id} capability="chat" value={node.model} onChange={(model) => set({ model }, false)} />
			<AiStatusRow capability="chat" value={node.model} modelWired={modelWired}>
				<span className="NodeStatus AiCardStatus-text">{node.lastInfo || 'Labels come back as JSON, checked and retried once'}</span>
			</AiStatusRow>
			<NodeTextResult text={node.lastLabel} error={node.error} empty="The label appears here" height={RESULT_PX} />
			<OutputPortRow shapeId={shape.id} portId="label" label="Label" dataType="text" />
			<OutputPortRow shapeId={shape.id} portId="table" label="Table (+ label, confidence)" dataType="text" />
		</>
	)
}
