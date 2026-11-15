import { Editor, TLShapeId } from 'tldraw'
import { AiPlan } from '../../../shared/aiPlan'
import { NODE_SPECS } from '../../../shared/nodeSpecs'
import { UiChip } from '../../ui'

/**
 * WP44: a Build-with-AI plan's rows (summary, add/update/unwire/wire/notes, warnings), shown
 * in the agent panel's build task message. Moved out of the old Build panel unchanged.
 */

/** A plan ref or an existing shape id, shown as the card's name in the preview. */
function refName(editor: Editor, plan: AiPlan, ref: string, names?: Record<string, string>): string {
	// WP48 bug 3: names frozen when the plan was made, so applied plans never show raw ids.
	if (names?.[ref]) return names[ref]
	const added = plan.add.find((node) => node.ref === ref)
	if (added) return added.label || NODE_SPECS[added.type]?.title || added.type
	const shape = editor.getShape(ref as TLShapeId)
	if (shape?.type === 'node') {
		const props = shape.props as { label?: string; node: { type: string } }
		return props.label || NODE_SPECS[props.node.type]?.title || props.node.type
	}
	// A card that is gone: never show its raw "shape:…" id.
	return ref.startsWith('shape:') ? 'a removed card' : ref
}

function planNodeLine(label: string, propsText: string) {
	return propsText ? `${label} — ${propsText}` : label
}

function summarizeProps(props: Record<string, unknown>): string {
	return Object.entries(props)
		.slice(0, 3)
		.map(([key, value]) => `${key}=${String(value).slice(0, 40)}`)
		.join(', ')
}

function formatDiffValue(value: unknown): string {
	if (value == null || value === '') return '—'
	const s = String(value)
	return s.length > 24 ? s.slice(0, 24) + '…' : s
}

/** WP22 B4: an update's own field diffs, e.g. "op: select → filter". */
function summarizeUpdateDiff(editor: Editor, update: AiPlan['update'][number], frozen?: Record<string, unknown>): string {
	const shape = editor.getShape(update.id as TLShapeId)
	const before = frozen ?? (shape?.type === 'node' ? ((shape.props as { node: Record<string, unknown> }).node ?? {}) : {})
	return Object.entries(update.props)
		// Only real changes: a field the plan sets to its current value is not worth a line.
		.filter(([key, value]) => formatDiffValue(before[key]) !== formatDiffValue(value))
		.map(([key, value]) => `${key}: ${formatDiffValue(before[key])} → ${formatDiffValue(value)}`)
		.join(', ')
}

export function AiPlanRows({
	editor,
	plan,
	warnings,
	names,
	before,
}: {
	editor: Editor
	plan: AiPlan
	warnings: string[]
	/** WP48: card names and field values from before the plan was put on the canvas. */
	names?: Record<string, string>
	before?: Record<string, Record<string, unknown>>
}) {
	return (
		<>
			<p className="BuildPanel-summary">{plan.summary}</p>
			{plan.add.map((node) => (
				<div key={node.ref} className="BuildPanel-planRow">
					<UiChip label="Add" />
					<span>{planNodeLine(`${NODE_SPECS[node.type]?.title ?? node.type}${node.label ? ` "${node.label}"` : ''}`, summarizeProps(node.props))}</span>
				</div>
			))}
			{plan.update.map((update) => (
				<div key={update.id} className="BuildPanel-planRow">
					<UiChip label="Update" />
					<span>{planNodeLine(refName(editor, plan, update.id, names), summarizeUpdateDiff(editor, update, before?.[update.id]))}</span>
				</div>
			))}
			{plan.unwire.map((item, index) => (
				<div key={index} className="BuildPanel-planRow">
					<UiChip label="Unwire" />
					<span>
						{refName(editor, plan, item.to, names)}.{item.toPort}
					</span>
				</div>
			))}
			{plan.wires.map((wire, index) => (
				<div key={index} className="BuildPanel-planRow">
					<UiChip label="Wire" />
					<span>
						{refName(editor, plan, wire.from, names)}.{wire.fromPort} → {refName(editor, plan, wire.to, names)}.{wire.toPort}
					</span>
				</div>
			))}
			{plan.notes.map((note, index) => (
				<div key={index} className="BuildPanel-planRow BuildPanel-note">
					<UiChip label="Note" />
					<span>{note}</span>
				</div>
			))}
			{warnings.map((warning, index) => (
				<div key={index} className="BuildPanel-planRow BuildPanel-warning">
					<UiChip label="Warning" />
					<span>{warning}</span>
				</div>
			))}
		</>
	)
}
