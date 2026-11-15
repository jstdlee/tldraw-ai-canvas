import { useLayoutEffect, useRef, useState } from 'react'
import { AiPlan } from '../../../shared/aiPlan'
import { NODE_SPECS } from '../../../shared/nodeSpecs'
import { SmallSpinner } from '../../../shared/icons/SmallSpinner'
import { ChatHistoryTaskItem } from '../../../shared/types/ChatHistoryItem'
import {
	answerQuestion,
	applyAssistTask,
	applyBuildTask,
	applyPreview,
	buildNeed,
	discardPreview,
	discardTask,
	isTaskLive,
	rearrangeBuildPreview,
	retryTask,
	showOnCanvas,
	stopTask,
} from '../../agent/agentTasks'
import { $adjustTarget } from '../../agent/aiBarState'
import { openAgentPanel } from '../../agent/agentPanelState'
import { useAgent } from '../../agent/TldrawAgentAppProvider'
import { AiPlanRows } from '../../pipeline/components/AiPlanRows'
import type { NodeAssistResult } from '../../pipeline/assist'
import { IconSparkle, UiButton, UiCheckbox, UiChip } from '../../ui'
import { MarkdownMessage } from './MarkdownMessage'

function formatValue(value: unknown): string {
	if (value == null || value === '') return '—'
	if (typeof value === 'string') return value.length > 60 ? value.slice(0, 60) + '…' : value
	return String(value)
}

/**
 * WP44/WP48: one task in the thread — running (spinner + Stop), a preview (its change is on
 * the canvas, marked: Apply / Adjust / Discard), a result, a question with answer chips, or an
 * error with Retry.
 */
export function ChatTaskMessage({ item }: { item: ChatHistoryTaskItem }) {
	const agent = useAgent()
	// A task saved as "running" whose request is gone (the page reloaded) can only be retried.
	const status = item.status === 'running' && !isTaskLive(item.id) ? 'interrupted' : item.status
	return (
		<div className={`chat-task chat-task-${status}`} data-task-route={item.route} data-task-status={item.status}>
			<div className="chat-task-head">
				{status === 'running' ? <SmallSpinner /> : <IconSparkle size={14} />}
				<span className="chat-task-label">{item.label}</span>
				<span className="chat-task-scope">{item.scopeLabel}</span>
				{status === 'running' && <UiButton size="sm" variant="low" label="Stop" onClick={() => stopTask(agent, item.id)} />}
			</div>
			{status === 'interrupted' && (
				<div className="chat-task-error" role="alert">
					<span>Stopped when the page reloaded.</span>
					<UiButton size="sm" label="Retry" onClick={() => retryTask(agent, item.id)} />
				</div>
			)}
			{status === 'error' && (
				<div className="chat-task-error" role="alert">
					<span>{item.error}</span>
					<UiButton size="sm" label="Retry" onClick={() => retryTask(agent, item.id)} />
				</div>
			)}
			{status !== 'running' && status !== 'error' && status !== 'interrupted' && <TaskBody item={item} />}
		</div>
	)
}

function TaskBody({ item }: { item: ChatHistoryTaskItem }) {
	switch (item.route) {
		case 'build':
			return item.plan ? <BuildBody item={item} /> : <ResultBody item={item} />
		case 'node-assist':
			return item.assist ? <AssistBody item={item} /> : <ResultBody item={item} />
		case 'ask-user':
			return <QuestionBody item={item} />
		default:
			return <ResultBody item={item} />
	}
}

/** Apply / Adjust / Discard for a preview, or its final state. */
export function PreviewActions({ item, onApply }: { item: ChatHistoryTaskItem; onApply?: () => void }) {
	const agent = useAgent()
	if (item.status === 'preview') {
		return (
			<div className="chat-task-actions chat-task-preview-actions">
				<UiButton
					size="sm"
					variant="primary"
					label="Apply"
					onClick={() => (onApply ? onApply() : applyPreview(agent, item.id))}
				/>
				<UiButton
					size="sm"
					label="Adjust"
					title="Say what to change: the next message revises this preview"
					onClick={() => {
						$adjustTarget.set(item.id)
						openAgentPanel({ focus: true })
					}}
				/>
				<UiButton size="sm" label="Discard" onClick={() => discardPreview(agent, item.id)} />
				<span className="chat-task-hint">Preview on the canvas</span>
			</div>
		)
	}
	if (item.status === 'applied' || item.status === 'discarded') {
		return (
			<div className="chat-task-actions">
				<span className="chat-task-state">{item.status === 'applied' ? 'Applied' : 'Discarded'}</span>
				{item.status === 'applied' && !!item.placedIds?.length && (
					<UiButton size="sm" label="Show on canvas" onClick={() => showOnCanvas(agent.editor, item.placedIds!)} />
				)}
			</div>
		)
	}
	return null
}

/** The result text (Markdown, at most 8 lines until "Show more") and "Show on canvas". */
function ResultBody({ item }: { item: ChatHistoryTaskItem }) {
	const agent = useAgent()
	const isPreviewTask = item.previewDiff != null
	return (
		<>
			{item.text && <ClampedMarkdown text={item.text} />}
			{isPreviewTask ? (
				<PreviewActions item={item} />
			) : (
				!!item.placedIds?.length && (
					<div className="chat-task-actions">
						<UiButton size="sm" label="Show on canvas" onClick={() => showOnCanvas(agent.editor, item.placedIds!)} />
					</div>
				)
			)}
		</>
	)
}

function QuestionBody({ item }: { item: ChatHistoryTaskItem }) {
	const agent = useAgent()
	const open = item.status === 'done'
	return (
		<>
			{item.text && <div className="chat-task-question">{item.text}</div>}
			{!!item.options?.length && (
				<div className="chat-task-options-chips">
					{item.options.map((option) => (
						<UiChip
							key={option}
							label={option}
							active={item.answer === option}
							onClick={open ? () => answerQuestion(agent, item.id, option) : undefined}
						/>
					))}
				</div>
			)}
			{open ? (
				<span className="chat-task-hint">Pick an answer or type one below.</span>
			) : (
				item.answer && <span className="chat-task-state">Answered: {item.answer}</span>
			)}
		</>
	)
}

function ClampedMarkdown({ text }: { text: string }) {
	const ref = useRef<HTMLDivElement>(null)
	const [expanded, setExpanded] = useState(false)
	const [overflows, setOverflows] = useState(false)
	useLayoutEffect(() => {
		const el = ref.current
		if (!el || expanded) return
		setOverflows(el.scrollHeight > el.clientHeight + 1)
	}, [text, expanded])
	return (
		<>
			<div ref={ref} className={'chat-task-text agent-action-description' + (expanded ? '' : ' is-clamped')}>
				<MarkdownMessage text={text} />
			</div>
			{(overflows || expanded) && (
				<button type="button" className="chat-task-more" onClick={() => setExpanded((v) => !v)}>
					{expanded ? 'Show less' : 'Show more'}
				</button>
			)}
		</>
	)
}

function BuildBody({ item }: { item: ChatHistoryTaskItem }) {
	const agent = useAgent()
	const plan = item.plan as AiPlan
	const [runAfter, setRunAfter] = useState(false)
	const [legacyArrange, setLegacyArrange] = useState(plan.arrange !== 'none')
	const hasChanges = !!(plan.add.length || plan.update.length || plan.wires.length || plan.unwire.length)
	const preview = item.status === 'preview'
	// Saved before WP48: a plan still waiting with no preview on the canvas.
	const legacyOpen = item.status === 'done' && hasChanges && item.previewDiff == null
	const arrange = preview ? item.arranged !== false : legacyArrange
	return (
		<>
			<div className="chat-task-plan">
				<AiPlanRows editor={agent.editor} plan={plan} warnings={item.warnings ?? []} names={item.planNames} before={item.planBefore} />
			</div>
			{(preview || legacyOpen) && (
				<div className="chat-task-options">
					{(plan.add.length > 0 || plan.wires.length > 0) && (
						<UiCheckbox
							checked={arrange}
							onChange={(next) => (preview ? rearrangeBuildPreview(agent, item.id, next) : setLegacyArrange(next))}
							label="Arrange cards"
						/>
					)}
					<UiCheckbox checked={runAfter} onChange={setRunAfter} label="Run after building" />
				</div>
			)}
			{legacyOpen ? (
				<div className="chat-task-actions">
					<UiButton
						size="sm"
						variant="primary"
						label="Apply"
						onClick={() => applyBuildTask(agent, item.id, { arrange: legacyArrange, runAfter })}
					/>
					<UiButton size="sm" label="Discard" onClick={() => discardTask(agent, item.id)} />
				</div>
			) : (
				<PreviewActions item={item} onApply={() => applyPreview(agent, item.id, { runAfter })} />
			)}
		</>
	)
}

function AssistBody({ item }: { item: ChatHistoryTaskItem }) {
	const agent = useAgent()
	const assist = item.assist as NodeAssistResult
	const cardId = item.scopeIds[0]
	const legacyOpen = item.status === 'done' && assist.changes.length > 0 && item.previewDiff == null
	return (
		<>
			{assist.say && <ClampedMarkdown text={assist.say} />}
			{assist.changes.length > 0 && (
				<div className="chat-task-diff">
					{assist.changes.map((change) => (
						<div key={change.key} className="chat-task-diffRow" data-field={change.key}>
							<span className="chat-task-diffLabel">{change.label}</span>
							<span>
								{formatValue(change.before)} → {formatValue(change.after)}
							</span>
						</div>
					))}
				</div>
			)}
			{assist.needs.map((need, index) => (
				<div key={index} className="chat-task-need">
					<span>
						Needs: a {NODE_SPECS[need.type]?.title ?? need.type} card{need.why ? ` — ${need.why}` : ''}
					</span>
					<UiButton size="sm" label="Build it" onClick={() => buildNeed(agent, cardId, need)} />
				</div>
			))}
			{assist.errors.map((err, index) => (
				<p key={index} className="chat-task-warning">
					{err}
				</p>
			))}
			{legacyOpen ? (
				<div className="chat-task-actions">
					<UiButton size="sm" variant="primary" label="Apply" onClick={() => applyAssistTask(agent, item.id)} />
					<UiButton size="sm" label="Discard" onClick={() => discardTask(agent, item.id)} />
				</div>
			) : (
				<PreviewActions item={item} />
			)}
		</>
	)
}
