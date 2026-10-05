import { useState } from 'react'
import { TLShapeId, useEditor, useValue } from 'tldraw'
import { FieldMax, LargeEditor } from '../../editors/LargeEditor'
import { PortDataType } from '../../constants'
import { Port } from '../../ports/Port'
import { getNodeInputPortValues } from '../nodePorts'
import { NodePlaceholder, NodePortLabel, NodeRow, STOP_EXECUTION } from './shared'

/** Keep pointer and key events inside form fields (not the canvas). */
export const stopEvent = (e: React.SyntheticEvent) => e.stopPropagation()

export function isImageValue(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		/^(data:image\/|\/api\/images\/|https?:\/\/\S+\.(png|jpe?g|webp|gif|svg)(\?\S*)?$)/i.test(value)
	)
}

function preview(value: unknown) {
	if (value == null || value === STOP_EXECUTION) return ''
	if (isImageValue(value)) return 'image'
	const s = String(value).replace(/\s+/g, ' ')
	return s.length > 28 ? s.slice(0, 28) + '…' : s
}

/** An input-port row that shows the connected value, or a hint when not connected. */
export function PortRow({
	shapeId,
	portId,
	label,
	dataType,
	hint = 'not connected',
}: {
	shapeId: TLShapeId
	portId: string
	label: string
	dataType: PortDataType
	hint?: string
}) {
	const editor = useEditor()
	const port = useValue('port ' + portId, () => getNodeInputPortValues(editor, shapeId)[portId], [
		editor,
		shapeId,
		portId,
	])
	return (
		<NodeRow>
			<Port shapeId={shapeId} portId={portId} />
			<NodePortLabel dataType={dataType}>{label}</NodePortLabel>
			{port ? (
				<span className="NodeRow-connected-value" title={String(port.value ?? '')}>
					{port.isOutOfDate ? <NodePlaceholder /> : preview(port.value)}
				</span>
			) : (
				<span className="NodeRow-disconnected">{hint}</span>
			)}
		</NodeRow>
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
