import classNames from 'classnames'
import { ReactElement, ReactNode, useEffect, useState } from 'react'
import { TLShapeId, useEditor, useToasts, useValue } from 'tldraw'
export { NodeMultiSelect, NodeSelect } from './NodeSelect'
import { FieldMax, LargeEditor } from '../../editors/LargeEditor'
import { PortDataType } from '../../constants'
import { parseModelValue } from '../../../../shared/modelRef'
import { fieldPortId } from '../../../../shared/fieldOverrides'
import { getPg, pgliteMemoryFallbackReason, takePgliteFallbackToast } from '../../pg'
import { Port } from '../../ports/Port'
import { useFieldPortAnchor } from '../../ports/useFieldPortAnchor'
import { getNodeInputPortValues, getNodePortConnections } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import { NodePlaceholder, NodePortLabel, NodeRow, STOP_EXECUTION } from './shared'

/** Keep pointer and key events inside form fields (not the canvas). */
export const stopEvent = (e: React.SyntheticEvent) => e.stopPropagation()

/**
 * WP19 Part 3: the built-in Postgres (PGlite) can fall back to an in-memory database when it
 * cannot open its saved one; data then disappears on reload. Shown by the Database card
 * (source "pglite") and the legacy Postgres card, whichever is on screen opens the database
 * and reports the reason. A toast fires once per session, no matter how many cards mount.
 */
export function PgliteMemoryWarning() {
	const toasts = useToasts()
	const [reason, setReason] = useState(pgliteMemoryFallbackReason())
	useEffect(() => {
		let cancelled = false
		getPg().then(() => {
			if (!cancelled) setReason(pgliteMemoryFallbackReason())
		})
		return () => {
			cancelled = true
		}
	}, [])
	useEffect(() => {
		if (!reason || !takePgliteFallbackToast()) return
		toasts.addToast({
			severity: 'warning',
			title: 'Built-in Postgres is running in memory',
			description: `Data is lost on reload (${reason}).`,
			keepOpen: true,
		})
	}, [reason, toasts])
	if (!reason) return null
	return (
		<NodeRow>
			<span className="NodeHint NodeHint-warning">Built-in Postgres is running in memory: data is lost on reload ({reason}).</span>
		</NodeRow>
	)
}

export function isImageValue(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		/^(data:image\/|\/api\/images\/|https?:\/\/\S+\.(png|jpe?g|webp|gif|svg)(\?\S*)?$)/i.test(value)
	)
}

/** GAPS-13: a short, human preview of any wired value for a connected-row's inline summary —
 * `STOP_EXECUTION` (an untaken If/Decision switch branch) becomes "" rather than the raw
 * `Symbol(STOP_EXECUTION)` a bare `String(value)` would produce. Exported so node components
 * with their own hand-rolled "connected" row (GenerateTextNode, ChatNode's Attach row) can reuse
 * it instead of re-deriving the same preview logic. */
export function preview(value: unknown) {
	if (value == null || value === STOP_EXECUTION) return ''
	if (isImageValue(value)) return 'image'
	// A Model provider output: show the model name, not its JSON.
	const adhoc = typeof value === 'string' ? parseModelValue(value).adhoc : undefined
	if (adhoc) return adhoc.model
	const s = String(value).replace(/\s+/g, ' ')
	return s.length > 28 ? s.slice(0, 28) + '…' : s
}

/** The node feeding a given input port, so a wired row can show where its value comes from. */
export function useWireSource(shapeId: TLShapeId, portId: string) {
	const editor = useEditor()
	return useValue(
		'port source ' + portId,
		() => {
			const connection = getNodePortConnections(editor, shapeId).find(
				(c) => c.terminal === 'end' && c.ownPortId === portId
			)
			if (!connection) return null
			const source = editor.getShape(connection.connectedShapeId)
			if (!source || !editor.isShapeOfType<NodeShape>(source, 'node')) return null
			const label: unknown = source.props.label
			if (typeof label === 'string' && label.trim()) return label
			return source.props.node.type
		},
		[editor, shapeId, portId]
	)
}

/** An input-port row that shows the connected value, or a hint when not connected. */
export function PortRow({
	shapeId,
	portId,
	label,
	dataType,
	hint = 'not connected',
	right,
}: {
	shapeId: TLShapeId
	portId: string
	label: string
	dataType: PortDataType
	hint?: string
	/** WP39: trailing content for this same row (e.g. an output port's own label + dot on the
	 * right, as JevNode pairs with several of its input rows) — rendered inside this row's own
	 * NodeRow, not a second one. A caller used to wrap `<PortRow>` in its own extra flex row
	 * alongside separate trailing content; since PortRow already renders a full NodeRow, that
	 * outer wrapper just squeezed this one down to "shrink to fit" width instead of the card's
	 * full width, which wrapped the hint into a cramped, overlapping-looking fragment (the same
	 * class of bug as Database's "wire CSV rows to load" row). */
	right?: ReactNode
}) {
	const editor = useEditor()
	const port = useValue('port ' + portId, () => getNodeInputPortValues(editor, shapeId)[portId], [
		editor,
		shapeId,
		portId,
	])
	const sourceName = useWireSource(shapeId, portId)
	// WP17 follow-up: a dedicated port's row anchors itself too, the same way a field's does —
	// its hand-coded `getPorts()` y is only the fallback before this row has mounted once.
	const ref = useFieldPortAnchor<HTMLDivElement>(shapeId, portId)
	return (
		<NodeRow ref={ref}>
			<Port shapeId={shapeId} portId={portId} />
			<NodePortLabel dataType={dataType}>{label}</NodePortLabel>
			{port ? (
				<span className="NodeRow-connected-value" title={sourceName ? `from ${sourceName}` : String(port.value ?? '')}>
					{sourceName && <span className="NodeRow-source">{sourceName} → </span>}
					{port.isOutOfDate ? <NodePlaceholder /> : preview(port.value)}
				</span>
			) : (
				<span className="NodeRow-disconnected">{hint}</span>
			)}
			{right}
		</NodeRow>
	)
}

/**
 * WP21 Part A ("every output port is a visible, draggable dot"): an output-port row, right
 * aligned, with its own anchored `<Port>` — the same idea as `PortRow` but for a `terminal:
 * 'start'` port. Use this for a dedicated output that doesn't already get the generic header
 * dot (that's only the node's single implicit "output" port, rendered by `NodeShapeUtil`).
 */
export function OutputPortRow({
	shapeId,
	portId,
	label,
	dataType = 'any',
}: {
	shapeId: TLShapeId
	portId: string
	label: ReactNode
	dataType?: PortDataType
}) {
	const ref = useFieldPortAnchor<HTMLDivElement>(shapeId, portId)
	return (
		<NodeRow ref={ref} className="NodeRow-right">
			<NodePortLabel dataType={dataType}>{label}</NodePortLabel>
			<Port shapeId={shapeId} portId={portId} />
		</NodeRow>
	)
}

/**
 * Like `OutputPortRow`, but anchors a port whose label floats inside a row shared with other
 * content (e.g. an input port's row that also carries an output label on the right, as in
 * `JevNode`). Renders the label and its `<Port>` as siblings so the port sits at the row's own
 * right edge (via `.Port_start`), not the label's.
 */
export function OutputPortLabel({
	shapeId,
	portId,
	children,
	className = 'CodeNode-outLabel',
}: {
	shapeId: TLShapeId
	portId: string
	children: ReactNode
	className?: string
}) {
	const ref = useFieldPortAnchor<HTMLSpanElement>(shapeId, portId)
	return (
		<>
			<span ref={ref} className={className}>
				{children}
			</span>
			<Port shapeId={shapeId} portId={portId} />
		</>
	)
}

/** The current value of an input port, or undefined when it is not connected. */
export function useInputConnected(shapeId: TLShapeId, portId: string) {
	const editor = useEditor()
	return useValue('connected ' + portId, () => !!getNodeInputPortValues(editor, shapeId)[portId], [
		editor,
		shapeId,
		portId,
	])
}

/**
 * WP17: the shared state behind a wirable field — its `field:<key>` port id, its wired value
 * (if any), and where it's wired from. `WireField`/`WireFieldHeader` build on this; a node type
 * with its own unusual layout for a field can use it directly instead.
 */
export function useWireField(shapeId: TLShapeId, fieldKey: string) {
	const editor = useEditor()
	const portId = fieldPortId(fieldKey)
	const port = useValue('field port ' + portId, () => getNodeInputPortValues(editor, shapeId)[portId], [
		editor,
		shapeId,
		portId,
	])
	const sourceName = useWireSource(shapeId, portId)
	return { portId, port, sourceName, wired: !!port }
}

function WiredValue({ port, sourceName }: { port: NonNullable<ReturnType<typeof useWireField>['port']>; sourceName: string | null }) {
	return (
		<span className="NodeRow-connected-value" title={sourceName ? `from ${sourceName}` : String(port.value ?? '')}>
			{sourceName && <span className="NodeRow-source">{sourceName} → </span>}
			{port.isOutOfDate ? <NodePlaceholder /> : preview(port.value)}
		</span>
	)
}

/**
 * WP17: a row for a user-editable field that can also be wired. Renders a `field:<key>` port at
 * the row's own position (registered from the DOM via `useFieldPortAnchor`). When wired, shows
 * the source and value instead of `children` (the field's own control) — unwiring brings the
 * control, and its old stored value, straight back. For a field whose control doesn't fit in
 * one row (a growing textarea, a code editor, a file upload…), use `WireFieldHeader` instead:
 * a label-only row to anchor the port, with the real control rendered below it, only when unwired.
 */
export function WireField({
	shapeId,
	fieldKey,
	label,
	dataType = 'text',
	hint,
	children,
	grow,
}: {
	shapeId: TLShapeId
	fieldKey: string
	label: ReactNode
	dataType?: PortDataType
	hint?: ReactNode
	children: ReactElement
	/** WP27 Part B: the row holds a `UiGrowingInput` (or any other control taller than one
	 * line) — lets the row's own height follow its content instead of the usual fixed row
	 * height, and top-aligns the label/port with the control's first line. */
	grow?: boolean
}) {
	const ref = useFieldPortAnchor<HTMLDivElement>(shapeId, fieldKey)
	const { portId, port, sourceName } = useWireField(shapeId, fieldKey)
	return (
		<NodeRow ref={ref} className={classNames('WireField', grow && 'WireField_grow')}>
			<Port shapeId={shapeId} portId={portId} />
			<NodePortLabel dataType={dataType}>{label}</NodePortLabel>
			<div className="WireField-control">
				{port ? <WiredValue port={port} sourceName={sourceName} /> : children}
			</div>
			{!port && hint != null && hint !== '' && <span className="UiField-hint">{hint}</span>}
		</NodeRow>
	)
}

/**
 * WP17: a label-only row for a wirable field whose own control is rendered separately below it
 * (see `WireField`'s doc). Still the field's anchor row — the port sits here either way. When
 * wired, also shows the source/value, since the control itself won't be rendered by the caller.
 */
export function WireFieldHeader({
	shapeId,
	fieldKey,
	label,
	dataType = 'text',
	hint,
}: {
	shapeId: TLShapeId
	fieldKey: string
	label: ReactNode
	dataType?: PortDataType
	/** WP39: shown (greyed, like WireField's own hint) in place of the usual blank space when
	 * this field doesn't apply right now — e.g. "not used in Choice mode" — so the row reads as
	 * collapsed-but-present instead of a header with nothing under it. Hidden once the field is
	 * wired (the wired value takes that slot instead), same as WireField. */
	hint?: ReactNode
}) {
	const ref = useFieldPortAnchor<HTMLDivElement>(shapeId, fieldKey)
	const { portId, port, sourceName } = useWireField(shapeId, fieldKey)
	return (
		<NodeRow ref={ref} className="WireField WireField-header">
			<Port shapeId={shapeId} portId={portId} />
			<NodePortLabel dataType={dataType}>{label}</NodePortLabel>
			{port ? <WiredValue port={port} sourceName={sourceName} /> : hint != null && hint !== '' && <span className="UiField-hint">{hint}</span>}
		</NodeRow>
	)
}

/** Result box used by text-producing nodes. */
export function NodeTextResult({
	text,
	error,
	loading,
	empty,
	height,
}: {
	text: string | null
	error?: string | null
	loading?: boolean
	empty: string
	height: number
}) {
	const [open, setOpen] = useState(false)
	const body = error || text || ''
	return (
		<div
			className={'GenerateTextNode-result NodeScroll' + (loading ? ' GenerateTextNode-result_loading' : '')}
			style={{ height: height - 8 }}
			onPointerDown={stopEvent}
		>
			{body && <FieldMax title="Open this text" onClick={() => setOpen(true)} />}
			{error ? (
				<div className="GenerateTextNode-result-text ChatNode-error">{error}</div>
			) : text ? (
				<div className="GenerateTextNode-result-text">{text}</div>
			) : (
				<div className="GenerateTextNode-result-empty">
					<span>{empty}</span>
				</div>
			)}
			{open && (
				<LargeEditor
					title={error ? 'Error' : 'Output'}
					value={body}
					lang="text"
					readOnly
					onChange={() => {}}
					onClose={() => setOpen(false)}
				/>
			)}
		</div>
	)
}
