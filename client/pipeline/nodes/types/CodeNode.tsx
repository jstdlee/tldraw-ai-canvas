import { useState } from 'react'
import { T, TldrawUiButton, useEditor } from 'tldraw'
import { apiGenerateText } from '../../api/pipelineApi'
import { extractCode, runCode } from '../../codeRunner'
import { NumberIcon } from '../../components/icons/NumberIcon'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_ROW_HEIGHT_PX, NODE_WIDTH_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import { NodeTextResult, PortRow, stopEvent } from './fields'
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
 * A node that runs your own TypeScript / JavaScript function.
 * Inputs a, b, c, d arrive as strings (images as URLs). Return one value, or
 * { output, out2, out3 } for several outputs. console.log goes to the log.
 */
export type CodeNode = T.TypeOf<typeof CodeNode>
export const CodeNode = T.object({
	type: T.literal('code'),
	lang: T.string,
	code: T.string,
	inputCount: T.number,
	outputCount: T.number,
	request: T.string,
	description: T.string.nullable(),
	showAI: T.boolean,
	lastOutputs: T.string.nullable(),
	logs: T.string.nullable(),
	error: T.string.nullable(),
})

const INPUT_NAMES = ['a', 'b', 'c', 'd']
const OUTPUT_IDS = ['output', 'out2', 'out3']
const CODE_HEIGHT_PX = 200
const AI_HEIGHT_PX = 120
const RESULT_HEIGHT_PX = 90

export const DEFAULT_CODE = `// Inputs: a, b (text; images are URLs). Return a value,
// or { output, out2 } when the node has several outputs.
export default async function run({ a, b }: Record<string, string>) {
  const words = (a ?? '').split(/\\s+/).filter(Boolean)
  console.log('words:', words.length)
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
}
`

const BASE_Y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX

export class CodeNodeDefinition extends NodeDefinition<CodeNode> {
	static type = 'code'
	static validator = CodeNode
	title = 'Code (TS / JS)'
	heading = 'Code'
	icon = <NumberIcon />
	category = 'logic'
	resultKeys = ['lastOutputs', 'logs', 'error'] as const
	getDefault(): CodeNode {
		return {
			type: 'code',
			lang: 'ts',
			code: DEFAULT_CODE,
			inputCount: 2,
			outputCount: 1,
			request: '',
			description: null,
			showAI: false,
			lastOutputs: null,
			logs: null,
			error: null,
		}
	}
	override getWidthPx() {
		return 360
	}
	getBodyHeightPx(_shape: NodeShape, node: CodeNode) {
		const portRows = Math.max(node.inputCount, node.outputCount - 1, 1)
		return (
			NODE_ROW_HEIGHT_PX * (portRows + 1) +
			CODE_HEIGHT_PX +
			(node.showAI ? AI_HEIGHT_PX : 0) +
			RESULT_HEIGHT_PX
		)
	}
	getPorts(_shape: NodeShape, node: CodeNode): Record<string, ShapePort> {
		const ports: Record<string, ShapePort> = {}
		INPUT_NAMES.slice(0, node.inputCount).forEach((id, i) => {
			ports[id] = { id, x: 0, y: BASE_Y + NODE_ROW_HEIGHT_PX * (i + 0.5), terminal: 'end', dataType: 'any' }
		})
		OUTPUT_IDS.slice(0, node.outputCount).forEach((id, i) => {
			ports[id] =
				i === 0
					? { id, x: this.getWidthPx(), y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'any' }
					: { id, x: this.getWidthPx(), y: BASE_Y + NODE_ROW_HEIGHT_PX * (i - 0.5), terminal: 'start', dataType: 'any' }
		})
		return ports
	}
	async execute(shape: NodeShape, node: CodeNode, inputs: InputValues): Promise<ExecutionResult> {
		const args: Record<string, string | null> = {}
		for (const id of INPUT_NAMES.slice(0, node.inputCount)) {
			const v = getInput(inputs, id)
			args[id] = v == null ? null : coerceToText(v)
		}
		const outputIds = OUTPUT_IDS.slice(0, node.outputCount)
		try {
			const { outputs, logs } = await runCode(node.code, node.lang === 'js' ? 'js' : 'ts', args, outputIds)
			updateNode<CodeNode>(this.editor, shape, (n) => ({
				...n,
				lastOutputs: JSON.stringify(outputs),
				logs: logs.join('\n') || null,
				error: null,
			}))
			return Object.fromEntries(outputIds.map((id) => [id, outputs[id] ?? STOP_EXECUTION]))
		} catch (e) {
			const err = e as Error & { logs?: string[] }
			updateNode<CodeNode>(
				this.editor,
				shape,
				(n) => ({ ...n, error: err.message, logs: err.logs?.join('\n') || null }),
				false
			)
			return Object.fromEntries(outputIds.map((id) => [id, STOP_EXECUTION]))
		}
	}
	getOutputInfo(shape: NodeShape, node: CodeNode, inputs: InfoValues): InfoValues {
		const last = node.lastOutputs ? (JSON.parse(node.lastOutputs) as Record<string, string | null>) : {}
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		return Object.fromEntries(
			OUTPUT_IDS.slice(0, node.outputCount).map((id) => [id, { value: last[id] ?? null, isOutOfDate, dataType: 'any' as const }])
		)
	}
	Component = CodeNodeComponent
}

function CodeNodeComponent({ shape, node }: NodeComponentProps<CodeNode>) {
	const editor = useEditor()
	const [busy, setBusy] = useState<string | null>(null)
	const set = (patch: Partial<CodeNode>, outOfDate = true) =>
		updateNode<CodeNode>(editor, shape, (n) => ({ ...n, ...patch }), outOfDate)
	const inputs = INPUT_NAMES.slice(0, node.inputCount)
	const portRows = Math.max(node.inputCount, node.outputCount - 1, 1)

	const aiWrite = async () => {
		if (!node.request.trim()) return
		setBusy('Writing code…')
		try {
			const { text } = await apiGenerateText({
				system:
					'You write one self-contained TypeScript function for a node in a visual workflow. ' +
					`Signature: export default async function run({ ${inputs.join(', ')} }: Record<string, string>) . ` +
					'Inputs are strings (may be null; images are URLs or data URLs; JSON arrives as text). ' +
					(node.outputCount > 1
						? `Return an object with keys ${OUTPUT_IDS.slice(0, node.outputCount).join(', ')}. `
						: 'Return one value (string, number or JSON-serialisable object). ') +
					'No imports. fetch() is available. Return only the code in one ```ts block.',
				prompt: `Task: ${node.request}\n\nCurrent code (change it as needed):\n${node.code}`,
				input: undefined,
				temperature: 0.2,
			})
			set({ code: extractCode(text), lang: 'ts' })
		} catch (e) {
			set({ error: (e as Error).message }, false)
		} finally {
			setBusy(null)
		}
	}

	const aiExplain = async () => {
		setBusy('Explaining…')
		try {
			const { text } = await apiGenerateText({
				prompt: 'Explain what this function does in 2-4 short sentences, then list its inputs and outputs.',
				input: node.code,
				temperature: 0.2,
			})
			set({ description: text }, false)
		} catch (e) {
			set({ error: (e as Error).message }, false)
		} finally {
			setBusy(null)
		}
	}

	let result: string | null = null
	if (node.lastOutputs) {
		const outs = JSON.parse(node.lastOutputs) as Record<string, string | null>
		const ids = Object.keys(outs)
		result = ids.length === 1 ? outs[ids[0]] : ids.map((id) => `${id}: ${outs[id] ?? '—'}`).join('\n')
	}

	return (
		<>
			{Array.from({ length: portRows }, (_, i) => (
				<div key={i} className="CodeNode-portRow">
					{inputs[i] ? (
						<PortRow shapeId={shape.id} portId={inputs[i]} label={inputs[i]} dataType="any" hint="input" />
					) : (
						<NodeRow>{null}</NodeRow>
					)}
					{OUTPUT_IDS[i + 1] && i + 1 < node.outputCount && <span className="CodeNode-outLabel">{OUTPUT_IDS[i + 1]} →</span>}
				</div>
			))}
			<NodeRow>
				<select className="NodeField-select" value={node.lang} onPointerDown={stopEvent} onChange={(e) => set({ lang: e.target.value })}>
					<option value="ts">TypeScript</option>
					<option value="js">JavaScript</option>
				</select>
				<label className="NodeField-inline" title="Number of inputs">
					<span>in</span>
					<select className="NodeField-select" value={node.inputCount} onPointerDown={stopEvent} onChange={(e) => set({ inputCount: Number(e.target.value) })}>
						{[1, 2, 3, 4].map((n) => (
							<option key={n}>{n}</option>
						))}
					</select>
				</label>
				<label className="NodeField-inline" title="Number of outputs">
					<span>out</span>
					<select className="NodeField-select" value={node.outputCount} onPointerDown={stopEvent} onChange={(e) => set({ outputCount: Number(e.target.value) })}>
						{[1, 2, 3].map((n) => (
							<option key={n}>{n}</option>
						))}
					</select>
				</label>
				<button className={'CodeNode-aiToggle' + (node.showAI ? ' is-on' : '')} onPointerDown={stopEvent} onClick={() => set({ showAI: !node.showAI }, false)} title="AI assistant">
					✦ AI
				</button>
			</NodeRow>
			{node.showAI && (
				<div className="NodeField-block" style={{ height: AI_HEIGHT_PX }}>
					<textarea
						className="NodeField-textarea"
						placeholder="Describe what the code should do, e.g. “parse the CSV in a and return the average of column 2”"
						value={node.request}
						onPointerDown={stopEvent}
						onKeyDown={stopEvent}
						onChange={(e) => set({ request: e.target.value }, false)}
					/>
					<div className="CodeNode-aiButtons">
						<TldrawUiButton type="primary" disabled={!!busy || !node.request.trim()} onPointerDown={stopEvent} onClick={aiWrite}>
							Write code
						</TldrawUiButton>
						<TldrawUiButton type="normal" disabled={!!busy} onPointerDown={stopEvent} onClick={aiExplain}>
							Explain
						</TldrawUiButton>
						{busy && <span className="NodeStatus">{busy}</span>}
					</div>
				</div>
			)}
			<div className="NodeField-block NodeGrow" style={{ height: CODE_HEIGHT_PX }}>
				<textarea
					className="NodeField-textarea CodeNode-editor"
					spellCheck={false}
					value={node.code}
					onPointerDown={stopEvent}
					onWheel={stopEvent}
					onKeyDown={(e) => {
						e.stopPropagation()
						if (e.key === 'Tab') {
							e.preventDefault()
							const t = e.currentTarget
							const { selectionStart: a, selectionEnd: b } = t
							const code = node.code.slice(0, a) + '  ' + node.code.slice(b)
							set({ code })
							requestAnimationFrame(() => t.setSelectionRange(a + 2, a + 2))
						}
					}}
					onChange={(e) => set({ code: e.target.value })}
				/>
			</div>
			<NodeTextResult
				text={node.description && !result ? node.description : [result, node.logs && `— log —\n${node.logs}`, node.description && `— about —\n${node.description}`].filter(Boolean).join('\n\n') || null}
				error={node.error}
				empty="Press ▶ Play to run"
				height={RESULT_HEIGHT_PX}
			/>
		</>
	)
}
