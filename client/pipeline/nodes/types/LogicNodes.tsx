import { categoryOf } from '../../../../shared/nodeGroups'
import { T, useEditor } from 'tldraw'
import { evaluateCondition, isTruthy, resolveLoopItemResult, splitItems } from '../../../../shared/logic'
import { IteratorIcon } from '../../components/icons/IteratorIcon'
import { RouterIcon } from '../../components/icons/RouterIcon'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_WIDTH_PX } from '../../constants'
import { executionGeneration } from '../../execution/executionState'
import { loopBodyNodes, runLoopBody } from '../../execution/loop'
import { clearNodeRun } from '../../execution/nodeRunState'
import { Port, ShapePort } from '../../ports/Port'
import { useFieldPortAnchor } from '../../ports/useFieldPortAnchor'
import { NodeShape } from '../NodeShapeUtil'
import { UiTextInput } from '../../../ui'
import { PortRow, stopEvent, NodeSelect, WireField } from './fields'
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
	PipelineValue,
	STOP_EXECUTION,
	updateNode,
} from './shared'

const BASE_Y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
const portY = (row: number, rowPx: number) => BASE_Y + rowPx * (row + 0.5)

function inputInfo(inputs: InfoValues, id: string): PipelineValue | undefined {
	const v = inputs[id]
	if (!v || v.isOutOfDate) return undefined
	const value = Array.isArray(v.value) ? v.value[0] : v.value
	return value === STOP_EXECUTION ? undefined : (value as PipelineValue)
}

// ---------------------------------------------------------------------------
// If / else: route the value to "then" or "else"
// ---------------------------------------------------------------------------

export const CONDITIONS = [
	{ id: 'truthy', label: 'is true / not empty', operand: false },
	{ id: 'empty', label: 'is empty / false', operand: false },
	{ id: 'equals', label: 'equals', operand: true },
	{ id: 'not_equals', label: 'does not equal', operand: true },
	{ id: 'contains', label: 'contains', operand: true },
	{ id: 'starts', label: 'starts with', operand: true },
	{ id: 'ends', label: 'ends with', operand: true },
	{ id: 'regex', label: 'matches regex', operand: true },
	{ id: 'gt', label: '> number', operand: true },
	{ id: 'gte', label: '≥ number', operand: true },
	{ id: 'lt', label: '< number', operand: true },
	{ id: 'lte', label: '≤ number', operand: true },
	{ id: 'is_image', label: 'is an image', operand: false },
	{ id: 'is_json', label: 'is valid JSON', operand: false },
] as const

export type IfNode = T.TypeOf<typeof IfNode>
export const IfNode = T.object({
	type: T.literal('if'),
	condition: T.string,
	operand: T.string,
	lastResult: T.boolean.nullable(),
	lastValue: T.string.nullable(),
})

export class IfNodeDefinition extends NodeDefinition<IfNode> {
	static type = 'if'
	static validator = IfNode
	title = 'If / else'
	heading = 'If'
	icon = <RouterIcon />
	category = categoryOf('if')
	resultKeys = ['lastResult', 'lastValue'] as const
	getDefault(): IfNode {
		return { type: 'if', condition: 'contains', operand: 'yes', lastResult: null, lastValue: null }
	}
	getBodyHeightPx(shape: NodeShape) {
		return getNodeRowHeightPx(shape.props.fontSize) * 6
	}
	getPorts(shape: NodeShape): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return {
			input: { id: 'input', x: 0, y: portY(0, rowPx), terminal: 'end', dataType: 'any' },
			test: { id: 'test', x: 0, y: portY(1, rowPx), terminal: 'end', dataType: 'any' },
			then: { id: 'then', x: NODE_WIDTH_PX, y: portY(4, rowPx), terminal: 'start', dataType: 'any' },
			else: { id: 'else', x: NODE_WIDTH_PX, y: portY(5, rowPx), terminal: 'start', dataType: 'any' },
		}
	}
	async execute(shape: NodeShape, node: IfNode, inputs: InputValues): Promise<ExecutionResult> {
		const value = coerceToText(getInput(inputs, 'input'))
		const testInput = getInput(inputs, 'test')
		// The condition looks at "Test" when it is connected, otherwise at the value itself.
		const subject = testInput != null ? coerceToText(testInput) : value
		const ok = evaluateCondition(subject, node.condition, node.operand)
		updateNode<IfNode>(this.editor, shape, (n) => ({ ...n, lastResult: ok, lastValue: value }))
		return ok ? { then: value, else: STOP_EXECUTION } : { then: STOP_EXECUTION, else: value }
	}
	getOutputInfo(shape: NodeShape, node: IfNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		const v = node.lastValue
		return {
			then: { value: node.lastResult === false ? STOP_EXECUTION : v, isOutOfDate, dataType: 'any' },
			else: { value: node.lastResult === true ? STOP_EXECUTION : v, isOutOfDate, dataType: 'any' },
		}
	}
	Component = IfNodeComponent
}

function IfNodeComponent({ shape, node }: NodeComponentProps<IfNode>) {
	const editor = useEditor()
	const set = (patch: Partial<IfNode>) => updateNode<IfNode>(editor, shape, (n) => ({ ...n, ...patch }))
	const cond = CONDITIONS.find((c) => c.id === node.condition) ?? CONDITIONS[0]
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label="Value" dataType="any" />
			<PortRow shapeId={shape.id} portId="test" label="Test" dataType="any" hint="optional: test this instead" />
			<WireField shapeId={shape.id} fieldKey="condition" label="If">
				<NodeSelect className="NodeField-select" value={node.condition} onPointerDown={stopEvent} onChange={(e) => set({ condition: e.target.value })}>
					{CONDITIONS.map((c) => (
						<option key={c.id} value={c.id}>
							{c.label}
						</option>
					))}
				</NodeSelect>
			</WireField>
			<WireField shapeId={shape.id} fieldKey="operand" label="Value">
				{cond.operand ? (
					<UiTextInput placeholder="compare with…" value={node.operand} onChange={(operand) => set({ operand })} />
				) : (
					<span className="NodeRow-disconnected">no value needed</span>
				)}
			</WireField>
			<IfBranchRow shapeId={shape.id} portId="then" active={node.lastResult === true} label="then ✓" />
			<IfBranchRow shapeId={shape.id} portId="else" active={node.lastResult === false} label="else ✗" />
		</>
	)
}

/** WP21 Part A: the If node's `then`/`else` ports were defined in `getPorts` but never had a
 * `<Port>` rendered, so they had no visible, draggable dot. Anchored to its own row so the dot
 * tracks the row at any font size, like `OutputPortRow`, but keeps the `NodeBranch` styling. */
function IfBranchRow({
	shapeId,
	portId,
	active,
	label,
}: {
	shapeId: NodeShape['id']
	portId: string
	active: boolean
	label: string
}) {
	const ref = useFieldPortAnchor<HTMLDivElement>(shapeId, portId)
	return (
		<NodeRow ref={ref} className="NodeRow-right">
			<span className={'NodeBranch' + (active ? ' is-active' : '')}>{label}</span>
			<Port shapeId={shapeId} portId={portId} />
		</NodeRow>
	)
}

// ---------------------------------------------------------------------------
// And / Or / Not / Xor
// ---------------------------------------------------------------------------

export type LogicNode = T.TypeOf<typeof LogicNode>
export const LogicNode = T.object({
	type: T.literal('logic'),
	op: T.string,
	lastResult: T.boolean.nullable(),
})

export class LogicNodeDefinition extends NodeDefinition<LogicNode> {
	static type = 'logic'
	static validator = LogicNode
	title = 'And / Or / Not'
	heading = 'Logic'
	icon = <RouterIcon />
	category = categoryOf('logic')
	resultKeys = ['lastResult'] as const
	getDefault(): LogicNode {
		return { type: 'logic', op: 'and', lastResult: null }
	}
	getBodyHeightPx(shape: NodeShape) {
		return getNodeRowHeightPx(shape.props.fontSize) * 3 + 8
	}
	getPorts(shape: NodeShape, node: LogicNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return {
			a: { id: 'a', x: 0, y: portY(0, rowPx), terminal: 'end', dataType: 'any' },
			...(node.op === 'not' ? {} : { b: { id: 'b', x: 0, y: portY(1, rowPx), terminal: 'end', dataType: 'any' } as ShapePort }),
			output: { id: 'output', x: NODE_WIDTH_PX, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
		}
	}
	compute(node: LogicNode, a: PipelineValue | undefined, b: PipelineValue | undefined) {
		const A = isTruthy(a)
		const B = isTruthy(b)
		switch (node.op) {
			case 'or':
				return A || B
			case 'not':
				return !A
			case 'xor':
				return A !== B
			case 'nand':
				return !(A && B)
			default:
				return A && B
		}
	}
	async execute(shape: NodeShape, node: LogicNode, inputs: InputValues): Promise<ExecutionResult> {
		const result = this.compute(node, getInput(inputs, 'a') as PipelineValue, getInput(inputs, 'b') as PipelineValue)
		updateNode<LogicNode>(this.editor, shape, (n) => ({ ...n, lastResult: result }))
		return { output: String(result) }
	}
	getOutputInfo(shape: NodeShape, node: LogicNode, inputs: InfoValues): InfoValues {
		const live = this.compute(node, inputInfo(inputs, 'a'), inputInfo(inputs, 'b'))
		return {
			output: {
				value: node.lastResult == null && !inputs.a ? null : String(inputs.a ? live : node.lastResult),
				isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
				dataType: 'text',
			},
		}
	}
	Component = LogicNodeComponent
}

function LogicNodeComponent({ shape, node }: NodeComponentProps<LogicNode>) {
	const editor = useEditor()
	return (
		<>
			<PortRow shapeId={shape.id} portId="a" label="A" dataType="any" />
			{node.op !== 'not' ? <PortRow shapeId={shape.id} portId="b" label="B" dataType="any" /> : <NodeRow>{null}</NodeRow>}
			<WireField shapeId={shape.id} fieldKey="op" label="Result is">
				<NodeSelect
					className="NodeField-select"
					value={node.op}
					onPointerDown={stopEvent}
					onChange={(e) => updateNode<LogicNode>(editor, shape, (n) => ({ ...n, op: e.target.value }))}
				>
					<option value="and">A AND B</option>
					<option value="or">A OR B</option>
					<option value="not">NOT A</option>
					<option value="xor">A XOR B</option>
					<option value="nand">NOT (A AND B)</option>
				</NodeSelect>
			</WireField>
		</>
	)
}

// ---------------------------------------------------------------------------
// For each: run the loop body once per line / item, collect the results
// ---------------------------------------------------------------------------

export type ForEachNode = T.TypeOf<typeof ForEachNode>
export const ForEachNode = T.object({
	type: T.literal('for_each'),
	split: T.string,
	separator: T.string,
	joiner: T.string,
	// WP21 Part B: what happens to an item whose path never reaches "result" (e.g. an If branch
	// that wasn't wired back). Optional: an old saved canvas without it behaves as "skip".
	noResult: T.string.optional(),
	progress: T.string.nullable(),
	lastResults: T.string.nullable(),
	error: T.string.nullable(),
})

const FOR_EACH_RESULT_PX = 110

export class ForEachNodeDefinition extends NodeDefinition<ForEachNode> {
	static type = 'for_each'
	static validator = ForEachNode
	title = 'For each'
	heading = 'For each'
	icon = <IteratorIcon />
	category = categoryOf('for_each')
	resultKeys = ['progress', 'lastResults', 'error'] as const
	getDefault(): ForEachNode {
		return { type: 'for_each', split: 'lines', separator: ',', joiner: '\\n', noResult: 'skip', progress: null, lastResults: null, error: null }
	}
	getBodyHeightPx(shape: NodeShape) {
		// +1 row (WP21 Part B): the noResult control.
		return getNodeRowHeightPx(shape.props.fontSize) * 7 + 18
	}
	getPorts(shape: NodeShape): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return {
			list: { id: 'list', x: 0, y: portY(0, rowPx), terminal: 'end', dataType: 'any' },
			// Loop body: "item" → … → back into "result".
			item: { id: 'item', x: NODE_WIDTH_PX, y: portY(3, rowPx), terminal: 'start', dataType: 'text' },
			result: { id: 'result', x: 0, y: portY(4, rowPx), terminal: 'end', dataType: 'any', feedback: true },
			output: { id: 'output', x: NODE_WIDTH_PX, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: ForEachNode, inputs: InputValues): Promise<ExecutionResult> {
		const items = splitItems(coerceToText(getInput(inputs, 'list')), node.split, node.separator)
		const set = (patch: Partial<ForEachNode>, outOfDate = true) =>
			updateNode<ForEachNode>(this.editor, this.editor.getShape<NodeShape>(shape.id) ?? shape, (n) => ({ ...n, ...patch }), outOfDate)
		const generation = executionGeneration(this.editor)
		const bodyNodes = loopBodyNodes(this.editor, shape.id, 'item')
		const joinResults = (results: string[]) =>
			node.split === 'json' ? JSON.stringify(results) : results.join(node.joiner.replace(/\\n/g, '\n'))
		try {
			const results: string[] = []
			for (let i = 0; i < items.length; i++) {
				// Stop pressed (or a new Play started): keep what finished and end cleanly.
				if (executionGeneration(this.editor) !== generation) {
					set({ progress: `stopped at ${i} / ${items.length}`, lastResults: joinResults(results) })
					return { item: STOP_EXECUTION, output: results.length ? joinResults(results) : STOP_EXECUTION }
				}
				set({ progress: `${i + 1} / ${items.length}`, error: null })
				// Clear last item's body-node run state so only this item's failure counts.
				for (const id of bodyNodes) clearNodeRun(this.editor, id)
				const result = await runLoopBody(this.editor, shape.id, 'item', 'result', items[i])
				if (result.error) {
					// Surface the failure instead of passing the item through as if it worked.
					set({ error: `Item ${i + 1} (${previewItem(items[i])}): ${result.error}`, progress: `failed at ${i + 1} / ${items.length}` }, false)
					return { item: STOP_EXECUTION, output: results.length ? joinResults(results) : STOP_EXECUTION }
				}
				// WP21 Part B: a branch inside the loop body (e.g. an If whose "else" is never
				// wired back to "result") can leave this item with no result at all — handled
				// by noResult (default "skip": the item is left out, like a filter).
				const outcome = resolveLoopItemResult(result.value, items[i], (node.noResult as 'skip' | 'keep' | 'error') ?? 'skip')
				if (outcome.error) {
					set({ error: `Item ${i + 1} (${previewItem(items[i])}): ${outcome.error}`, progress: `failed at ${i + 1} / ${items.length}` }, false)
					return { item: STOP_EXECUTION, output: results.length ? joinResults(results) : STOP_EXECUTION }
				}
				if (outcome.value != null) results.push(outcome.value)
			}
			const joined = joinResults(results)
			set({ lastResults: joined, progress: `${items.length} done` })
			return { item: STOP_EXECUTION, output: joined }
		} catch (e) {
			set({ error: (e as Error).message }, false)
			return { item: STOP_EXECUTION, output: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: ForEachNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		return {
			// Outside a loop run, "item" carries nothing (it only flows during the loop).
			item: { value: STOP_EXECUTION, isOutOfDate, dataType: 'text' },
			output: { value: node.lastResults, isOutOfDate, dataType: 'text' },
		}
	}
	Component = ForEachNodeComponent
}

/** A short, single-line preview of a loop item for error messages. */
function previewItem(item: string): string {
	const one = item.replace(/\s+/g, ' ').trim()
	return one.length > 24 ? one.slice(0, 24) + '…' : one
}

function forEachPercent(progress: string | null): number {
	const match = /(\d+)\s*\/\s*(\d+)/.exec(progress ?? '')
	if (match) return Math.round((Number(match[1]) / Math.max(1, Number(match[2]))) * 100)
	if (progress?.includes('done')) return 100
	return 0
}

/** WP21 Part A: "item" is an output port (feeds the loop body) but had no visible dot. */
function ForEachItemRow({ shapeId }: { shapeId: NodeShape['id'] }) {
	const ref = useFieldPortAnchor<HTMLDivElement>(shapeId, 'item')
	return (
		<NodeRow ref={ref} className="NodeRow-right">
			<span className="NodeBranch is-active">each item →</span>
			<Port shapeId={shapeId} portId="item" />
		</NodeRow>
	)
}

function ForEachNodeComponent({ shape, node }: NodeComponentProps<ForEachNode>) {
	const editor = useEditor()
	const set = (patch: Partial<ForEachNode>) => updateNode<ForEachNode>(editor, shape, (n) => ({ ...n, ...patch }))
	return (
		<>
			<PortRow shapeId={shape.id} portId="list" label="List" dataType="any" />
			<WireField shapeId={shape.id} fieldKey="split" label="Split">
				<NodeSelect className="NodeField-select" value={node.split} onPointerDown={stopEvent} onChange={(e) => set({ split: e.target.value })}>
					<option value="lines">per line</option>
					<option value="separator">per separator</option>
					<option value="paragraphs">per paragraph</option>
					<option value="json">JSON array items</option>
					<option value="regex">per regex match</option>
				</NodeSelect>
			</WireField>
			<WireField shapeId={shape.id} fieldKey="separator" label="Separator">
				{node.split === 'separator' || node.split === 'regex' ? (
					<UiTextInput
						placeholder={node.split === 'regex' ? 'pattern, e.g. \\d+' : 'separator, e.g. ,'}
						value={node.separator}
						onChange={(separator) => set({ separator })}
					/>
				) : (
					<span className="NodeRow-disconnected">empty items are skipped</span>
				)}
			</WireField>
			<ForEachItemRow shapeId={shape.id} />
			<PortRow shapeId={shape.id} portId="result" label="← Result" dataType="any" hint="end of the loop body" />
			<WireField shapeId={shape.id} fieldKey="joiner" label="Join with">
				<UiTextInput value={node.joiner} onChange={(joiner) => set({ joiner })} />
			</WireField>
			<WireField shapeId={shape.id} fieldKey="noResult" label="No result">
				<NodeSelect
					className="NodeField-select"
					value={node.noResult ?? 'skip'}
					onPointerDown={stopEvent}
					onChange={(e) => set({ noResult: e.target.value })}
				>
					<option value="skip">skip the item</option>
					<option value="keep">keep the item as-is</option>
					<option value="error">stop with an error</option>
				</NodeSelect>
			</WireField>
			<div className="ProgressBar" title={node.progress ?? 'Wire item, then Result, then Play'}>
				<span style={{ width: `${forEachPercent(node.progress)}%` }} />
			</div>
		</>
	)
}
