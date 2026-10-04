import { useState } from 'react'
import { T, useEditor } from 'tldraw'
import { ModelSelect } from '../../../ai/aiConfig'
import { apiGenerateText, apiJev, JevResult } from '../../api/pipelineApi'
import { RouterIcon } from '../../components/icons/RouterIcon'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_ROW_HEIGHT_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import { PortRow, stopEvent, useInputConnected } from './fields'
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

/**
 * JEV decision node. Question + context (often written by an LLM) → a JEV model
 * gives probabilities. Optionally an LLM then filters / applies that decision
 * to the input text. Outputs: the answer, the probabilities (JSON), the final
 * (filtered) text, and yes/no branches for yes/no questions.
 */
export type JevNode = T.TypeOf<typeof JevNode>
export const JevNode = T.object({
	type: T.literal('jev'),
	kind: T.string,
	question: T.string,
	options: T.string,
	model: T.string,
	filter: T.boolean,
	filterInstruction: T.string,
	filterModel: T.string,
	lastResult: T.string.nullable(),
	lastFinal: T.string.nullable(),
	error: T.string.nullable(),
})

const W = 340
const BASE_Y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
const portY = (row: number) => BASE_Y + NODE_ROW_HEIGHT_PX * (row + 0.5)
const QUESTION_PX = 56
const OPTIONS_PX = 72
const FILTER_PX = 64
const BARS_PX = 110

export class JevNodeDefinition extends NodeDefinition<JevNode> {
	static type = 'jev'
	static validator = JevNode
	title = 'JEV decision'
	heading = 'JEV'
	icon = <RouterIcon />
	category = 'logic'
	resultKeys = ['lastResult', 'lastFinal', 'error'] as const
	getDefault(): JevNode {
		return {
			type: 'jev',
			kind: 'noul',
			question: 'Should we approve this request?',
			options: 'approve: the request is complete and reasonable\nask: more information is needed\nreject: the request breaks the rules',
			model: '',
			filter: false,
			filterInstruction: 'Rewrite the input text so it follows the decision.',
			filterModel: '',
			lastResult: null,
			lastFinal: null,
			error: null,
		}
	}
	override getWidthPx() {
		return W
	}
	getBodyHeightPx(_shape: NodeShape, node: JevNode) {
		return (
			NODE_ROW_HEIGHT_PX * 6 +
			QUESTION_PX +
			(node.kind === 'noul' ? 0 : OPTIONS_PX) +
			(node.filter ? FILTER_PX + NODE_ROW_HEIGHT_PX : 0) +
			BARS_PX
		)
	}
	getPorts(_shape: NodeShape, node: JevNode): Record<string, ShapePort> {
		const ports: Record<string, ShapePort> = {
			context: { id: 'context', x: 0, y: portY(0), terminal: 'end', dataType: 'any' },
			question: { id: 'question', x: 0, y: portY(1), terminal: 'end', dataType: 'text' },
			input: { id: 'input', x: 0, y: portY(2), terminal: 'end', dataType: 'any' },
			output: { id: 'output', x: W, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
			probs: { id: 'probs', x: W, y: portY(0), terminal: 'start', dataType: 'text' },
			final: { id: 'final', x: W, y: portY(1), terminal: 'start', dataType: 'text' },
		}
		if (node.kind === 'noul') {
			ports.yes = { id: 'yes', x: W, y: portY(2), terminal: 'start', dataType: 'any' }
			ports.no = { id: 'no', x: W, y: portY(3), terminal: 'start', dataType: 'any' }
		}
		return ports
	}
	async execute(shape: NodeShape, node: JevNode, inputs: InputValues): Promise<ExecutionResult> {
		const context = coerceToText(getInput(inputs, 'context'))
		const question = coerceToText(getInput(inputs, 'question')) || node.question
		const input = coerceToText(getInput(inputs, 'input'))
		const lines = node.options.split('\n').map((l) => l.trim()).filter(Boolean)
		try {
			const result = await apiJev({
				model: node.model || undefined,
				type: node.kind as JevResult['type'],
				question,
				context: [context, input && !context ? input : ''].filter(Boolean).join('\n\n'),
				options: node.kind === 'choice' ? lines : undefined,
				levels: node.kind === 'score' ? lines.map((l) => l.replace(/:.*/, '').trim()) : undefined,
			})
			let final = result.answer
			if (node.filter) {
				const probs = Object.entries(result.probabilities)
					.sort((a, b) => b[1] - a[1])
					.map(([k, v]) => `${k}: ${(v * 100).toFixed(1)}%`)
					.join(', ')
				const { text } = await apiGenerateText({
					model: node.filterModel || undefined,
					system:
						'You apply a decision made by a separate judge model. Use the decision and its probabilities; ' +
						'if the top answer is uncertain (below 60%), say so briefly. Return only the result.',
					prompt:
						`Question: ${question}\nDecision: ${result.answer}\nProbabilities: ${probs}\n\n` +
						`Task: ${node.filterInstruction}\n\nInput text:\n${input || context}`,
				})
				final = text
			}
			updateNode<JevNode>(this.editor, shape, (n) => ({
				...n,
				lastResult: JSON.stringify(result),
				lastFinal: final,
				error: null,
			}))
			const isYes = result.answer === 'yes'
			const pass = input || context || result.answer
			return {
				output: result.answer,
				probs: JSON.stringify(result.probabilities),
				final,
				...(node.kind === 'noul' ? { yes: isYes ? pass : STOP_EXECUTION, no: isYes ? STOP_EXECUTION : pass } : {}),
			}
		} catch (e) {
			updateNode<JevNode>(this.editor, shape, (n) => ({ ...n, error: (e as Error).message }), false)
			return { output: STOP_EXECUTION, probs: STOP_EXECUTION, final: STOP_EXECUTION, yes: STOP_EXECUTION, no: STOP_EXECUTION }
		}
	}
	getOutputInfo(shape: NodeShape, node: JevNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		const r = node.lastResult ? (JSON.parse(node.lastResult) as JevResult) : null
		const info: InfoValues = {
			output: { value: r?.answer ?? null, isOutOfDate, dataType: 'text' },
			probs: { value: r ? JSON.stringify(r.probabilities) : null, isOutOfDate, dataType: 'text' },
			final: { value: node.lastFinal, isOutOfDate, dataType: 'text' },
		}
		if (node.kind === 'noul') {
			const yes = r?.answer === 'yes'
			info.yes = { value: r ? (yes ? r.answer : STOP_EXECUTION) : null, isOutOfDate, dataType: 'any' }
			info.no = { value: r ? (yes ? STOP_EXECUTION : r.answer) : null, isOutOfDate, dataType: 'any' }
		}
		return info
	}
	Component = JevNodeComponent
}

function Bars({ result }: { result: JevResult }) {
	const entries = Object.entries(result.probabilities).sort((a, b) => b[1] - a[1])
	return (
		<div className="JevBars">
			{entries.map(([label, p]) => (
				<div key={label} className={'JevBar' + (label === result.answer ? ' is-top' : '')}>
					<span className="JevBar-label" title={label}>
						{label}
					</span>
					<span className="JevBar-track">
						<span className="JevBar-fill" style={{ width: `${Math.max(1, p * 100)}%` }} />
					</span>
					<span className="JevBar-value">{(p * 100).toFixed(p < 0.1 ? 1 : 0)}%</span>
				</div>
			))}
			<div className="JevBars-source">by {result.source}</div>
		</div>
	)
}

function JevNodeComponent({ shape, node }: NodeComponentProps<JevNode>) {
	const editor = useEditor()
	const questionWired = useInputConnected(shape.id, 'question')
	const [showFinal, setShowFinal] = useState(false)
	const set = (patch: Partial<JevNode>, outOfDate = true) =>
		updateNode<JevNode>(editor, shape, (n) => ({ ...n, ...patch }), outOfDate)
	const result = node.lastResult ? (JSON.parse(node.lastResult) as JevResult) : null
	return (
		<>
			<div className="CodeNode-portRow">
				<PortRow shapeId={shape.id} portId="context" label="Context" dataType="any" hint="e.g. LLM output" />
				<span className="CodeNode-outLabel">probabilities →</span>
			</div>
			<div className="CodeNode-portRow">
				<PortRow shapeId={shape.id} portId="question" label="Question" dataType="text" hint="or type below" />
				<span className="CodeNode-outLabel">final text →</span>
			</div>
			<div className="CodeNode-portRow">
				<PortRow shapeId={shape.id} portId="input" label="Input text" dataType="any" hint="text to filter" />
				{node.kind === 'noul' && <span className="CodeNode-outLabel">yes →</span>}
			</div>
			<NodeRow className="NodeRow-right">{node.kind === 'noul' ? <span className="CodeNode-outLabel-static">no →</span> : null}</NodeRow>
			<div className="NodeField-block" style={{ height: QUESTION_PX }}>
				<textarea
					className="NodeField-textarea"
					disabled={questionWired}
					placeholder="Question for JEV"
					value={questionWired ? '(from the Question input)' : node.question}
					onPointerDown={stopEvent}
					onKeyDown={stopEvent}
					onChange={(e) => set({ question: e.target.value })}
				/>
			</div>
			<NodeRow>
				<select className="NodeField-select" value={node.kind} onPointerDown={stopEvent} onChange={(e) => set({ kind: e.target.value })}>
					<option value="noul">Yes / no</option>
					<option value="choice">Choose one option</option>
					<option value="score">Score on a scale</option>
				</select>
				<ModelSelect className="node-model-select" capability="jev" value={node.model} onChange={(model) => set({ model }, false)} />
			</NodeRow>
			{node.kind !== 'noul' && (
				<div className="NodeField-block" style={{ height: OPTIONS_PX }}>
					<textarea
						className="NodeField-textarea"
						placeholder={node.kind === 'choice' ? 'One option per line: label: description' : 'Levels, worst first, one per line'}
						value={node.options}
						onPointerDown={stopEvent}
						onKeyDown={stopEvent}
						onChange={(e) => set({ options: e.target.value })}
					/>
				</div>
			)}
			<NodeRow>
				<label className="NodeField-check" onPointerDown={stopEvent}>
					<input type="checkbox" checked={node.filter} onChange={(e) => set({ filter: e.target.checked })} />
					Then filter the input text with an LLM
				</label>
			</NodeRow>
			{node.filter && (
				<>
					<div className="NodeField-block" style={{ height: FILTER_PX }}>
						<textarea
							className="NodeField-textarea"
							placeholder="What the LLM should do with the decision"
							value={node.filterInstruction}
							onPointerDown={stopEvent}
							onKeyDown={stopEvent}
							onChange={(e) => set({ filterInstruction: e.target.value })}
						/>
					</div>
					<NodeRow>
						<span className="NodeInputRow-label">LLM</span>
						<ModelSelect className="node-model-select" capability="chat" value={node.filterModel} onChange={(filterModel) => set({ filterModel }, false)} />
					</NodeRow>
				</>
			)}
			<div className="NodeOutputView NodeGrow" style={{ height: BARS_PX - 8 }} onDoubleClick={() => setShowFinal((v) => !v)}>
				{node.error ? (
					<span className="NodeStatus is-error">{node.error}</span>
				) : result && (!showFinal || !node.filter) ? (
					<Bars result={result} />
				) : node.lastFinal && node.filter ? (
					<pre className="ValuePreview-text">{node.lastFinal}</pre>
				) : (
					<span className="NodeRow-disconnected">Press ▶ Play for probabilities</span>
				)}
			</div>
		</>
	)
}
