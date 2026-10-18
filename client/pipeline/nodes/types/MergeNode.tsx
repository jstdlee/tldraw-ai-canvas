import { categoryOf } from '../../../../shared/nodeGroups'
import { Editor, T, useEditor, useValue } from 'tldraw'
import { MergeIcon } from '../../components/icons/MergeIcon'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX } from '../../constants'
import { Port, ShapePort } from '../../ports/Port'
import { useFieldPortAnchor } from '../../ports/useFieldPortAnchor'
import { getNodeInputPortValues, getNodePortConnections } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import { NodeSelect, preview, stopEvent, WireField } from './fields'
import {
	areAnyInputsOutOfDate,
	coerceToText,
	ExecutionResult,
	InfoValues,
	InputValues,
	isMultiInfoValue,
	NodeComponentProps,
	NodeDefinition,
	NodePlaceholder,
	NodePortLabel,
	NodeRow,
	PipelineValue,
	STOP_EXECUTION,
	updateNode,
} from './shared'

/**
 * WP36 "I": waits on several branches (typically from an If / Decision switch) and combines
 * whichever actually delivered. `in1..inN` ports grow as they're wired — one spare port past the
 * highest one connected, like Code's inputs but without a count field. The engine
 * (`ExecutionGraph.executeMergeIfReady`) gives this card bespoke scheduling: "first" runs as
 * soon as any wired branch has a value; "all"/"json" wait for every wired branch to settle
 * (delivered or not taken — never forever) before joining whichever did.
 */
export type MergeNode = T.TypeOf<typeof MergeNode>
export const MergeNode = T.object({
	type: T.literal('merge'),
	mode: T.literalEnum('first', 'all', 'json'),
	separator: T.string,
	error: T.string.nullable(),
})

export const MERGE_MAX_INPUTS = 20
const BASE_Y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX

/** in1, in2, … (rename-safe, stable ids). */
export function mergeInputId(i: number): string {
	return `in${i + 1}`
}

/** How many `inN` ports to show: one past the highest-numbered one currently wired (min 2,
 * capped). Shared by `getPorts` (so the dot exists to wire into) and the engine's own scheduler
 * (which reads the real wires directly, independent of this — see ExecutionGraph.tsx). */
export function mergeInputCount(editor: Editor, shape: NodeShape): number {
	const connections = getNodePortConnections(editor, shape)
	let maxConnected = 0
	for (const c of connections) {
		if (!c || c.terminal !== 'end') continue
		const m = /^in(\d+)$/.exec(c.ownPortId)
		if (m) maxConnected = Math.max(maxConnected, Number(m[1]))
	}
	return Math.min(MERGE_MAX_INPUTS, Math.max(2, maxConnected + 1))
}

export class MergeNodeDefinition extends NodeDefinition<MergeNode> {
	static type = 'merge'
	static validator = MergeNode
	title = 'Merge'
	heading = 'Merge'
	icon = <MergeIcon />
	category = categoryOf('merge')
	resultKeys = ['error'] as const
	getDefault(): MergeNode {
		return { type: 'merge', mode: 'first', separator: '\n', error: null }
	}
	private inCount(shape: NodeShape): number {
		return mergeInputCount(this.editor, shape)
	}
	getBodyHeightPx(shape: NodeShape, _node: MergeNode) {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		// One row per in* port, plus Mode, plus Separator (always rendered — WP17 anchors need
		// a mounted row; disabled rather than hidden when the current mode ignores it).
		return rowPx * (this.inCount(shape) + 2)
	}
	getPorts(shape: NodeShape, node: MergeNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const count = this.inCount(shape)
		const ports: Record<string, ShapePort> = {}
		for (let i = 0; i < count; i++) {
			const id = mergeInputId(i)
			ports[id] = { id, x: 0, y: BASE_Y + rowPx * (i + 0.5), terminal: 'end', dataType: 'any' }
		}
		ports.output = { id: 'output', x: this.getWidthPx(shape, node), y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'any' }
		return ports
	}
	async execute(shape: NodeShape, node: MergeNode, inputs: InputValues): Promise<ExecutionResult> {
		const count = this.inCount(shape)
		const values: string[] = []
		for (let i = 0; i < count; i++) {
			const v = inputs[mergeInputId(i)]
			const scalar = Array.isArray(v) ? v[0] : v
			if (scalar != null) values.push(coerceToText(scalar))
		}
		if (values.length === 0) {
			// Every wired branch was untaken (e.g. a Decision switch that matched none of them,
			// or the engine handed this card nothing at all): skip onward, same as an If/Decision
			// switch's own unused output — not a failure to report.
			updateNode<MergeNode>(this.editor, shape, (n) => ({ ...n, error: null }), false)
			return { output: STOP_EXECUTION }
		}
		updateNode<MergeNode>(this.editor, shape, (n) => ({ ...n, error: null }), false)
		if (node.mode === 'first') return { output: values[0] }
		if (node.mode === 'json') return { output: JSON.stringify(values) }
		return { output: values.join(node.separator || '\n') }
	}
	getOutputInfo(shape: NodeShape, node: MergeNode, inputs: InfoValues): InfoValues {
		const count = this.inCount(shape)
		const values: string[] = []
		let isOutOfDate = shape.props.isOutOfDate
		for (let i = 0; i < count; i++) {
			const info = inputs[mergeInputId(i)]
			if (!info) continue
			if (info.isOutOfDate) isOutOfDate = true
			const value = isMultiInfoValue(info) ? info.value[0] : info.value
			if (value != null && value !== STOP_EXECUTION) values.push(coerceToText(value as PipelineValue))
		}
		const joined =
			values.length === 0
				? null
				: node.mode === 'first'
					? values[0]
					: node.mode === 'json'
						? JSON.stringify(values)
						: values.join(node.separator || '\n')
		return { output: { value: joined, isOutOfDate, dataType: 'any' } }
	}
	Component = MergeNodeComponent
}

/** Anchors a dynamically-numbered `inN` port to its own row (same idea as CodeNode's
 * CodePortAnchor, for a port id that isn't a field key). */
function MergeInputRow({
	shape,
	index,
	info,
}: {
	shape: NodeShape
	index: number
	info: InfoValues[string] | undefined
}) {
	const portId = mergeInputId(index)
	const ref = useFieldPortAnchor<HTMLDivElement>(shape.id, portId)
	return (
		<NodeRow ref={ref}>
			<Port shapeId={shape.id} portId={portId} />
			<NodePortLabel dataType="any">{`In ${index + 1}`}</NodePortLabel>
			{info ? (
				<span className="NodeRow-connected-value">{info.isOutOfDate ? <NodePlaceholder /> : preview(info.value)}</span>
			) : (
				<span className="NodeRow-disconnected">not connected</span>
			)}
		</NodeRow>
	)
}

const MODES: { id: MergeNode['mode']; label: string }[] = [
	{ id: 'first', label: 'First that arrives' },
	{ id: 'all', label: 'All, joined' },
	{ id: 'json', label: 'All, as JSON' },
]

function MergeNodeComponent({ shape, node }: NodeComponentProps<MergeNode>) {
	const editor = useEditor()
	const count = mergeInputCount(editor, shape)
	const inputs = useInputInfos(editor, shape, count)
	const set = (patch: Partial<MergeNode>) => updateNode<MergeNode>(editor, shape, (n) => ({ ...n, ...patch }), false)

	return (
		<>
			{Array.from({ length: count }, (_, i) => (
				<MergeInputRow key={i} shape={shape} index={i} info={inputs[mergeInputId(i)]} />
			))}
			<WireField shapeId={shape.id} fieldKey="mode" label="Mode">
				<NodeSelect
					className="NodeField-select"
					value={node.mode}
					onPointerDown={stopEvent}
					onChange={(e) => set({ mode: e.target.value as MergeNode['mode'] })}
				>
					{MODES.map((m) => (
						<option key={m.id} value={m.id}>
							{m.label}
						</option>
					))}
				</NodeSelect>
			</WireField>
			{/* Always rendered (not just in "all" mode): a WireField's port only anchors itself
			 * while its row is actually mounted (WP17) — conditionally hiding this row by mode
			 * would leave its field port permanently stuck at the header, the same class of bug
			 * as AI-07's threshold/margin on Decision switch. Disabled instead when it has no
			 * effect, same as it being present just does nothing for "first"/"json". */}
			<WireField
				shapeId={shape.id}
				fieldKey="separator"
				label="Join with"
				hint={node.mode !== 'all' ? 'All joined only' : undefined}
			>
				<NodeSelect
					className="NodeField-select"
					value={node.separator}
					disabled={node.mode !== 'all'}
					onPointerDown={stopEvent}
					onChange={(e) => set({ separator: e.target.value })}
				>
					{/* WP39 root cause: a JSX attribute string doesn't interpret `\n` as an escape — a
					    quoted `value="\n"` is the literal two characters "\" + "n", which never
					    matched node.separator's real-newline default ('\n', a JS string literal in
					    getDefault() above). No option ever matched, so the control showed its
					    "Choose" placeholder even though a separator was always selected. `{'\n'}`
					    is a JS expression, so it's the actual newline character. */}
					<option value={'\n'}>Newline</option>
					<option value=", ">Comma</option>
					<option value=" ">Space</option>
					<option value="">None</option>
				</NodeSelect>
			</WireField>
		</>
	)
}

/** This card's own `inN` port values, for the live "connected"/preview rows — the same
 * `getNodeInputPortValues` every other card's component reads, just scoped to a dynamic count. */
function useInputInfos(editor: Editor, shape: NodeShape, count: number): InfoValues {
	return useValue(
		'merge inputs',
		() => {
			const all = getNodeInputPortValues(editor, shape.id)
			const picked: InfoValues = {}
			for (let i = 0; i < count; i++) {
				const id = mergeInputId(i)
				if (all[id]) picked[id] = all[id]
			}
			return picked
		},
		[editor, shape.id, count]
	)
}
