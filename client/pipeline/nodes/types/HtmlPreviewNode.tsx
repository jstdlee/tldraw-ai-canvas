import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { categoryOf } from '../../../../shared/nodeGroups'
import {
	assembleHtmlDocument,
	bridgePayloadToJson,
	buildFormBridgeScript,
	parseBridgePayload,
	valueFromSubmissionJson,
} from '../../../../shared/htmlPreview'
import { Editor, T, TLShapeId, useEditor, useValue } from 'tldraw'
import { HtmlFormIcon } from '../../components/icons/HtmlFormIcon'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX } from '../../constants'
import { currentRunSignal, executionState, startExecution } from '../../execution/executionState'
import { getNodeRun, setNodeRun } from '../../execution/nodeRunState'
import { Port as PortDot, ShapePort } from '../../ports/Port'
import { useFieldPortAnchor } from '../../ports/useFieldPortAnchor'
import { NodeShape } from '../NodeShapeUtil'
import { getNodeInputPortValues, getNodePortConnections } from '../nodePorts'
import { IconClose, IconCodeBrackets, IconExpand, UiCheckbox, UiIconButton, UiNumberInput, UiTextArea } from '../../../ui'
import { OutputPortRow, stopEvent, useInputConnected } from './fields'
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
	updateNode,
} from './shared'

/**
 * WP29: the sandboxed HTML preview, shared by the `html_preview` (Output) and `html_form`
 * (Input) cards. Input text may be a full HTML document, a fragment, or LLM output with fenced
 * ```html/```css/```js blocks — `shared/htmlPreview.ts` splits and assembles one document.
 * Rendered in an `<iframe sandbox="allow-scripts allow-forms">` with `srcDoc` — never
 * `allow-same-origin`, so the page in the iframe has no origin of its own and so no access to
 * the app, its API, cookies, or local storage. A CSP meta tag in the assembled document blocks
 * network by default; "Allow network" relaxes it.
 */

const BASE_Y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
const TEXT_PX = 72
const OVERRIDE_PX = 44
const DEFAULT_PREVIEW_PX = 220
const MIN_PREVIEW_PX = 100
const MAX_PREVIEW_PX = 520
const SUBMISSION_PX = 64

/** FLOW-09/A2: the run-state message `html_form` sets while its `execute()` promise is parked
 * waiting for a click — matched by `findWaitingUpstream` below, and shown verbatim in the
 * card's own status row too, so both say exactly the same thing. */
const WAITING_FOR_INPUT_MESSAGE = 'Waiting for input…'

const EXAMPLE_PREVIEW_TEXT = '<button style="padding:8px 14px">Hello from the sandbox</button>'
const EXAMPLE_FORM_TEXT = [
	'<button data-value="a">Option A</button>',
	'<button data-value="b">Option B</button>',
	'<button data-value="c">Option C</button>',
].join('\n')

interface SourcePorts {
	[key: string]: ShapePort
	text: ShapePort
	html: ShapePort
	css: ShapePort
	js: ShapePort
	output: ShapePort
}

/** The dedicated input/output ports both cards share, laid out above the preview box. */
function sourcePorts(rowPx: number, widthPx: number): SourcePorts {
	const y = (row: number, extraPx: number) => BASE_Y + rowPx * (row + 0.5) + extraPx
	return {
		text: { id: 'text', x: 0, y: y(0, 0), terminal: 'end', dataType: 'text' },
		html: { id: 'html', x: 0, y: y(1, TEXT_PX), terminal: 'end', dataType: 'text' },
		css: { id: 'css', x: 0, y: y(2, TEXT_PX + OVERRIDE_PX), terminal: 'end', dataType: 'text' },
		js: { id: 'js', x: 0, y: y(3, TEXT_PX + OVERRIDE_PX * 2), terminal: 'end', dataType: 'text' },
		output: { id: 'output', x: widthPx, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
	}
}

/** Rows below the four source ports, before the preview box: an options row (and, on the
 * form card, the json output row sits after the preview instead — see `getBodyHeightPx`). */
const ROWS_BEFORE_PREVIEW = 5 // text, html, css, js, options

function sourcesFromInputs(node: { text: string; html: string; css: string; js: string }, inputs: InputValues) {
	return {
		text: coerceToText(getInput(inputs, 'text')) || node.text,
		html: coerceToText(getInput(inputs, 'html')) || node.html,
		css: coerceToText(getInput(inputs, 'css')) || node.css,
		js: coerceToText(getInput(inputs, 'js')) || node.js,
	}
}

/** Live-preview version of `sourcesFromInputs`: wired value (the upstream card's own last
 * output) wins, falling back to the card's own literal field — the same pattern Table view
 * uses for its live grid (no Play needed to see a change). */
function useLiveSources(editor: Editor, shapeId: TLShapeId, node: { text: string; html: string; css: string; js: string }) {
	return useValue(
		'html preview sources',
		() => {
			const ports = getNodeInputPortValues(editor, shapeId)
			const wired = (key: 'text' | 'html' | 'css' | 'js') => {
				const value = ports[key]?.value
				return typeof value === 'string' ? value : undefined
			}
			return {
				text: wired('text') ?? node.text,
				html: wired('html') ?? node.html,
				css: wired('css') ?? node.css,
				js: wired('js') ?? node.js,
			}
		},
		[editor, shapeId, node.text, node.html, node.css, node.js]
	)
}

/** One dedicated-port input row: port dot + label, and (only while unwired) a small box to
 * type the override directly. */
function SourceRow({
	shapeId,
	portId,
	label,
	value,
	onChange,
	placeholder,
	rows = 2,
	boxPx,
}: {
	shapeId: TLShapeId
	portId: 'text' | 'html' | 'css' | 'js'
	label: string
	value: string
	onChange: (value: string) => void
	placeholder: string
	rows?: number
	boxPx: number
}) {
	const connected = useInputConnected(shapeId, portId)
	const rowRef = useFieldPortAnchor<HTMLDivElement>(shapeId, portId)
	return (
		<>
			<NodeRow ref={rowRef}>
				<PortDot shapeId={shapeId} portId={portId} />
				<span className="NodeInputRow-label">{label}</span>
				{connected && <span className="NodeRow-disconnected">from the {label} input</span>}
			</NodeRow>
			<div className="NodeField-block" style={{ height: boxPx }}>
				<UiTextArea
					className="NodeField-textarea"
					grow
					mono={portId !== 'text'}
					rows={rows}
					disabled={connected}
					placeholder={connected ? `(from the ${label} input)` : placeholder}
					value={connected ? '' : value}
					onChange={onChange}
				/>
			</div>
		</>
	)
}

/** The sandboxed iframe itself. Never `allow-same-origin` — the previewed page gets no origin
 * of its own, so it cannot reach the app, its API, cookies, or storage. Pointer events only
 * reach the iframe while the card is selected (or `interactive`), so an unselected *preview*
 * card never steals a canvas drag/pan from a click that lands on it.
 *
 * GAPS-16: the *form* card passes `interactive` unconditionally — unlike a preview, a form's
 * whole purpose is to be clicked, and the old selected-only gate meant a click on an unselected
 * form's button reached neither the canvas (the wrapper's own `stopEvent` already swallowed
 * that) nor the iframe (`pointer-events: none`), so the very first click was silently lost. */
function PreviewFrame({
	iframeRef,
	doc,
	heightPx,
	selected,
	interactive = false,
	title,
}: {
	iframeRef?: React.RefObject<HTMLIFrameElement | null>
	doc: string
	heightPx: number
	selected: boolean
	interactive?: boolean
	title: string
}) {
	return (
		<div className="HtmlPreviewNode-frameWrap" style={{ height: heightPx }} onPointerDown={stopEvent}>
			<iframe
				ref={iframeRef}
				className="HtmlPreviewNode-frame"
				style={{ pointerEvents: selected || interactive ? 'auto' : 'none' }}
				sandbox="allow-scripts allow-forms"
				srcDoc={doc}
				title={title}
				referrerPolicy="no-referrer"
			/>
		</div>
	)
}

/** The "expand" large view: the same sandboxed iframe, full size, in a draggable dialog —
 * styled like `LargeEditor`'s own dialog, built locally so this card doesn't need to touch
 * that shared file for a one-off variant. */
function PreviewZoom({ title, doc, onClose }: { title: string; doc: string; onClose: () => void }) {
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose])
	return createPortal(
		<div className="LargeEditor-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
			<div className="LargeEditor" role="dialog" aria-label={title}>
				<div className="LargeEditor-bar">
					<strong>{title}</strong>
					<div className="LargeEditor-actions">
						<UiIconButton icon={<IconClose />} title="Close" onClick={onClose} />
					</div>
				</div>
				<div className="LargeEditor-body">
					<iframe
						className="HtmlPreviewNode-frame HtmlPreviewNode-frame_zoom"
						sandbox="allow-scripts allow-forms"
						srcDoc={doc}
						title={title}
						referrerPolicy="no-referrer"
					/>
				</div>
			</div>
		</div>,
		document.querySelector('.tl-container') ?? document.body
	)
}

function PreviewOptionsRow({
	allowNetwork,
	heightPx,
	onAllowNetworkChange,
	onHeightChange,
	onExpand,
}: {
	allowNetwork: boolean
	heightPx: number
	onAllowNetworkChange: (value: boolean) => void
	onHeightChange: (value: number) => void
	onExpand: () => void
}) {
	return (
		<NodeRow className="HtmlPreviewNode-options">
			<UiCheckbox checked={allowNetwork} label="Allow network" onChange={onAllowNetworkChange} />
			<UiNumberInput
				className="HtmlPreviewNode-heightInput"
				min={MIN_PREVIEW_PX}
				max={MAX_PREVIEW_PX}
				value={heightPx}
				onChange={(value) => onHeightChange(Math.max(MIN_PREVIEW_PX, Math.min(MAX_PREVIEW_PX, value ?? DEFAULT_PREVIEW_PX)))}
				title="Preview height (px)"
			/>
			<UiIconButton icon={<IconExpand size={13} />} title="Open full-size preview" onClick={onExpand} />
		</NodeRow>
	)
}

// ---------------------------------------------------------------------------
// A. html_preview (Output): shows the assembled document, outputs it as `output`.
// ---------------------------------------------------------------------------

export type HtmlPreviewNode = T.TypeOf<typeof HtmlPreviewNode>
export const HtmlPreviewNode = T.object({
	type: T.literal('html_preview'),
	text: T.string,
	html: T.string,
	css: T.string,
	js: T.string,
	allowNetwork: T.boolean.optional(),
	heightPx: T.number.optional(),
	lastHtml: T.string.nullable(),
	error: T.string.nullable(),
})

export class HtmlPreviewNodeDefinition extends NodeDefinition<HtmlPreviewNode> {
	static type = 'html_preview'
	static validator = HtmlPreviewNode
	title = 'HTML preview'
	heading = 'HTML preview'
	icon = <IconCodeBrackets />
	category = categoryOf('html_preview')
	override defaultWidthPx = 380
	override showsOutput = true
	resultKeys = ['lastHtml', 'error'] as const
	getDefault(): HtmlPreviewNode {
		return {
			type: 'html_preview',
			text: EXAMPLE_PREVIEW_TEXT,
			html: '',
			css: '',
			js: '',
			allowNetwork: false,
			heightPx: DEFAULT_PREVIEW_PX,
			lastHtml: null,
			error: null,
		}
	}
	getBodyHeightPx(shape: NodeShape, node: HtmlPreviewNode) {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const previewPx = node.heightPx ?? DEFAULT_PREVIEW_PX
		return rowPx * ROWS_BEFORE_PREVIEW + TEXT_PX + OVERRIDE_PX * 3 + previewPx
	}
	getPorts(shape: NodeShape, node: HtmlPreviewNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		return sourcePorts(rowPx, this.getWidthPx(shape, node))
	}
	async execute(shape: NodeShape, node: HtmlPreviewNode, inputs: InputValues): Promise<ExecutionResult> {
		try {
			const doc = assembleHtmlDocument(sourcesFromInputs(node, inputs), { allowNetwork: !!node.allowNetwork })
			updateNode<HtmlPreviewNode>(this.editor, shape, (n) => ({ ...n, lastHtml: doc, error: null }), false)
			return { output: doc }
		} catch (error) {
			updateNode<HtmlPreviewNode>(this.editor, shape, (n) => ({ ...n, error: (error as Error).message }), false)
			throw error
		}
	}
	getOutputInfo(shape: NodeShape, node: HtmlPreviewNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		return { output: { value: node.lastHtml ?? null, isOutOfDate, dataType: 'text' } }
	}
	Component = HtmlPreviewComponent
}

function HtmlPreviewComponent({ shape, node }: NodeComponentProps<HtmlPreviewNode>) {
	const editor = useEditor()
	const [zoomOpen, setZoomOpen] = useState(false)
	const selected = useValue('html preview selected', () => editor.getSelectedShapeIds().includes(shape.id), [editor, shape.id])
	const set = (patch: Partial<HtmlPreviewNode>) => updateNode<HtmlPreviewNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const live = useLiveSources(editor, shape.id, node)
	const doc = useMemo(
		() => assembleHtmlDocument(live, { allowNetwork: !!node.allowNetwork }),
		[live, node.allowNetwork]
	)
	const heightPx = node.heightPx ?? DEFAULT_PREVIEW_PX

	return (
		<>
			<SourceRow shapeId={shape.id} portId="text" label="Text" value={node.text} onChange={(text) => set({ text })} placeholder="Full HTML, a fragment, or LLM output with fenced ```html/```css/```js blocks" rows={3} boxPx={TEXT_PX} />
			<SourceRow shapeId={shape.id} portId="html" label="HTML" value={node.html} onChange={(html) => set({ html })} placeholder="Overrides the html fenced block (or the Text field)" boxPx={OVERRIDE_PX} />
			<SourceRow shapeId={shape.id} portId="css" label="CSS" value={node.css} onChange={(css) => set({ css })} placeholder="Overrides the css fenced block" boxPx={OVERRIDE_PX} />
			<SourceRow shapeId={shape.id} portId="js" label="JS" value={node.js} onChange={(js) => set({ js })} placeholder="Overrides the js fenced block" boxPx={OVERRIDE_PX} />
			<PreviewOptionsRow
				allowNetwork={!!node.allowNetwork}
				heightPx={heightPx}
				onAllowNetworkChange={(allowNetwork) => set({ allowNetwork })}
				onHeightChange={(h) => set({ heightPx: h })}
				onExpand={() => setZoomOpen(true)}
			/>
			{node.error && (
				<NodeRow>
					<span className="NodeStatus is-error">{node.error}</span>
				</NodeRow>
			)}
			<PreviewFrame doc={doc} heightPx={heightPx} selected={selected} title="HTML preview" />
			<OutputPortRow shapeId={shape.id} portId="output" label="HTML" dataType="text" />
			{zoomOpen && <PreviewZoom title="HTML preview" doc={doc} onClose={() => setZoomOpen(false)} />}
		</>
	)
}

// ---------------------------------------------------------------------------
// B. html_form (Input): same preview, plus a bridge script that reports a form submit or a
// button/data-value click back to the card via postMessage. Waits for the user's first
// submission, then outputs it as `json`; a later submission re-runs downstream on its own.
// ---------------------------------------------------------------------------

export type HtmlFormNode = T.TypeOf<typeof HtmlFormNode>
export const HtmlFormNode = T.object({
	type: T.literal('html_form'),
	text: T.string,
	html: T.string,
	css: T.string,
	js: T.string,
	allowNetwork: T.boolean.optional(),
	heightPx: T.number.optional(),
	lastHtml: T.string.nullable(),
	lastSubmissionJson: T.string.nullable(),
	error: T.string.nullable(),
})

/**
 * FLOW-09: a card run downstream of an `html_form` (or anything else) that's waiting for a
 * click just spins with no hint of why. BFS over input wires from `shapeId`, looking for an
 * upstream card whose run state is this exact "Waiting for input…" message (the one
 * `HtmlFormNodeDefinition.execute` sets below) — so a stuck card can name what it's waiting on.
 */
export function findWaitingUpstream(editor: Editor, shapeId: TLShapeId): string | null {
	const seen = new Set<TLShapeId>([shapeId])
	const queue: TLShapeId[] = [shapeId]
	while (queue.length) {
		const id = queue.shift()!
		for (const c of getNodePortConnections(editor, id)) {
			if (c.terminal !== 'end' || seen.has(c.connectedShapeId)) continue
			seen.add(c.connectedShapeId)
			const run = getNodeRun(editor, c.connectedShapeId)
			if (run?.status === 'running' && run.message === WAITING_FOR_INPUT_MESSAGE) {
				const shape = editor.getShape<NodeShape>(c.connectedShapeId)
				const label = shape && (shape.props as { label?: string }).label
				return (typeof label === 'string' && label.trim()) || shape?.props.node.type || c.connectedShapeId
			}
			queue.push(c.connectedShapeId)
		}
	}
	return null
}

/**
 * FLOW-09: dropped into any card's `Component` to show "waiting for input in <card>" while a
 * run is in progress and this card's own turn hasn't come up yet because something upstream
 * (currently only `html_form`) is parked waiting for the user. Renders nothing otherwise —
 * including the ordinary case where this card simply hasn't been reached yet in a fast run.
 */
export function WaitingUpstreamHint({ shapeId }: { shapeId: TLShapeId }) {
	const editor = useEditor()
	const waitingOn = useValue(
		'waiting upstream hint',
		() => (executionState.get(editor).runningGraph ? findWaitingUpstream(editor, shapeId) : null),
		[editor, shapeId]
	)
	if (!waitingOn) return null
	return (
		<NodeRow>
			<span className="NodeStatus">Waiting for input in "{waitingOn}"</span>
		</NodeRow>
	)
}

/** A card currently inside `execute()`'s "waiting for the user" promise, resolved by
 * `submitHtmlForm` when its bridge message arrives. Module-level (not node props): this is
 * live run state, not something a saved canvas should remember. */
const pendingWaiters = new Map<TLShapeId, (json: string) => void>()
/** A submission that arrived with nobody waiting (the card already finished its last run) —
 * consumed by the very next `execute()` call instead of waiting for a second one. */
const freshSubmissions = new Map<TLShapeId, string>()

/** Called by the card's postMessage handler with a validated, already-stringified submission.
 * If `execute()` is currently waiting on this card, that resolves it (the engine then carries
 * on to whatever is wired downstream, in the same run). Otherwise — the card already finished a
 * previous run — this starts a fresh one rooted here, so "submit again" always re-runs
 * downstream even without pressing Play. */
export function submitHtmlForm(editor: Editor, shape: NodeShape, json: string) {
	updateNode<HtmlFormNode>(editor, shape, (n) => ({ ...n, lastSubmissionJson: json, error: null }), false)
	const waiter = pendingWaiters.get(shape.id)
	if (waiter) {
		pendingWaiters.delete(shape.id)
		waiter(json)
		return
	}
	freshSubmissions.set(shape.id, json)
	void startExecution(editor, new Set([shape.id]))
}

export class HtmlFormNodeDefinition extends NodeDefinition<HtmlFormNode> {
	static type = 'html_form'
	static validator = HtmlFormNode
	title = 'HTML form'
	heading = 'HTML form'
	icon = <HtmlFormIcon />
	category = categoryOf('html_form')
	override defaultWidthPx = 380
	override showsOutput = true
	resultKeys = ['lastHtml', 'lastSubmissionJson', 'error'] as const
	getDefault(): HtmlFormNode {
		return {
			type: 'html_form',
			text: EXAMPLE_FORM_TEXT,
			html: '',
			css: '',
			js: '',
			allowNetwork: false,
			heightPx: DEFAULT_PREVIEW_PX,
			lastHtml: null,
			lastSubmissionJson: null,
			error: null,
		}
	}
	getBodyHeightPx(shape: NodeShape, node: HtmlFormNode) {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const previewPx = node.heightPx ?? DEFAULT_PREVIEW_PX
		// +2 (not +1): the `json` and `value` (A2) output rows below the preview.
		return rowPx * (ROWS_BEFORE_PREVIEW + 2) + TEXT_PX + OVERRIDE_PX * 3 + previewPx + SUBMISSION_PX
	}
	getPorts(shape: NodeShape, node: HtmlFormNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const width = this.getWidthPx(shape, node)
		const ports = sourcePorts(rowPx, width)
		return {
			...ports,
			json: { id: 'json', x: width, y: NODE_HEADER_HEIGHT_PX / 2 + rowPx, terminal: 'start', dataType: 'text' },
			// A2 (GAPS-05): a single, routable value — the clicked data-value, or a one-field
			// form's own field — so "form → Decision switch" needs no extra card in between.
			value: { id: 'value', x: width, y: NODE_HEADER_HEIGHT_PX / 2 + rowPx * 2, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: HtmlFormNode, inputs: InputValues): Promise<ExecutionResult> {
		const doc = assembleHtmlDocument(sourcesFromInputs(node, inputs), {
			allowNetwork: !!node.allowNetwork,
			injectScript: buildFormBridgeScript(),
		})
		updateNode<HtmlFormNode>(this.editor, shape, (n) => ({ ...n, lastHtml: doc, error: null }), false)

		// A submission already arrived while nobody was waiting (the user clicked again after a
		// previous run finished) — consume it now instead of waiting for a second one.
		const fresh = freshSubmissions.get(shape.id)
		if (fresh !== undefined) {
			freshSubmissions.delete(shape.id)
			return { output: doc, json: fresh, value: valueFromSubmissionJson(fresh) }
		}

		const signal = currentRunSignal(this.editor)
		if (signal?.aborted) throw new DOMException('Stopped', 'AbortError')
		setNodeRun(this.editor, shape.id, { status: 'running', message: WAITING_FOR_INPUT_MESSAGE })
		return await new Promise<ExecutionResult>((resolve, reject) => {
			const onAbort = () => {
				pendingWaiters.delete(shape.id)
				reject(new DOMException('Stopped — waiting for the form', 'AbortError'))
			}
			signal?.addEventListener('abort', onAbort)
			pendingWaiters.set(shape.id, (json) => {
				signal?.removeEventListener('abort', onAbort)
				resolve({ output: doc, json, value: valueFromSubmissionJson(json) })
			})
		})
	}
	getOutputInfo(shape: NodeShape, node: HtmlFormNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		return {
			output: { value: node.lastHtml ?? null, isOutOfDate, dataType: 'text' },
			json: { value: node.lastSubmissionJson ?? null, isOutOfDate, dataType: 'text' },
			value: { value: node.lastSubmissionJson ? valueFromSubmissionJson(node.lastSubmissionJson) : null, isOutOfDate, dataType: 'text' },
		}
	}
	Component = HtmlFormComponent
}

function HtmlFormComponent({ shape, node }: NodeComponentProps<HtmlFormNode>) {
	const editor = useEditor()
	const [zoomOpen, setZoomOpen] = useState(false)
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const selected = useValue('html form selected', () => editor.getSelectedShapeIds().includes(shape.id), [editor, shape.id])
	const waiting = useValue(
		'html form waiting',
		() => executionState.get(editor).runningGraph?.getNodeStatus(shape.id) === 'executing',
		[editor, shape.id]
	)
	const set = (patch: Partial<HtmlFormNode>) => updateNode<HtmlFormNode>(editor, shape, (n) => ({ ...n, ...patch }), false)
	const live = useLiveSources(editor, shape.id, node)
	const doc = useMemo(
		() => assembleHtmlDocument(live, { allowNetwork: !!node.allowNetwork, injectScript: buildFormBridgeScript() }),
		[live, node.allowNetwork]
	)
	const heightPx = node.heightPx ?? DEFAULT_PREVIEW_PX

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			// Validate the source — only this card's own iframe, never any other window or frame.
			if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
			const payload = parseBridgePayload(event.data)
			if (!payload) return
			submitHtmlForm(editor, shape, bridgePayloadToJson(payload))
		}
		window.addEventListener('message', onMessage)
		return () => window.removeEventListener('message', onMessage)
	}, [editor, shape])

	return (
		<>
			<SourceRow shapeId={shape.id} portId="text" label="Text" value={node.text} onChange={(text) => set({ text })} placeholder="Buttons/options or a <form> — a fragment, a full page, or LLM output with fenced ```html/```css/```js blocks" rows={3} boxPx={TEXT_PX} />
			<SourceRow shapeId={shape.id} portId="html" label="HTML" value={node.html} onChange={(html) => set({ html })} placeholder="Overrides the html fenced block (or the Text field)" boxPx={OVERRIDE_PX} />
			<SourceRow shapeId={shape.id} portId="css" label="CSS" value={node.css} onChange={(css) => set({ css })} placeholder="Overrides the css fenced block" boxPx={OVERRIDE_PX} />
			<SourceRow shapeId={shape.id} portId="js" label="JS" value={node.js} onChange={(js) => set({ js })} placeholder="Overrides the js fenced block" boxPx={OVERRIDE_PX} />
			<PreviewOptionsRow
				allowNetwork={!!node.allowNetwork}
				heightPx={heightPx}
				onAllowNetworkChange={(allowNetwork) => set({ allowNetwork })}
				onHeightChange={(h) => set({ heightPx: h })}
				onExpand={() => setZoomOpen(true)}
			/>
			{node.error && (
				<NodeRow>
					<span className="NodeStatus is-error">{node.error}</span>
				</NodeRow>
			)}
			{waiting && (
				<NodeRow>
					<span className="NodeStatus">{WAITING_FOR_INPUT_MESSAGE}</span>
				</NodeRow>
			)}
			{/* GAPS-16: `interactive` keeps the iframe clickable even while unselected — a form's
			 * whole purpose is to be clicked, so the first click on it must always count. */}
			<PreviewFrame iframeRef={iframeRef} doc={doc} heightPx={heightPx} selected={selected} interactive title="HTML form" />
			<OutputPortRow shapeId={shape.id} portId="output" label="HTML" dataType="text" />
			<OutputPortRow shapeId={shape.id} portId="json" label="JSON" dataType="text" />
			<OutputPortRow shapeId={shape.id} portId="value" label="Value" dataType="text" />
			<div className="NodeScroll HtmlPreviewNode-submission" style={{ height: SUBMISSION_PX }} onPointerDown={stopEvent}>
				{node.lastSubmissionJson ? <pre>{node.lastSubmissionJson}</pre> : <span className="NodeRow-disconnected">No submission yet</span>}
			</div>
			{zoomOpen && <PreviewZoom title="HTML form" doc={doc} onClose={() => setZoomOpen(false)} />}
		</>
	)
}
