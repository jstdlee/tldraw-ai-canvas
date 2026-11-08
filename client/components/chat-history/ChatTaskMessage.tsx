import { useLayoutEffect, useRef, useState } from 'react'
import { AiPlan } from '../../../shared/aiPlan'
import { NODE_SPECS } from '../../../shared/nodeSpecs'
import { SmallSpinner } from '../../../shared/icons/SmallSpinner'
import { ChatHistoryTaskItem } from '../../../shared/types/ChatHistoryItem'
import {
	applyAssistTask,
	applyBuildTask,
	buildNeed,
	discardTask,
	isTaskLive,
	retryTask,
	showOnCanvas,
	stopTask,
} from '../../agent/agentTasks'
import { useAgent } from '../../agent/TldrawAgentAppProvider'
import { AiPlanRows } from '../../pipeline/components/AiPlanRows'
import type { NodeAssistResult } from '../../pipeline/assist'
import { IconSparkle, UiButton, UiCheckbox } from '../../ui'
import { MarkdownMessage } from './MarkdownMessage'

function formatValue(value: unknown): string {
	if (value == null || value === '') return '—'
	if (typeof value === 'string') return value.length > 60 ? value.slice(0, 60) + '…' : value
	return String(value)
}

/**
 * WP44: one agent-panel task in the thread — running (spinner + Stop), its result (text with
 * "Show on canvas", a build plan with Apply / Discard, a card assist with change rows), or an
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
			return item.plan ? <BuildBody item={item} /> : null
		case 'node-assist':
			return item.assist ? <AssistBody item={item} /> : null
		default:
			return <ResultBody item={item} />
	}
}

/** The result text (Markdown, at most 8 lines until "Show more") and "Show on canvas". */
function ResultBody({ item }: { item: ChatHistoryTaskItem }) {
	const agent = useAgent()
	return (
		<>
			{item.text && <ClampedMarkdown text={item.text} />}
			{!!item.placedIds?.length && (
				<div className="chat-task-actions">
					<UiButton size="sm" label="Show on canvas" onClick={() => showOnCanvas(agent.editor, item.placedIds!)} />
				</div>
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
	const [arrange, setArrange] = useState(plan.arrange !== 'none')
	const [runAfter, setRunAfter] = useState(false)
	const hasChanges = !!(plan.add.length || plan.update.length || plan.wires.length || plan.unwire.length)
	const open = item.status === 'done'
	return (
		<>
			<div className="chat-task-plan">
				<AiPlanRows editor={agent.editor} plan={plan} warnings={item.warnings ?? []} />
			</div>
			{open && hasChanges && (
				<div className="chat-task-options">
					{(plan.add.length > 0 || plan.wires.length > 0) && (
						<UiCheckbox checked={arrange} onChange={setArrange} label="Arrange cards" />
					)}
					<UiCheckbox checked={runAfter} onChange={setRunAfter} label="Run after building" />
				</div>
			)}
			<div className="chat-task-actions">
				{open ? (
					<>
						<UiButton
							size="sm"
							variant="primary"
							label="Apply"
							disabled={!hasChanges}
							onClick={() => applyBuildTask(agent, item.id, { arrange, runAfter })}
						/>
						<UiButton size="sm" label="Discard" onClick={() => discardTask(agent, item.id)} />
						<span className="chat-task-hint">Type below to revise the plan.</span>
					</>
				) : (
					<>
						<span className="chat-task-state">{item.status === 'applied' ? 'Applied' : 'Discarded'}</span>
						{item.status === 'applied' && !!item.placedIds?.length && (
							<UiButton size="sm" label="Show on canvas" onClick={() => showOnCanvas(agent.editor, item.placedIds!)} />
						)}
					</>
				)}
			</div>
		</>
	)
}

function AssistBody({ item }: { item: ChatHistoryTaskItem }) {
	const agent = useAgent()
	const assist = item.assist as NodeAssistResult
	const cardId = item.scopeIds[0]
	const open = item.status === 'done'
	return (
		<>
			{assist.say && <ClampedMarkdown text={assist.say} />}
			{assist.changes.length > 0 && (
				<div className="chat-task-diff">
					{assist.changes.map((change) => (
						<div key={change.key} className="chat-task-diffRow">
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
			{assist.changes.length > 0 && (
				<div className="chat-task-actions">
					{open ? (
						<>
							<UiButton size="sm" variant="primary" label="Apply" onClick={() => applyAssistTask(agent, item.id)} />
							<UiButton size="sm" label="Discard" onClick={() => discardTask(agent, item.id)} />
						</>
					) : (
						<span className="chat-task-state">{item.status === 'applied' ? 'Applied' : 'Discarded'}</span>
					)}
				</div>
			)}
		</>
	)
}
