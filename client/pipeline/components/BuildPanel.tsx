import { useMemo, useState } from 'react'
import { Editor, TLShapeId, useEditor, useValue } from 'tldraw'
import { AiPlan } from '../../../shared/aiPlan'
import { NODE_GROUPS } from '../../../shared/nodeGroups'
import { NODE_SPECS } from '../../../shared/nodeSpecs'
import { ModelSelect } from '../../ai/aiConfig'
import {
	FloatingPanel,
	IconChevronDown,
	IconChevronRight,
	IconClose,
	IconSparkle,
	UiButton,
	UiCheckbox,
	UiChip,
	UiEmpty,
	UiIconButton,
	UiSection,
	UiTextArea,
	UiTextInput,
} from '../../ui'
import {
	$buildGoalDraft,
	$buildOpen,
	applyAiPlan,
	buildWithAI,
	closeBuildPanel,
	gatherBuildScope,
	loadAllowedTypes,
	saveAllowedTypes,
} from '../aiBuild'

/** A plan ref or an existing shape id, shown as the card's name in the preview. */
function refName(editor: Editor, plan: AiPlan, ref: string): string {
	const added = plan.add.find((node) => node.ref === ref)
	if (added) return added.label || NODE_SPECS[added.type]?.title || added.type
	const shape = editor.getShape(ref as TLShapeId)
	if (shape?.type === 'node') {
		const props = shape.props as { label?: string; node: { type: string } }
		return props.label || NODE_SPECS[props.node.type]?.title || props.node.type
	}
	return ref
}

const MODEL_KEY = 'oh-my-tldraw:ai-build-model'

function loadModel(): string {
	try {
		return localStorage.getItem(MODEL_KEY) ?? ''
	} catch {
		return ''
	}
}

function saveModel(value: string) {
	try {
		localStorage.setItem(MODEL_KEY, value)
	} catch {
		// Private browsing or a full quota: the choice just does not persist.
	}
}

function typesByGroup() {
	const byGroup = new Map<string, string[]>()
	for (const [type, spec] of Object.entries(NODE_SPECS)) {
		if (spec.hidden) continue
		if (!byGroup.has(spec.group)) byGroup.set(spec.group, [])
		byGroup.get(spec.group)!.push(type)
	}
	return byGroup
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
function summarizeUpdateDiff(editor: Editor, update: AiPlan['update'][number]): string {
	const shape = editor.getShape(update.id as TLShapeId)
	const before = shape?.type === 'node' ? ((shape.props as { node: Record<string, unknown> }).node ?? {}) : {}
	return Object.entries(update.props)
		// Only real changes: a field the plan sets to its current value is not worth a line.
		.filter(([key, value]) => formatDiffValue(before[key]) !== formatDiffValue(value))
		.map(([key, value]) => `${key}: ${formatDiffValue(before[key])} → ${formatDiffValue(value)}`)
		.join(', ')
}

/**
 * A plan's rows (summary, add/update/unwire/wire/notes, warnings) — the same rendering the
 * Build panel uses, reused as-is inside an agent-chat plan message (WP23 Part F).
 */
export function AiPlanRows({ editor, plan, warnings }: { editor: Editor; plan: AiPlan; warnings: string[] }) {
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
					<span>{planNodeLine(refName(editor, plan, update.id), summarizeUpdateDiff(editor, update))}</span>
				</div>
			))}
			{plan.unwire.map((item, index) => (
				<div key={index} className="BuildPanel-planRow">
					<UiChip label="Unwire" />
					<span>
						{refName(editor, plan, item.to)}.{item.toPort}
					</span>
				</div>
			))}
			{plan.wires.map((wire, index) => (
				<div key={index} className="BuildPanel-planRow">
					<UiChip label="Wire" />
					<span>
						{refName(editor, plan, wire.from)}.{wire.fromPort} → {refName(editor, plan, wire.to)}.{wire.toPort}
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

export function BuildPanel() {
	const open = useValue('build open', () => $buildOpen.get(), [])
	if (!open) return null
	return <BuildPanelBody />
}

/** A separate component so its local state (plan, drafts) resets each time the panel opens. */
function BuildPanelBody() {
	const editor = useEditor()
	const goal = useValue('build goal', () => $buildGoalDraft.get(), [])
	const [model, setModel] = useState(loadModel)
	const [allowedTypes, setAllowedTypes] = useState<Set<string>>(() => new Set(loadAllowedTypes()))
	const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
	const [plan, setPlan] = useState<AiPlan | null>(null)
	const [warnings, setWarnings] = useState<string[]>([])
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [revise, setRevise] = useState('')
	const [runAfter, setRunAfter] = useState(false)
	const [arrangeCards, setArrangeCards] = useState(true)

	const scope = useMemo(() => gatherBuildScope(editor), [editor])
	const grouped = useMemo(typesByGroup, [])

	const setGoal = (text: string) => $buildGoalDraft.set(text)

	const toggleGroup = (groupId: string) => {
		const types = grouped.get(groupId) ?? []
		const allOn = types.every((t) => allowedTypes.has(t))
		const next = new Set(allowedTypes)
		for (const t of types) (allOn ? next.delete(t) : next.add(t))
		setAllowedTypes(next)
		saveAllowedTypes([...next])
	}

	const toggleType = (type: string) => {
		const next = new Set(allowedTypes)
		if (next.has(type)) next.delete(type)
		else next.add(type)
		setAllowedTypes(next)
		saveAllowedTypes([...next])
	}

	const close = () => {
		closeBuildPanel()
	}

	const runPlan = async (goalText: string) => {
		setBusy(true)
		setError(null)
		try {
			const result = await buildWithAI(editor, goalText, { allowedTypes: [...allowedTypes], model: model || undefined })
			setPlan(result.plan)
			setWarnings(result.warnings)
			setArrangeCards(result.plan.arrange !== 'none')
		} catch (cause) {
			setError((cause as Error).message)
		} finally {
			setBusy(false)
		}
	}

	return (
		<FloatingPanel
			storageKey="build"
			ariaLabel="Build with AI"
			defaultRect={{ w: 400, h: Math.min(640, (typeof window !== 'undefined' ? window.innerHeight : 800) - 68) }}
			minWidth={320}
			minHeight={240}
			onClose={close}
			header={
				<div className="BuildPanel-bar">
					<strong>
						<IconSparkle /> Build with AI
					</strong>
					<UiIconButton icon={<IconClose />} title="Close" onClick={close} />
				</div>
			}
		>
			<div className="BuildPanel">
			<div className="BuildPanel-using">
				{scope.nodeShapes.length === 0 && scope.notes.length === 0 ? (
					<UiEmpty text="Empty canvas — builds from scratch" />
				) : (
					<>
						{scope.nodeShapes.length > 0 && <UiChip label={`${scope.nodeShapes.length} selected node${scope.nodeShapes.length === 1 ? '' : 's'}`} />}
						{scope.notes.length > 0 && <UiChip label={`${scope.notes.length} note${scope.notes.length === 1 ? '' : 's'}`} />}
					</>
				)}
			</div>

			<UiTextArea
				value={goal}
				onChange={setGoal}
				placeholder={'Goal: e.g. "Load sales.xlsx, keep 2026 rows, total by region, show a bar chart"'}
				rows={3}
				autoFocus
				submitOn="enter"
				onSubmit={() => void runPlan(goal)}
				onKeyDown={(event) => {
					if (event.key === 'Escape') close()
				}}
			/>

			<div className="BuildPanel-row">
				<ModelSelect
					capability="agent"
					value={model}
					onChange={(value) => {
						setModel(value)
						saveModel(value)
					}}
				/>
				<UiButton variant="primary" label={busy ? 'Working…' : 'Plan'} disabled={busy || !goal.trim()} onClick={() => void runPlan(goal)} />
			</div>

			<UiSection
				title={`Node types the AI may use (${allowedTypes.size})`}
				collapsible
				defaultOpen={false}
			>
				<div className="BuildPanel-groups">
					{NODE_GROUPS.map((group) => {
						const types = grouped.get(group.id) ?? []
						if (!types.length) return null
						const onCount = types.filter((t) => allowedTypes.has(t)).length
						const expanded = expandedGroup === group.id
						return (
							<div key={group.id} className="BuildPanel-group">
								<UiChip
									label={`${group.label} (${onCount}/${types.length})`}
									active={onCount === types.length}
									onClick={() => toggleGroup(group.id)}
								/>
								<UiIconButton
									icon={expanded ? <IconChevronDown /> : <IconChevronRight />}
									title={expanded ? 'Hide types' : 'Show types'}
									onClick={() => setExpandedGroup(expanded ? null : group.id)}
								/>
								{expanded && (
									<div className="BuildPanel-types">
										{types.map((type) => (
											<UiChip
												key={type}
												label={NODE_SPECS[type].title}
												active={allowedTypes.has(type)}
												onClick={() => toggleType(type)}
											/>
										))}
									</div>
								)}
							</div>
						)
					})}
				</div>
			</UiSection>

			{error && <p className="BuildPanel-error">{error}</p>}

			{plan && (
				<div className="BuildPanel-plan">
					<div className="BuildPanel-divider">Plan</div>
					<AiPlanRows editor={editor} plan={plan} warnings={warnings} />
					<div className="BuildPanel-revise">
						<UiTextInput value={revise} onChange={setRevise} placeholder="Revise: tell it what to change" />
						<UiButton
							label="Revise"
							disabled={busy || !revise.trim()}
							onClick={() => {
								const previous = JSON.stringify(plan)
								const revisedGoal = `${goal}\n\nRevision: ${revise.trim()}\n\nPrevious plan (adjust it, do not start over unless asked):\n${previous}`
								setRevise('')
								void runPlan(revisedGoal)
							}}
						/>
					</div>
				</div>
			)}

			{plan && (plan.add.length > 0 || plan.wires.length > 0) && (
				<UiCheckbox checked={arrangeCards} onChange={setArrangeCards} label="Arrange cards (lay out new and wired cards left to right)" />
			)}
			<UiCheckbox checked={runAfter} onChange={setRunAfter} label="Run after building" />

			<div className="BuildPanel-actions">
				<UiButton label="Cancel" onClick={close} />
				<UiButton
					variant="primary"
					label="Apply plan"
					disabled={!plan || (!plan.add.length && !plan.update.length && !plan.wires.length && !plan.unwire.length)}
					onClick={() => {
						if (!plan) return
						applyAiPlan(editor, { ...plan, arrange: arrangeCards ? 'tidy' : 'none' }, { runAfter, selectedIds: scope.nodeShapes.map((s) => s.id) })
						close()
					}}
				/>
			</div>
			</div>
		</FloatingPanel>
	)
}
