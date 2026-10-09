import { categoryOf } from '../../../../shared/nodeGroups'
import {
	clampCodeCount,
	codeInputId,
	codeInputNames,
	codeOutputId,
	codeOutputNames,
	MAX_CODE_PORTS,
} from '../../../../shared/codePorts'
import { DEFAULT_PYTHON } from '../../../../shared/pythonSource'
import { useState } from 'react'
import { T, TldrawUiButton, useEditor } from 'tldraw'
import { apiGenerateText } from '../../api/pipelineApi'
import { extractCode, runCode } from '../../codeRunner'
import { CodeArea, TextAreaField } from '../../editors/CodeArea'
import { runPython } from '../../pythonRunner'
import { NumberIcon } from '../../components/icons/NumberIcon'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_ROW_HEIGHT_PX } from '../../constants'
import { Port } from '../../ports/Port'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
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

/**
 * A node that runs your own TypeScript / JavaScript / Python function.
 * The number of inputs and outputs (1–20 each) and their names are set on the
 * card; the names become the variables the code reads and returns.
 */
export type CodeNode = T.TypeOf<typeof CodeNode>
export const CodeNode = T.object({
	type: T.literal('code'),
	lang: T.string,
	code: T.string,
	inputCount: T.number,
	outputCount: T.number,
	inputNames: T.arrayOf(T.string).optional(),
	outputNames: T.arrayOf(T.string).optional(),
	request: T.string,
	description: T.string.nullable(),
	showAI: T.boolean,
	lastOutputs: T.string.nullable(),
	logs: T.string.nullable(),
	error: T.string.nullable(),
})

const CODE_HEIGHT_PX = 200
const AI_HEIGHT_PX = 120
const BASE_Y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX

const inputId = codeInputId
const outputId = codeOutputId

export const DEFAULT_CODE = `// Read the inputs by name (they match the port names on the card).
// Return one value, or { output, out2, … } when the node has several outputs.
export default async function run({ a, b }: Record<string, string>) {
  const words = (a ?? '').split(/\\s+/).filter(Boolean)
  console.log('words:', words.length)
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
}
`

export class CodeNodeDefinition extends NodeDefinition<CodeNode> {
	static type = 'code'
	static validator = CodeNode
	title = 'Code'
	heading = 'Code'
	icon = <NumberIcon />
	category = categoryOf('code')
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
	private inCount(node: CodeNode) {
		return clampCodeCount(node.inputCount)
	}
	private outCount(node: CodeNode) {
		return clampCodeCount(node.outputCount)
	}
	getBodyHeightPx(_shape: NodeShape, node: CodeNode) {
		const portRows = Math.max(this.inCount(node), this.outCount(node) - 1, 1)
		return NODE_ROW_HEIGHT_PX * (portRows + 1) + CODE_HEIGHT_PX + (node.showAI ? AI_HEIGHT_PX : 0)
	}
	getPorts(_shape: NodeShape, node: CodeNode): Record<string, ShapePort> {
		const ports: Record<string, ShapePort> = {}
		for (let i = 0; i < this.inCount(node); i++) {
			const id = inputId(i)
			ports[id] = { id, x: 0, y: BASE_Y + NODE_ROW_HEIGHT_PX * (i + 0.5), terminal: 'end', dataType: 'any' }
		}
		for (let i = 0; i < this.outCount(node); i++) {
			const id = outputId(i)
			ports[id] =
				i === 0
					? { id, x: this.getWidthPx(), y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'any' }
					: { id, x: this.getWidthPx(), y: BASE_Y + NODE_ROW_HEIGHT_PX * (i - 0.5), terminal: 'start', dataType: 'any' }
		}
		return ports
	}
	async execute(shape: NodeShape, node: CodeNode, inputs: InputValues): Promise<ExecutionResult> {
		const inCount = this.inCount(node)
		const outCount = this.outCount(node)
		const inNames = codeInputNames(inCount, node.inputNames)
		const outNames = codeOutputNames(outCount, node.outputNames)
		const args: Record<string, string | null> = {}
		for (let i = 0; i < inCount; i++) {
			const v = getInput(inputs, inputId(i))
			args[inNames[i]] = v == null ? null : coerceToText(v)
		}
		const portIds = Array.from({ length: outCount }, (_, i) => outputId(i))
		try {
			const { outputs, logs } =
				node.lang === 'py'
					? await runPython(node.code, args, outNames)
					: await runCode(node.code, node.lang === 'js' ? 'js' : 'ts', args, outNames)
			// Runners key results by output NAME; map them back onto stable port ids.
			const byPort = Object.fromEntries(portIds.map((id, i) => [id, outputs[outNames[i]] ?? null]))
			updateNode<CodeNode>(this.editor, shape, (n) => ({
				...n,
				lastOutputs: JSON.stringify(byPort),
				logs: logs.join('\n') || null,
				error: null,
			}))
			return Object.fromEntries(portIds.map((id) => [id, byPort[id] ?? STOP_EXECUTION]))
		} catch (e) {
			const err = e as Error & { logs?: string[] }
			updateNode<CodeNode>(
				this.editor,
				shape,
				(n) => ({ ...n, error: err.message, logs: err.logs?.join('\n') || null }),
				false
			)
			return Object.fromEntries(portIds.map((id) => [id, STOP_EXECUTION]))
		}
	}
	getOutputInfo(shape: NodeShape, node: CodeNode, inputs: InfoValues): InfoValues {
		const last = node.lastOutputs ? (JSON.parse(node.lastOutputs) as Record<string, string | null>) : {}
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		const outCount = this.outCount(node)
		return Object.fromEntries(
			Array.from({ length: outCount }, (_, i) => {
				const id = outputId(i)
				return [id, { value: last[id] ?? null, isOutOfDate, dataType: 'any' as const }]
			})
		)
	}
	Component = CodeNodeComponent
}

function CodeNodeComponent({ shape, node }: NodeComponentProps<CodeNode>) {
	const editor = useEditor()
	const [busy, setBusy] = useState<string | null>(null)
	const set = (patch: Partial<CodeNode>, outOfDate = true) =>
		updateNode<CodeNode>(editor, shape, (n) => ({ ...n, ...patch }), outOfDate)
	const inCount = clampCodeCount(node.inputCount)
	const outCount = clampCodeCount(node.outputCount)
	const inNames = codeInputNames(inCount, node.inputNames)
	const outNames = codeOutputNames(outCount, node.outputNames)
	const portRows = Math.max(inCount, outCount - 1, 1)

	const setInputName = (i: number, name: string) => {
		const next = Array.from({ length: inCount }, (_, j) => node.inputNames?.[j] ?? '')
		next[i] = name
		set({ inputNames: next })
	}
	const setOutputName = (i: number, name: string) => {
		const next = Array.from({ length: outCount }, (_, j) => node.outputNames?.[j] ?? '')
		next[i] = name
		set({ outputNames: next })
	}

	const aiWrite = async () => {
		if (!node.request.trim()) return
		setBusy('Writing code…')
		try {
			const python = node.lang === 'py'
			const { text } = await apiGenerateText({
				system: python
					? 'You write Python for a node in a visual workflow. ' +
						`Read strings from inputs["${inNames.join('"], inputs["')}"]. ` +
						`Assign ${outNames.join(', ')}. ` +
						'print() is the log. No imports. Return only the code in one ```py block.'
					: 'You write one self-contained TypeScript function for a node in a visual workflow. ' +
						`Signature: export default async function run({ ${inNames.join(', ')} }: Record<string, string>) . ` +
						'Inputs are strings (may be null; images are URLs or data URLs; JSON arrives as text). ' +
						(outCount > 1
							? `Return an object with keys ${outNames.join(', ')}. `
							: 'Return one value (string, number or JSON-serialisable object). ') +
						'No imports. fetch() is available. Return only the code in one ```ts block.',
				prompt: `Task: ${node.request}\n\nCurrent code (change it as needed):\n${node.code}`,
				input: undefined,
				temperature: 0.2,
			})
			set({ code: extractCode(text), lang: python ? 'py' : 'ts' })
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
		result = ids.length === 1 ? outs[ids[0]] : ids.map((id) => `${outNames[ids.indexOf(id)] ?? id}: ${outs[id] ?? '—'}`).join('\n')
	}

	return (
		<>
			{Array.from({ length: portRows }, (_, i) => (
				<div key={i} className="CodeNode-portRow">
					{i < inCount ? (
						<div className="CodeNode-portEdit">
							<Port shapeId={shape.id} portId={inputId(i)} />
							<span className="CodeNode-outLabel CodeNode-portName">{inNames[i]}</span>
							<input
								className="NodeField-input CodeNode-name"
								title="Variable name for this input"
								value={node.inputNames?.[i] ?? ''}
								placeholder={inNames[i]}
								onPointerDown={stopEvent}
								onKeyDown={stopEvent}
								onChange={(e) => setInputName(i, e.target.value)}
							/>
						</div>
					) : (
						<span className="CodeNode-portEdit" />
					)}
					{i + 1 < outCount && (
						<div className="CodeNode-portEdit CodeNode-portEdit-out">
							<input
								className="NodeField-input CodeNode-name"
								title="Key for this output"
								value={node.outputNames?.[i + 1] ?? ''}
								placeholder={outNames[i + 1]}
								onPointerDown={stopEvent}
								onKeyDown={stopEvent}
								onChange={(e) => setOutputName(i + 1, e.target.value)}
							/>
							<span className="CodeNode-outLabel CodeNode-portName">{outNames[i + 1]} →</span>
							<Port shapeId={shape.id} portId={outputId(i + 1)} />
						</div>
					)}
				</div>
			))}
			<NodeRow>
				<NodeSelect
					className="NodeField-select"
					value={node.lang}
					onPointerDown={stopEvent}
					onChange={(e) => {
						const lang = e.target.value
						const patch: Partial<CodeNode> = { lang }
						if (lang === 'py' && node.code === DEFAULT_CODE) patch.code = DEFAULT_PYTHON
						if (lang !== 'py' && node.code === DEFAULT_PYTHON) patch.code = DEFAULT_CODE
						set(patch)
					}}
				>
					<option value="ts">TypeScript</option>
					<option value="js">JavaScript</option>
					<option value="py">Python</option>
				</NodeSelect>
				<label className="NodeField-inline" title="Number of inputs (1–20)">
					<span>in</span>
					<input
						className="NodeField-input CodeNode-count"
						type="number"
						min={1}
						max={MAX_CODE_PORTS}
						value={inCount}
						onPointerDown={stopEvent}
						onKeyDown={stopEvent}
						onChange={(e) => set({ inputCount: Math.max(1, Math.min(MAX_CODE_PORTS, Number(e.target.value) || 1)) })}
					/>
				</label>
				<label className="NodeField-inline" title="Number of outputs (1–20)">
					<span>out</span>
					<input
						className="NodeField-input CodeNode-count"
						type="number"
						min={1}
						max={MAX_CODE_PORTS}
						value={outCount}
						onPointerDown={stopEvent}
						onKeyDown={stopEvent}
						onChange={(e) => set({ outputCount: Math.max(1, Math.min(MAX_CODE_PORTS, Number(e.target.value) || 1)) })}
					/>
				</label>
				<button className={'CodeNode-aiToggle' + (node.showAI ? ' is-on' : '')} onPointerDown={stopEvent} onClick={() => set({ showAI: !node.showAI }, false)} title="AI assistant">
					✦ AI
				</button>
			</NodeRow>
			{node.showAI && (
				<div className="NodeField-block" style={{ height: AI_HEIGHT_PX }}>
					<TextAreaField
						title="Code request"
						height={72}
						placeholder="Describe what the code should do, e.g. parse the CSV in a and return the average of column 2"
						value={node.request}
						onChange={(request) => set({ request }, false)}
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
			<CodeArea value={node.code} lang={node.lang} height={CODE_HEIGHT_PX} onChange={(code) => set({ code })} />
		</>
	)
}
