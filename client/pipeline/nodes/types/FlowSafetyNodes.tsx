import { useState } from 'react'
import { T, useEditor, useValue } from 'tldraw'
import { isAbortError } from '../../../../shared/abort'
import {
	ASK_ANSWER_TYPES,
	askAnswerType,
	askOutputs,
	AskReply,
	clampRetries,
	clampTimeoutMin,
	clampWaitSec,
	fillInput,
	parseAskOptions,
	previewValue,
	runWithRetries,
	TRY_MAX_RETRIES,
	variableName,
} from '../../../../shared/flowSafety'
import { categoryOf } from '../../../../shared/nodeGroups'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_WIDTH_PX } from '../../constants'
import { currentRunSignal } from '../../execution/executionState'
import { LoopPacer, loopBodyNodes, runLoopBody } from '../../execution/loop'
import { clearNodeRun } from '../../execution/nodeRunState'
import {
	$pendingAsks,
	answerAsk,
	dismissFlowToast,
	getCanvasVariables,
	playNotifySound,
	queueFlowToast,
	setCanvasVariable,
	setPendingAsk,
	showDesktopNotification,
} from '../../flowSafety'
import { Port, ShapePort } from '../../ports/Port'
import { useFieldPortAnchor } from '../../ports/useFieldPortAnchor'
import { sleep } from '../../utils/sleep'
import { NodeShape } from '../NodeShapeUtil'
import { IconAsk, IconBell, IconShield, IconVariable, UiButton, UiCheckbox, UiNumberInput, UiSelect, UiTextArea, UiTextInput } from '../../../ui'
import { PortRow, WireField, WireFieldHeader } from './fields'
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
import '../../flowSafety.css'

/**
 * WP49: flow safety cards. Try / catch (a body that may fail, with retries), Ask user (pause the
 * run for a person's answer), Set / Get variable (canvas-wide named values), Notify (desktop
 * notification + toast). Pure parts: shared/flowSafety.ts.
 */

const BASE_Y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
const portY = (row: number, rowPx: number) => BASE_Y + rowPx * (row + 0.5)
const OUT_Y = NODE_HEADER_HEIGHT_PX / 2

const stopped = () => new DOMException('Stopped', 'AbortError')

/** A right-aligned output row with its own port dot. */
function OutputRow({ shapeId, portId, label, active, title }: { shapeId: NodeShape['id']; portId: string; label: string; active?: boolean; title?: string }) {
	const ref = useFieldPortAnchor<HTMLDivElement>(shapeId, portId)
	return (
		<NodeRow ref={ref} className="NodeRow-right" title={title}>
			<span className={'NodeBranch' + (active ? ' is-active' : '')}>{label}</span>
			<Port shapeId={shapeId} portId={portId} />
		</NodeRow>
	)
}

// ---------------------------------------------------------------------------
// Try / catch
// ---------------------------------------------------------------------------

export type TryCatchNode = T.TypeOf<typeof TryCatchNode>
export const TryCatchNode = T.object({
	type: T.literal('try_catch'),
	retries: T.number,
	waitSec: T.number,
	/** 'ok' | 'error' | null (not run yet). */
	lastOutcome: T.string.nullable(),
	lastValue: T.string.nullable(),
	lastError: T.string.nullable(),
	lastAttempts: T.number.nullable(),
	progress: T.string.nullable(),
})

// Rows: value, try →, ← result, retries, wait, output →, error →, status.
const TRY_ROWS = 8

export class TryCatchNodeDefinition extends NodeDefinition<TryCatchNode> {
	static type = 'try_catch'
	static validator = TryCatchNode
	title = 'Try / catch'
	heading = 'Try / catch'
	icon = <IconShield />
	category = categoryOf('try_catch')
	override defaultWidthPx = 340
	resultKeys = ['lastOutcome', 'lastValue', 'lastError', 'lastAttempts', 'progress'] as const
	getDefault(): TryCatchNode {
		return { type: 'try_catch', retries: 0, waitSec: 1, lastOutcome: null, lastValue: null, lastError: null, lastAttempts: null, progress: null }
	}
	getBodyHeightPx(shape: NodeShape) {
		return getNodeRowHeightPx(shape.props.fontSize) * TRY_ROWS
	}
	getPorts(shape: NodeShape, node: TryCatchNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const width = this.getWidthPx(shape, node)
		return {
			input: { id: 'input', x: 0, y: portY(0, rowPx), terminal: 'end', dataType: 'any' },
			// The body: "body" → (cards that may fail) → back into "result".
			body: { id: 'body', x: width, y: portY(1, rowPx), terminal: 'start', dataType: 'text' },
			result: { id: 'result', x: 0, y: portY(2, rowPx), terminal: 'end', dataType: 'any', feedback: true },
			output: { id: 'output', x: width, y: portY(5, rowPx), terminal: 'start', dataType: 'text' },
			error: { id: 'error', x: width, y: portY(6, rowPx), terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: TryCatchNode, inputs: InputValues): Promise<ExecutionResult> {
		const set = (patch: Partial<TryCatchNode>, outOfDate = false) =>
			updateNode<TryCatchNode>(this.editor, this.editor.getShape<NodeShape>(shape.id) ?? shape, (n) => ({ ...n, ...patch }), outOfDate)
		const pacer = new LoopPacer(this.editor)
		const signal = currentRunSignal(this.editor)
		const bodyNodes = loopBodyNodes(this.editor, shape.id, 'body')
		const retries = clampRetries(node.retries)
		const input = coerceToText(getInput(inputs, 'input'))
		set({ progress: 'trying', lastError: null })
		try {
			const outcome = await runWithRetries<string | null>({
				retries,
				waitSec: clampWaitSec(node.waitSec),
				sleep: (ms) => sleep(ms, signal),
				onRetry: (n) => set({ progress: `retry ${n - 1} of ${retries}` }),
				attempt: async () => {
					if (pacer.stopped()) throw stopped()
					// Only this attempt's failure counts (and shows) in the body.
					for (const id of bodyNodes) clearNodeRun(this.editor, id)
					const result = await runLoopBody(this.editor, shape.id, 'body', 'result', input)
					if (pacer.stopped()) throw stopped()
					return result.error ? { ok: false, error: result.error } : { ok: true, value: result.value }
				},
			})
			const tries = outcome.attempts === 1 ? '1 attempt' : `${outcome.attempts} attempts`
			if (outcome.ok) {
				const value = outcome.value ?? ''
				set({ lastOutcome: 'ok', lastValue: value, lastError: null, lastAttempts: outcome.attempts, progress: `ok after ${tries}` }, true)
				return { body: STOP_EXECUTION, output: value, error: STOP_EXECUTION }
			}
			const message = outcome.error || 'A card in the body failed'
			set({ lastOutcome: 'error', lastValue: null, lastError: message, lastAttempts: outcome.attempts, progress: `failed after ${tries}` }, true)
			return { body: STOP_EXECUTION, output: STOP_EXECUTION, error: message }
		} catch (e) {
			if (isAbortError(e) || pacer.stopped()) {
				set({ progress: 'stopped' })
				throw isAbortError(e) ? e : stopped()
			}
			throw e
		}
	}
	getOutputInfo(shape: NodeShape, node: TryCatchNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		return {
			// Outside a run, the body port carries nothing.
			body: { value: STOP_EXECUTION, isOutOfDate, dataType: 'text' },
			output: { value: node.lastOutcome === 'error' ? STOP_EXECUTION : node.lastValue, isOutOfDate, dataType: 'text' },
			error: { value: node.lastOutcome === 'ok' ? STOP_EXECUTION : node.lastError, isOutOfDate, dataType: 'text' },
		}
	}
	Component = TryCatchComponent
}

function TryCatchComponent({ shape, node }: NodeComponentProps<TryCatchNode>) {
	const editor = useEditor()
	const set = (patch: Partial<TryCatchNode>) => updateNode<TryCatchNode>(editor, shape, (n) => ({ ...n, ...patch }))
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label="Value" dataType="any" hint="fed into the body" />
			<OutputRow shapeId={shape.id} portId="body" label="try →" active title="Wire the cards that may fail here, and the end of them back into Result." />
			<PortRow shapeId={shape.id} portId="result" label="← Result" dataType="any" hint="end of the body" />
			<WireField shapeId={shape.id} fieldKey="retries" label="Retries" dataType="number" hint={`0 – ${TRY_MAX_RETRIES}`}>
				<UiNumberInput min={0} max={TRY_MAX_RETRIES} step={1} value={node.retries} onChange={(v) => set({ retries: clampRetries(v) })} />
			</WireField>
			<WireField shapeId={shape.id} fieldKey="waitSec" label="Wait (s)" dataType="number" hint="between retries">
				<UiNumberInput min={0} step={0.5} value={node.waitSec} onChange={(v) => set({ waitSec: clampWaitSec(v) })} />
			</WireField>
			<OutputRow shapeId={shape.id} portId="output" label="output (ok) →" active={node.lastOutcome === 'ok'} />
			<OutputRow shapeId={shape.id} portId="error" label="error →" active={node.lastOutcome === 'error'} />
			<NodeRow className="TryCatch-status" title={node.lastError ?? node.progress ?? ''}>
				<span className={'NodeHint' + (node.lastOutcome === 'error' ? ' TryCatch-failed' : '')}>
					{node.progress ?? 'Not run yet'}
					{node.lastOutcome === 'error' && node.lastError ? ` · ${previewValue(node.lastError, 48)}` : ''}
				</span>
			</NodeRow>
		</>
	)
}

// ---------------------------------------------------------------------------
// Ask user
// ---------------------------------------------------------------------------

export type AskUserNode = T.TypeOf<typeof AskUserNode>
export const AskUserNode = T.object({
	type: T.literal('ask_user'),
	question: T.string,
	/** 'approve' | 'choose' | 'text'. */
	answerType: T.string,
	/** For 'choose': one option per line. */
	options: T.string,
	/** Minutes; 0 = wait forever. */
	timeoutMin: T.number,
	lastQuestion: T.string.nullable(),
	lastAnswer: T.string.nullable(),
	lastRejected: T.boolean.nullable(),
	error: T.string.nullable(),
})

const ASK_QUESTION_PX = 52
const ASK_OPTIONS_PX = 52
const ASK_AREA_PX = 92

const ASK_TYPE_OPTIONS = ASK_ANSWER_TYPES.map((t) => ({ value: t.id as string, label: t.label }))

export class AskUserNodeDefinition extends NodeDefinition<AskUserNode> {
	static type = 'ask_user'
	static validator = AskUserNode
	title = 'Ask user'
	heading = 'Ask user'
	icon = <IconAsk />
	category = categoryOf('ask_user')
	override defaultWidthPx = 360
	resultKeys = ['lastQuestion', 'lastAnswer', 'lastRejected', 'error'] as const
	getDefault(): AskUserNode {
		return {
			type: 'ask_user',
			question: 'Continue with {{input}}?',
			answerType: 'approve',
			options: '',
			timeoutMin: 0,
			lastQuestion: null,
			lastAnswer: null,
			lastRejected: null,
			error: null,
		}
	}
	getBodyHeightPx(shape: NodeShape, node: AskUserNode) {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const choose = askAnswerType(node.answerType) === 'choose'
		// Rows: input, question header, answer type, (options header), timeout, answer, rejected.
		const rows = 6 + (choose ? 1 : 0)
		return rowPx * rows + ASK_QUESTION_PX + (choose ? ASK_OPTIONS_PX : 0) + ASK_AREA_PX
	}
	getPorts(shape: NodeShape, node: AskUserNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const width = this.getWidthPx(shape, node)
		const bottom = this.getBodyHeightPx(shape, node) + BASE_Y
		return {
			input: { id: 'input', x: 0, y: portY(0, rowPx), terminal: 'end', dataType: 'any' },
			answer: { id: 'answer', x: width, y: bottom - rowPx * 1.5, terminal: 'start', dataType: 'text' },
			rejected: { id: 'rejected', x: width, y: bottom - rowPx * 0.5, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: AskUserNode, inputs: InputValues): Promise<ExecutionResult> {
		const editor = this.editor
		const set = (patch: Partial<AskUserNode>, outOfDate = false) =>
			updateNode<AskUserNode>(editor, editor.getShape<NodeShape>(shape.id) ?? shape, (n) => ({ ...n, ...patch }), outOfDate)
		const input = coerceToText(getInput(inputs, 'input'))
		const question = fillInput(node.question, input).trim() || 'Continue?'
		const answerType = askAnswerType(node.answerType)
		const options = parseAskOptions(node.options)
		if (answerType === 'choose' && options.length === 0) {
			const message = 'Add the options to choose from, one per line.'
			set({ error: message })
			throw new Error(message)
		}
		const timeoutMin = clampTimeoutMin(node.timeoutMin)
		const signal = currentRunSignal(editor)
		if (signal?.aborted) throw stopped()
		set({ lastQuestion: question, lastAnswer: null, lastRejected: null, error: null })
		const toastKey = queueFlowToast(editor, {
			title: 'A card is waiting for your answer',
			description: question,
			severity: 'info',
			keepOpen: true,
			shapeId: shape.id,
		})
		try {
			const reply = await new Promise<AskReply>((resolve, reject) => {
				let timer: ReturnType<typeof setTimeout> | undefined
				const done = () => {
					if (timer) clearTimeout(timer)
					signal?.removeEventListener('abort', onAbort)
				}
				const onAbort = () => {
					done()
					reject(stopped())
				}
				signal?.addEventListener('abort', onAbort, { once: true })
				if (timeoutMin > 0) {
					timer = setTimeout(() => {
						done()
						reject(new Error(`No answer within ${timeoutMin} min (Timeout field). Run the card again to ask again.`))
					}, timeoutMin * 60_000)
				}
				setPendingAsk(editor, shape.id, {
					question,
					answerType,
					options,
					deadline: timeoutMin > 0 ? Date.now() + timeoutMin * 60_000 : null,
					toastKey,
					answer: (r) => {
						done()
						resolve(r)
					},
				})
			})
			const out = askOutputs(reply, input)
			set({ lastAnswer: out.answer ?? out.rejected, lastRejected: reply.kind === 'reject' }, true)
			return { answer: out.answer ?? STOP_EXECUTION, rejected: out.rejected ?? STOP_EXECUTION }
		} catch (e) {
			if (!isAbortError(e)) set({ error: (e as Error).message })
			throw e
		} finally {
			setPendingAsk(editor, shape.id, null)
			dismissFlowToast(editor, toastKey)
		}
	}
	getOutputInfo(shape: NodeShape, node: AskUserNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		return {
			answer: { value: node.lastRejected === true ? STOP_EXECUTION : node.lastAnswer, isOutOfDate, dataType: 'text' },
			rejected: { value: node.lastRejected === true ? node.lastAnswer : STOP_EXECUTION, isOutOfDate, dataType: 'text' },
		}
	}
	Component = AskUserComponent
}

function AskUserComponent({ shape, node }: NodeComponentProps<AskUserNode>) {
	const editor = useEditor()
	const set = (patch: Partial<AskUserNode>) => updateNode<AskUserNode>(editor, shape, (n) => ({ ...n, ...patch }))
	const answerType = askAnswerType(node.answerType)
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label="Input" dataType="any" hint="optional: {{input}} in the question" />
			<WireFieldHeader shapeId={shape.id} fieldKey="question" label="Question" />
			<div className="NodeField-block" style={{ height: ASK_QUESTION_PX }}>
				<UiTextArea className="NodeField-textarea" placeholder="e.g. Send this reply? {{input}}" value={node.question} onChange={(question) => set({ question })} />
			</div>
			<WireField shapeId={shape.id} fieldKey="answerType" label="Answer">
				<UiSelect value={answerType as string} options={ASK_TYPE_OPTIONS} onChange={(value) => set({ answerType: value })} />
			</WireField>
			{answerType === 'choose' && (
				<>
					<WireFieldHeader shapeId={shape.id} fieldKey="options" label="Options" hint="one per line" />
					<div className="NodeField-block" style={{ height: ASK_OPTIONS_PX }}>
						<UiTextArea className="NodeField-textarea" placeholder={'Option A\nOption B'} value={node.options} onChange={(options) => set({ options })} />
					</div>
				</>
			)}
			<WireField shapeId={shape.id} fieldKey="timeoutMin" label="Timeout (min)" dataType="number" hint="0 = wait forever">
				<UiNumberInput min={0} step={1} value={node.timeoutMin} onChange={(v) => set({ timeoutMin: clampTimeoutMin(v) })} />
			</WireField>
			<AskArea shape={shape} node={node} />
			<OutputRow shapeId={shape.id} portId="answer" label="answer →" active={node.lastAnswer != null && node.lastRejected === false} />
			<OutputRow shapeId={shape.id} portId="rejected" label="rejected →" active={node.lastRejected === true} />
		</>
	)
}

/** The open question with its answer controls, or the last answer. */
function AskArea({ shape, node }: { shape: NodeShape; node: AskUserNode }) {
	const editor = useEditor()
	const pending = useValue('pending ask', () => $pendingAsks.get(editor)[shape.id], [editor, shape.id])
	const [text, setText] = useState('')
	const reply = (r: AskReply) => {
		answerAsk(editor, shape.id, r)
		setText('')
	}
	return (
		<div className={'AskUser-area' + (pending ? ' is-waiting' : '')} style={{ height: ASK_AREA_PX }}>
			{pending ? (
				<>
					<div className="AskUser-question" title={pending.question}>
						{pending.question}
					</div>
					<div className="AskUser-actions">
						{pending.answerType === 'approve' && (
							<UiButton size="sm" variant="primary" label="Approve" onClick={() => reply({ kind: 'approve' })} />
						)}
						{pending.answerType === 'choose' &&
							pending.options.map((option) => (
								<UiButton key={option} size="sm" variant="primary" label={option} onClick={() => reply({ kind: 'choose', value: option })} />
							))}
						{pending.answerType === 'text' && (
							<>
								<UiTextInput
									className="AskUser-input"
									placeholder="Type your answer"
									value={text}
									onChange={setText}
									onCommit={() => reply({ kind: 'text', value: text })}
								/>
								<UiButton size="sm" variant="primary" label="Send" onClick={() => reply({ kind: 'text', value: text })} />
							</>
						)}
						<UiButton size="sm" variant="low" label="Reject" onClick={() => reply({ kind: 'reject' })} />
					</div>
				</>
			) : (
				<div className="AskUser-last">
					{node.error ? (
						<span className="NodeHint TryCatch-failed">{node.error}</span>
					) : node.lastAnswer != null ? (
						<span className="NodeHint">
							{node.lastRejected ? 'Rejected' : 'Answer'}: <strong>{previewValue(node.lastAnswer, 80)}</strong>
						</span>
					) : (
						<span className="NodeHint">Run to ask. The question shows here and as a notice.</span>
					)}
				</div>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Set variable / Get variable
// ---------------------------------------------------------------------------

export type SetVariableNode = T.TypeOf<typeof SetVariableNode>
export const SetVariableNode = T.object({
	type: T.literal('set_variable'),
	name: T.string,
	error: T.string.nullable(),
})

export class SetVariableNodeDefinition extends NodeDefinition<SetVariableNode> {
	static type = 'set_variable'
	static validator = SetVariableNode
	title = 'Set variable'
	heading = 'Set variable'
	icon = <IconVariable />
	category = categoryOf('set_variable')
	resultKeys = ['error'] as const
	getDefault(): SetVariableNode {
		return { type: 'set_variable', name: 'myVar', error: null }
	}
	getBodyHeightPx(shape: NodeShape) {
		return getNodeRowHeightPx(shape.props.fontSize) * 3
	}
	getPorts(shape: NodeShape): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return {
			value: { id: 'value', x: 0, y: portY(0, rowPx), terminal: 'end', dataType: 'any' },
			output: { id: 'output', x: NODE_WIDTH_PX, y: OUT_Y, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: SetVariableNode, inputs: InputValues): Promise<ExecutionResult> {
		const name = variableName(node.name)
		const set = (patch: Partial<SetVariableNode>) =>
			updateNode<SetVariableNode>(this.editor, this.editor.getShape<NodeShape>(shape.id) ?? shape, (n) => ({ ...n, ...patch }), false)
		if (!name) {
			set({ error: 'Give the variable a name.' })
			throw new Error('Give the variable a name.')
		}
		const value = coerceToText(getInput(inputs, 'value'))
		setCanvasVariable(this.editor, name, value)
		set({ error: null })
		return { output: value }
	}
	getOutputInfo(shape: NodeShape, node: SetVariableNode, inputs: InfoValues): InfoValues {
		const value = inputs.value
		return {
			output: {
				value: value && !Array.isArray(value.value) ? (value.value as string | null) : null,
				isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
				dataType: 'text',
			},
		}
	}
	Component = SetVariableComponent
}

/** The variable's current value, live from the canvas. */
function CurrentValueRow({ name }: { name: string }) {
	const editor = useEditor()
	const value = useValue('variable value', () => getCanvasVariables(editor)[variableName(name)], [editor, name])
	return (
		<NodeRow className="Variable-current" title={value ?? ''}>
			<span className="NodeHint">{value == null ? 'not set yet' : <>now: <strong>{previewValue(value, 40) || '(empty)'}</strong></>}</span>
		</NodeRow>
	)
}

function SetVariableComponent({ shape, node }: NodeComponentProps<SetVariableNode>) {
	const editor = useEditor()
	const set = (patch: Partial<SetVariableNode>) => updateNode<SetVariableNode>(editor, shape, (n) => ({ ...n, ...patch }))
	return (
		<>
			<PortRow shapeId={shape.id} portId="value" label="Value" dataType="any" />
			<WireField shapeId={shape.id} fieldKey="name" label="Name">
				<UiTextInput mono placeholder="myVar" value={node.name} onChange={(name) => set({ name })} />
			</WireField>
			<CurrentValueRow name={node.name} />
		</>
	)
}

export type GetVariableNode = T.TypeOf<typeof GetVariableNode>
export const GetVariableNode = T.object({
	type: T.literal('get_variable'),
	name: T.string,
	error: T.string.nullable(),
})

export class GetVariableNodeDefinition extends NodeDefinition<GetVariableNode> {
	static type = 'get_variable'
	static validator = GetVariableNode
	title = 'Get variable'
	heading = 'Get variable'
	icon = <IconVariable />
	category = categoryOf('get_variable')
	resultKeys = ['error'] as const
	getDefault(): GetVariableNode {
		return { type: 'get_variable', name: 'myVar', error: null }
	}
	getBodyHeightPx(shape: NodeShape) {
		return getNodeRowHeightPx(shape.props.fontSize) * 3
	}
	getPorts(shape: NodeShape): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return {
			after: { id: 'after', x: 0, y: portY(0, rowPx), terminal: 'end', dataType: 'any' },
			output: { id: 'output', x: NODE_WIDTH_PX, y: OUT_Y, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: GetVariableNode): Promise<ExecutionResult> {
		const name = variableName(node.name)
		const set = (patch: Partial<GetVariableNode>) =>
			updateNode<GetVariableNode>(this.editor, this.editor.getShape<NodeShape>(shape.id) ?? shape, (n) => ({ ...n, ...patch }), false)
		if (!name) {
			set({ error: 'Type the name of the variable to read.' })
			throw new Error('Type the name of the variable to read.')
		}
		const value = getCanvasVariables(this.editor)[name]
		if (value === undefined) {
			const message = `No variable named "${name}" yet. A Set variable card makes it when it runs.`
			set({ error: message })
			throw new Error(message)
		}
		set({ error: null })
		return { output: value }
	}
	getOutputInfo(shape: NodeShape, node: GetVariableNode, inputs: InfoValues): InfoValues {
		const value = getCanvasVariables(this.editor)[variableName(node.name)]
		return {
			output: { value: value ?? null, isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate, dataType: 'text' },
		}
	}
	Component = GetVariableComponent
}

function GetVariableComponent({ shape, node }: NodeComponentProps<GetVariableNode>) {
	const editor = useEditor()
	const set = (patch: Partial<GetVariableNode>) => updateNode<GetVariableNode>(editor, shape, (n) => ({ ...n, ...patch }))
	const names = useValue('variable names', () => Object.keys(getCanvasVariables(editor)).sort(), [editor])
	return (
		<>
			<PortRow shapeId={shape.id} portId="after" label="After" dataType="any" hint="optional: run after this" />
			<WireField shapeId={shape.id} fieldKey="name" label="Name">
				<UiTextInput
					mono
					placeholder="myVar"
					title={names.length ? `Variables on this canvas: ${names.join(', ')}` : 'No variables yet'}
					value={node.name}
					onChange={(name) => set({ name })}
				/>
			</WireField>
			<CurrentValueRow name={node.name} />
		</>
	)
}

// ---------------------------------------------------------------------------
// Notify
// ---------------------------------------------------------------------------

export type NotifyNode = T.TypeOf<typeof NotifyNode>
export const NotifyNode = T.object({
	type: T.literal('notify'),
	title: T.string,
	message: T.string,
	sound: T.boolean,
	lastShown: T.string.nullable(),
})

const NOTIFY_MESSAGE_PX = 52

export class NotifyNodeDefinition extends NodeDefinition<NotifyNode> {
	static type = 'notify'
	static validator = NotifyNode
	title = 'Notify'
	heading = 'Notify'
	icon = <IconBell />
	category = categoryOf('notify')
	override defaultWidthPx = 320
	resultKeys = ['lastShown'] as const
	getDefault(): NotifyNode {
		return { type: 'notify', title: 'Flow finished', message: '{{input}}', sound: true, lastShown: null }
	}
	getBodyHeightPx(shape: NodeShape) {
		// Rows: input, title, message header, sound, last shown + the message box.
		return getNodeRowHeightPx(shape.props.fontSize) * 5 + NOTIFY_MESSAGE_PX
	}
	getPorts(shape: NodeShape, node: NotifyNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return {
			input: { id: 'input', x: 0, y: portY(0, rowPx), terminal: 'end', dataType: 'any' },
			output: { id: 'output', x: this.getWidthPx(shape, node), y: OUT_Y, terminal: 'start', dataType: 'any' },
		}
	}
	async execute(shape: NodeShape, node: NotifyNode, inputs: InputValues): Promise<ExecutionResult> {
		const raw = getInput(inputs, 'input')
		const input = coerceToText(raw)
		const title = fillInput(node.title, input).trim() || 'Notice'
		const message = fillInput(node.message, input).trim()
		queueFlowToast(this.editor, { title, description: message || undefined, severity: 'info', shapeId: shape.id })
		// Not awaited: a first-time permission prompt must not hold up the run.
		void showDesktopNotification(title, message, node.sound)
		if (node.sound) playNotifySound()
		updateNode<NotifyNode>(
			this.editor,
			this.editor.getShape<NodeShape>(shape.id) ?? shape,
			(n) => ({ ...n, lastShown: `${new Date().toLocaleTimeString()} · ${previewValue(message || title, 60)}` }),
			false
		)
		return { output: raw ?? null }
	}
	getOutputInfo(shape: NodeShape, _node: NotifyNode, inputs: InfoValues): InfoValues {
		const value = inputs.input
		return {
			output: {
				value: value && !Array.isArray(value.value) ? (value.value as string | null) : null,
				isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
				dataType: value?.dataType ?? 'any',
			},
		}
	}
	Component = NotifyComponent
}

function NotifyComponent({ shape, node }: NodeComponentProps<NotifyNode>) {
	const editor = useEditor()
	const set = (patch: Partial<NotifyNode>) => updateNode<NotifyNode>(editor, shape, (n) => ({ ...n, ...patch }))
	return (
		<>
			<PortRow shapeId={shape.id} portId="input" label="Input" dataType="any" hint="passed through" />
			<WireField shapeId={shape.id} fieldKey="title" label="Title">
				<UiTextInput placeholder="Flow finished" value={node.title} onChange={(title) => set({ title })} />
			</WireField>
			<WireFieldHeader shapeId={shape.id} fieldKey="message" label="Message" hint="{{input}} allowed" />
			<div className="NodeField-block" style={{ height: NOTIFY_MESSAGE_PX }}>
				<UiTextArea className="NodeField-textarea" placeholder="{{input}}" value={node.message} onChange={(message) => set({ message })} />
			</div>
			<WireField shapeId={shape.id} fieldKey="sound" label="Sound">
				<UiCheckbox checked={node.sound} label="Play a sound" onChange={(sound) => set({ sound })} />
			</WireField>
			<NodeRow title={node.lastShown ?? ''}>
				<span className="NodeHint">{node.lastShown ? `Shown ${node.lastShown}` : 'Shows a desktop notification and a notice in the app'}</span>
			</NodeRow>
		</>
	)
}
