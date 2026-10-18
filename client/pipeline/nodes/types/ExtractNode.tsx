import { categoryOf } from '../../../../shared/nodeGroups'
import { extractFromText, ExtractOutput } from '../../../../shared/extractFromText'
import { T, useEditor } from 'tldraw'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { isInputWired } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import { UiCheckbox, UiTextArea, UiTextInput } from '../../../ui'
import { IconExtract } from '../../../ui/icons'
import { OutputPortRow, PortRow, stopEvent, useInputConnected, NodeSelect, WireField } from './fields'
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

/**
 * WP35 Part B: "Extract from text" — pulls the first Markdown table, csv/json fenced code
 * block, bare JSON object/array, or bullet list out of free-form LLM/Agent prose, so a card
 * that needs a real table/JSON/list doesn't need a Text tools detour first. See
 * `shared/extractFromText.ts` for the pure logic this card is a thin UI over.
 */
export type ExtractNode = T.TypeOf<typeof ExtractNode>
export const ExtractNode = T.object({
	type: T.literal('extract'),
	text: T.string,
	find: T.string,
	lang: T.string,
	clean: T.boolean,
	lastTable: T.string.nullable(),
	lastJson: T.string.nullable(),
	lastCode: T.string.nullable(),
	lastList: T.string.nullable(),
	lastKind: T.string.nullable(),
	error: T.string.nullable(),
})

const TEXT_PX = 88

const SAMPLE_TEXT = [
	'Here are the findings from the latest survey:',
	'',
	'| Country | Share |',
	'| --- | --- |',
	'| Norway | 42% |',
	'| Sweden | 31% |',
	'',
	'Let me know if you would like a breakdown by age group.',
].join('\n')

export class ExtractNodeDefinition extends NodeDefinition<ExtractNode> {
	static type = 'extract'
	static validator = ExtractNode
	title = 'Extract from text'
	heading = 'Extract'
	icon = <IconExtract />
	category = categoryOf('extract')
	override defaultWidthPx = 360
	override showsOutput = true
	resultKeys = ['lastTable', 'lastJson', 'lastCode', 'lastList', 'lastKind', 'error'] as const
	getDefault(): ExtractNode {
		return {
			type: 'extract',
			text: SAMPLE_TEXT,
			find: 'auto',
			lang: '',
			clean: false,
			lastTable: null,
			lastJson: null,
			lastCode: null,
			lastList: null,
			lastKind: null,
			error: null,
		}
	}
	getBodyHeightPx(shape: NodeShape, node: ExtractNode) {
		const textWired = isInputWired(this.editor, shape.id, 'text')
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const langRow = node.find === 'fence' ? 1 : 0
		// The status row shows the error, or (once a run succeeded) which kind was found.
		const statusRow = node.error || node.lastKind ? 1 : 0
		// text port row, find, [lang], clean, 4 output rows (table/json/code/list), [status].
		return rowPx * (3 + langRow + 4 + statusRow) + (textWired ? 0 : TEXT_PX)
	}
	getPorts(shape: NodeShape, node: ExtractNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const width = this.getWidthPx(shape, node)
		return {
			text: { id: 'text', x: 0, y: NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX + rowPx * 0.5, terminal: 'end', dataType: 'text' },
			table: { id: 'table', x: width, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
			json: { id: 'json', x: width, y: NODE_HEADER_HEIGHT_PX / 2 + rowPx, terminal: 'start', dataType: 'text' },
			code: { id: 'code', x: width, y: NODE_HEADER_HEIGHT_PX / 2 + rowPx * 2, terminal: 'start', dataType: 'text' },
			list: { id: 'list', x: width, y: NODE_HEADER_HEIGHT_PX / 2 + rowPx * 3, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: ExtractNode, inputs: InputValues): Promise<ExecutionResult> {
		const text = getInputText(inputs, 'text') || node.text
		try {
			const result = extractFromText(text, { find: node.find as ExtractOutput['kind'] | 'auto', lang: node.lang, clean: node.clean })
			updateNode<ExtractNode>(
				this.editor,
				shape,
				(n) => ({
					...n,
					lastTable: result.table || null,
					lastJson: result.json || null,
					lastCode: result.code || null,
					lastList: result.list || null,
					lastKind: result.kind,
					error: null,
				}),
				false
			)
			return { table: result.table, json: result.json, code: result.code, list: result.list }
		} catch (error) {
			updateNode<ExtractNode>(this.editor, shape, (n) => ({ ...n, error: (error as Error).message, lastKind: null }), false)
			throw error
		}
	}
	getOutputInfo(shape: NodeShape, node: ExtractNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		return {
			table: { value: node.lastTable ?? null, isOutOfDate, dataType: 'text' },
			json: { value: node.lastJson ?? null, isOutOfDate, dataType: 'text' },
			code: { value: node.lastCode ?? null, isOutOfDate, dataType: 'text' },
			list: { value: node.lastList ?? null, isOutOfDate, dataType: 'text' },
		}
	}
	Component = ExtractNodeComponent
}

function ExtractNodeComponent({ shape, node }: NodeComponentProps<ExtractNode>) {
	const editor = useEditor()
	const textWired = useInputConnected(shape.id, 'text')
	const set = (patch: Partial<ExtractNode>) => updateNode<ExtractNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	return (
		<>
			<PortRow shapeId={shape.id} portId="text" label="Text" dataType="text" />
			{!textWired && (
				<div className="NodeField-block" style={{ height: TEXT_PX }}>
					<UiTextArea className="NodeField-textarea" grow rows={4} value={node.text} onChange={(text) => set({ text })} />
				</div>
			)}
			<WireField shapeId={shape.id} fieldKey="find" label="Find">
				<NodeSelect className="NodeField-select" value={node.find} onPointerDown={stopEvent} onChange={(e) => set({ find: e.target.value })}>
					<option value="auto">Auto</option>
					<option value="table">First table</option>
					<option value="json">First JSON</option>
					<option value="fence">Fenced block</option>
					<option value="list">Bullet list</option>
				</NodeSelect>
			</WireField>
			{node.find === 'fence' && (
				<WireField shapeId={shape.id} fieldKey="lang" label="Language" hint="blank = any">
					<UiTextInput placeholder="e.g. csv, json, python" value={node.lang} onChange={(lang) => set({ lang })} />
				</WireField>
			)}
			<WireField shapeId={shape.id} fieldKey="clean" label="Clean">
				<UiCheckbox checked={node.clean} label="Strip **bold**, %, thousands separators" onChange={(clean) => set({ clean })} />
			</WireField>
			{node.error ? (
				<NodeRow>
					<span className="NodeStatus is-error">{node.error}</span>
				</NodeRow>
			) : (
				node.lastKind && (
					<NodeRow>
						<span className="NodeStatus">Found: {KIND_LABEL[node.lastKind] ?? node.lastKind}</span>
					</NodeRow>
				)
			)}
			<OutputPortRow shapeId={shape.id} portId="table" label="Table" dataType="text" />
			<OutputPortRow shapeId={shape.id} portId="json" label="JSON" dataType="text" />
			<OutputPortRow shapeId={shape.id} portId="code" label="Code" dataType="text" />
			<OutputPortRow shapeId={shape.id} portId="list" label="List" dataType="text" />
		</>
	)
}

const KIND_LABEL: Record<string, string> = { table: 'a table', json: 'JSON', fence: 'a fenced block', list: 'a list' }
