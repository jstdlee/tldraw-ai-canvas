import { categoryOf } from '../../../../shared/nodeGroups'
import {
	bandForScore,
	choiceOutputs,
	DEFAULT_BANDS_TEXT,
	parseBands,
	ParsedDecision,
	parseDecision,
	ResolvedDecisionMode,
	routeDecision,
	scoreFromDecision,
	scoreOutputs,
	ScoreBand,
	slugOption,
} from '../../../../shared/decisionRoute'
import { T, useEditor } from 'tldraw'
import { RouterIcon } from '../../components/icons/RouterIcon'
import { IconClose, IconPlus, UiButton, UiIconButton, UiNumberInput, UiTextArea, UiTextInput } from '../../../ui'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX } from '../../constants'
import { Port, ShapePort } from '../../ports/Port'
import { useFieldPortAnchor } from '../../ports/useFieldPortAnchor'
import { NodeShape } from '../NodeShapeUtil'
import { PortRow, stopEvent, NodeSelect, useInputConnected, WireField, WireFieldHeader } from './fields'
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
 * Decision switch: routes a value down one output based on a decision read from a JEV card
 * (its `probs` or `final`/`output`), or any yes/no/choice/score text. Only the chosen output
 * gets a value — the rest get `STOP_EXECUTION`, like If. The mode (yes/no, choice, score)
 * follows the shape of the decision automatically, or can be set by hand. See
 * `shared/decisionRoute.ts` for the pure routing logic this card is a thin UI over.
 */
export type DecisionSwitchNode = T.TypeOf<typeof DecisionSwitchNode>
export const DecisionSwitchNode = T.object({
	type: T.literal('decision_switch'),
	mode: T.string,
	threshold: T.number,
	margin: T.number,
	options: T.string,
	bands: T.string,
	lastDecisionJson: T.string.nullable(),
	lastOptions: T.arrayOf(T.string).nullable(),
	error: T.string.nullable(),
})

const W = 340
const BASE_Y = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
const portY = (row: number, rowPx: number) => BASE_Y + rowPx * (row + 0.5)
const OPTIONS_PX = 72
const BARS_PX = 90
// decision, value, mode, options-header, bands-header — always rendered (see getBodyHeightPx).
const FIXED_ROWS = 5

interface PortLabel {
	id: string
	label: string
}

interface LastDecisionInfo {
	resolvedMode?: ResolvedDecisionMode
	chosen?: string | null
	parsed?: ParsedDecision
	/** The value the last run actually routed (see `DecisionRouteResult.value`); shown by
	 * `getOutputInfo` for whichever port was chosen instead of a hardcoded null/answer guess. */
	value?: string
}

function readLastDecision(node: DecisionSwitchNode): LastDecisionInfo | null {
	if (!node.lastDecisionJson) return null
	try {
		return JSON.parse(node.lastDecisionJson) as LastDecisionInfo
	} catch {
		return null
	}
}

/** The mode actually used right now: the node's own setting, or (while "auto") the last run's
 * resolved mode, or "yes/no" before anything has run. */
function resolvedModeFor(node: DecisionSwitchNode): ResolvedDecisionMode {
	if (node.mode === 'noul' || node.mode === 'choice' || node.mode === 'score') return node.mode
	return readLastDecision(node)?.resolvedMode ?? 'noul'
}

function outputPortsFor(node: DecisionSwitchNode): PortLabel[] {
	const mode = resolvedModeFor(node)
	if (mode === 'noul') {
		return [
			{ id: 'yes', label: 'Yes' },
			{ id: 'no', label: 'No' },
			{ id: 'unsure', label: 'Unsure' },
		]
	}
	if (mode === 'choice') return choiceOutputs(node.options, node.lastOptions)
	return scoreOutputs(node.bands)
}

export class DecisionSwitchNodeDefinition extends NodeDefinition<DecisionSwitchNode> {
	static type = 'decision_switch'
	static validator = DecisionSwitchNode
	title = 'Decision switch'
	heading = 'Switch'
	icon = <RouterIcon />
	category = categoryOf('decision_switch')
	override showsOutput = true
	resultKeys = ['lastDecisionJson', 'lastOptions', 'error'] as const
	getDefault(): DecisionSwitchNode {
		return {
			type: 'decision_switch',
			mode: 'auto',
			threshold: 0.5,
			margin: 0,
			// Empty by default (WP22 follow-up): the switch derives its options live from the
			// decision itself (the JEV result's own categories) — see choiceLabelsForRoute.
			// Bands keep a sensible sample default; score mode has no equivalent to derive from.
			options: '',
			bands: DEFAULT_BANDS_TEXT,
			lastDecisionJson: null,
			lastOptions: null,
			error: null,
		}
	}
	override getWidthPx() {
		return W
	}
	getBodyHeightPx(shape: NodeShape, node: DecisionSwitchNode) {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const mode = resolvedModeFor(node)
		const outs = outputPortsFor(node)
		// decision, value, mode rows, plus the options/bands header rows — always rendered
		// (even when the other mode is active) so their field-port anchors always register.
		let rows = FIXED_ROWS
		let extraPx = 0
		if (mode === 'noul') {
			rows += 2 // threshold, margin
			rows += outs.length // yes/no/unsure display rows
		} else if (mode === 'choice') {
			extraPx += OPTIONS_PX
			rows += outs.length // one per option + "other"
		} else {
			rows += Math.max(outs.length, 1) // each band is its own edit+output row
		}
		return rowPx * rows + extraPx + BARS_PX
	}
	getPorts(shape: NodeShape, node: DecisionSwitchNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const mode = resolvedModeFor(node)
		const ports: Record<string, ShapePort> = {
			decision: { id: 'decision', x: 0, y: portY(0, rowPx), terminal: 'end', dataType: 'any' },
			value: { id: 'value', x: 0, y: portY(1, rowPx), terminal: 'end', dataType: 'any' },
		}
		const outs = outputPortsFor(node)
		const firstOutRow = mode === 'noul' ? FIXED_ROWS + 2 : FIXED_ROWS
		outs.forEach((out, i) => {
			ports[out.id] = { id: out.id, x: W, y: portY(firstOutRow + i, rowPx), terminal: 'start', dataType: 'any' }
		})
		return ports
	}
	async execute(shape: NodeShape, node: DecisionSwitchNode, inputs: InputValues): Promise<ExecutionResult> {
		const decisionRaw = coerceToText(getInput(inputs, 'decision'))
		const valueInput = getInput(inputs, 'value')
		const route = routeDecision({
			mode: node.mode as 'auto' | 'noul' | 'choice' | 'score',
			decisionRaw,
			value: valueInput != null ? coerceToText(valueInput) : null,
			threshold: node.threshold,
			margin: node.margin,
			optionsText: node.options,
			bandsText: node.bands,
			lastOptions: node.lastOptions,
		})
		updateNode<DecisionSwitchNode>(this.editor, shape, (n) => ({
			...n,
			lastDecisionJson: JSON.stringify({ resolvedMode: route.resolvedMode, chosen: route.chosenPortId, parsed: route.parsed, value: route.value }),
			lastOptions: route.options.length ? route.options : n.lastOptions,
			error: null,
		}))
		return Object.fromEntries(Object.entries(route.outputs).map(([k, v]) => [k, v == null ? STOP_EXECUTION : v]))
	}
	getOutputInfo(shape: NodeShape, node: DecisionSwitchNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		const last = readLastDecision(node)
		const outs = outputPortsFor(node)
		return Object.fromEntries(
			outs.map((out) => [
				out.id,
				{
					value: last?.chosen === out.id ? (last.value ?? null) : STOP_EXECUTION,
					isOutOfDate,
					dataType: 'any' as const,
				},
			])
		)
	}
	Component = DecisionSwitchNodeComponent
}

/** A read-only output row for a dynamic output port: a visible port dot, anchored to its own
 * row (WP17), highlighted when it was the chosen branch on the last run. */
function SwitchOutputRow({ shapeId, portId, label, active }: { shapeId: NodeShape['id']; portId: string; label: string; active: boolean }) {
	const ref = useFieldPortAnchor<HTMLDivElement>(shapeId, portId)
	return (
		<NodeRow ref={ref} className="NodeRow-right">
			<span className={'NodeBranch' + (active ? ' is-active' : '')} title={label}>
				{label}
			</span>
			<Port shapeId={shapeId} portId={portId} />
		</NodeRow>
	)
}

/** One band's edit row (name + upper bound) and its output port dot, combined (WP22: "every
 * output is a visible dot on its row"). The last band in the list has no upper bound. */
function BandRow({
	shapeId,
	band,
	isLast,
	active,
	disabled = false,
	onChange,
	onRemove,
}: {
	shapeId: NodeShape['id']
	band: ScoreBand
	isLast: boolean
	active: boolean
	disabled?: boolean
	onChange: (band: ScoreBand) => void
	onRemove: () => void
}) {
	const portId = `band:${slugOption(band.name)}`
	const ref = useFieldPortAnchor<HTMLDivElement>(shapeId, portId)
	return (
		<NodeRow ref={ref} className="NodeRow-right">
			{disabled ? (
				<span className="NodeRow-connected-value">{band.name}</span>
			) : (
				<>
					<UiTextInput value={band.name} placeholder="name" onChange={(name) => onChange({ ...band, name })} />
					{!isLast && (
						<UiNumberInput
							value={band.upper ?? 0}
							step={0.01}
							min={0}
							max={1}
							onChange={(upper) => onChange({ ...band, upper })}
						/>
					)}
					<UiIconButton icon={<IconClose />} title="Remove this band" onClick={onRemove} />
				</>
			)}
			<span className={'NodeBranch' + (active ? ' is-active' : '')}>{band.name}</span>
			<Port shapeId={shapeId} portId={portId} />
		</NodeRow>
	)
}

function formatBands(bands: ScoreBand[]): string {
	return bands.map((b, i) => (i === bands.length - 1 || b.upper == null ? b.name : `${b.name}: ${b.upper}`)).join('\n')
}

function Bars({ parsed, chosen }: { parsed: ParsedDecision; chosen: string | null }) {
	if (!parsed.probabilities) {
		return parsed.answer ? <pre className="ValuePreview-text">{parsed.answer}</pre> : <span className="NodeRow-disconnected">Press ▶ Play to decide</span>
	}
	const entries = Object.entries(parsed.probabilities).sort((a, b) => b[1] - a[1])
	return (
		<div className="JevBars">
			{entries.map(([label, p]) => (
				<div key={label} className={'JevBar' + (label === parsed.answer ? ' is-top' : '')}>
					<span className="JevBar-label" title={label}>
						{label}
					</span>
					<span className="JevBar-track">
						<span className="JevBar-fill" style={{ width: `${Math.max(1, p * 100)}%` }} />
					</span>
					<span className="JevBar-value">{(p * 100).toFixed(p < 0.1 ? 1 : 0)}%</span>
				</div>
			))}
			{chosen && <div className="JevBars-source">routed → {chosen}</div>}
		</div>
	)
}

function DecisionSwitchNodeComponent({ shape, node }: NodeComponentProps<DecisionSwitchNode>) {
	const editor = useEditor()
	const set = (patch: Partial<DecisionSwitchNode>, outOfDate = true) =>
		updateNode<DecisionSwitchNode>(editor, shape, (n) => ({ ...n, ...patch }), outOfDate)
	const mode = resolvedModeFor(node)
	const last = readLastDecision(node)
	const optionsWired = useInputConnected(shape.id, 'field:options')
	const bandsWired = useInputConnected(shape.id, 'field:bands')

	const modeOptions: { value: string; label: string }[] = [
		{ value: 'auto', label: 'Auto (from the decision)' },
		{ value: 'noul', label: 'Yes / no' },
		{ value: 'choice', label: 'Choose one option' },
		{ value: 'score', label: 'Score on a scale' },
	]

	return (
		<>
			<PortRow shapeId={shape.id} portId="decision" label="Decision" dataType="any" hint="JEV probs or final" />
			<PortRow shapeId={shape.id} portId="value" label="Value" dataType="any" hint="defaults to the decision text" />
			<WireField shapeId={shape.id} fieldKey="mode" label="Mode">
				<NodeSelect className="NodeField-select" value={node.mode} onPointerDown={stopEvent} onChange={(e) => set({ mode: e.target.value })}>
					{modeOptions.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</NodeSelect>
			</WireField>

			{/* WP17: options/bands are always wirable fields, so their field-port anchor always
			 * renders here — even in a mode that doesn't use them — instead of only when the
			 * matching body below is shown. */}
			<WireFieldHeader shapeId={shape.id} fieldKey="options" label="Options" />
			{mode === 'choice' && !optionsWired && (
				<div className="NodeGrow" style={{ minHeight: OPTIONS_PX }}>
					<UiTextArea
						className="NodeField-textarea"
						grow
						value={node.options}
						placeholder="One option per line"
						onChange={(options) => set({ options })}
					/>
				</div>
			)}
			<WireFieldHeader shapeId={shape.id} fieldKey="bands" label="Bands" />

			{mode === 'noul' && (
				<>
					<WireField shapeId={shape.id} fieldKey="threshold" label="Threshold" dataType="number">
						<UiNumberInput value={node.threshold} step={0.05} min={0} max={1} onChange={(threshold) => set({ threshold: threshold ?? 0.5 })} />
					</WireField>
					<WireField shapeId={shape.id} fieldKey="margin" label="Margin" dataType="number" hint="0 = off">
						<UiNumberInput value={node.margin} step={0.05} min={0} max={1} onChange={(margin) => set({ margin: margin ?? 0 })} />
					</WireField>
					<SwitchOutputRow shapeId={shape.id} portId="yes" label="yes" active={last?.chosen === 'yes'} />
					<SwitchOutputRow shapeId={shape.id} portId="no" label="no" active={last?.chosen === 'no'} />
					<SwitchOutputRow shapeId={shape.id} portId="unsure" label="unsure" active={last?.chosen === 'unsure'} />
				</>
			)}

			{mode === 'choice' &&
				choiceOutputs(node.options, node.lastOptions).map((out) => (
					<SwitchOutputRow key={out.id} shapeId={shape.id} portId={out.id} label={out.label} active={last?.chosen === out.id} />
				))}

			{mode === 'score' &&
				(() => {
					const bands = parseBands(node.bands)
					const setBands = (next: ScoreBand[]) => set({ bands: formatBands(next.length ? next : [{ name: 'band', upper: null }]) })
					return (
						<>
							{bands.map((band, i) => (
								<BandRow
									key={i}
									shapeId={shape.id}
									band={band}
									isLast={i === bands.length - 1}
									active={last?.chosen === `band:${slugOption(band.name)}`}
									disabled={bandsWired}
									onChange={(next) => setBands(bands.map((b, j) => (j === i ? next : b)))}
									onRemove={() => setBands(bands.filter((_, j) => j !== i))}
								/>
							))}
							{!bandsWired && (
								<NodeRow>
									<UiButton
										size="sm"
										variant="low"
										icon={<IconPlus />}
										label="+ Add band"
										onClick={() => setBands([...bands.slice(0, -1), { ...bands[bands.length - 1], upper: bands[bands.length - 1]?.upper ?? 0.5 }, { name: 'band', upper: null }])}
									/>
								</NodeRow>
							)}
						</>
					)
				})()}

			<div className="NodeOutputView NodeGrow" style={{ height: BARS_PX - 8 }}>
				{last?.parsed ? <Bars parsed={last.parsed} chosen={last.chosen ?? null} /> : <span className="NodeRow-disconnected">Press ▶ Play to decide</span>}
			</div>
		</>
	)
}

// Pure helpers re-exported for tests that want to check a running card's score/band math
// against the same function the execute() path uses.
export { bandForScore, scoreFromDecision, parseDecision }
