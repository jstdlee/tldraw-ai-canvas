import { useMemo, useState } from 'react'
import { AgentIcon } from '../../../shared/icons/AgentIcon'
import { ChevronDownIcon } from '../../../shared/icons/ChevronDownIcon'
import { ChevronRightIcon } from '../../../shared/icons/ChevronRightIcon'
import { AgentAction } from '../../../shared/types/AgentAction'
import { ChatHistoryActionItem } from '../../../shared/types/ChatHistoryItem'
import { Streaming } from '../../../shared/types/Streaming'
import { useAgent } from '../../agent/TldrawAgentAppProvider'
import { ChatHistoryGroup } from './ChatHistoryGroup'
import { getActionInfo } from './getActionInfo'
import { MarkdownMessage } from './MarkdownMessage'

export function ChatHistoryGroupWithoutDiff({ group }: { group: ChatHistoryGroup }) {
	const agent = useAgent()
	const { items } = group

	const nonEmptyItems = useMemo(() => {
		return items.filter((item) => {
			const { description } = getActionInfo(item.action, agent)
			return description !== null
		})
	}, [items, agent])

	const [collapsed, setCollapsed] = useState(true)

	const complete = useMemo(() => {
		return items.every((item) => item.action.complete)
	}, [items])

	const summary = useMemo(() => {
		const time = Math.floor(items.reduce((acc, item) => acc + item.action.time, 0) / 1000)
		if (time === 0) return 'Thought for less than a second'
		if (time === 1) return 'Thought for 1 second'
		return `Thought for ${time} seconds`
	}, [items])

	if (nonEmptyItems.length === 0) {
		return null
	}

	if (nonEmptyItems.length < 2) {
		return (
			<div className="chat-history-group">
				{nonEmptyItems.map((item, i) => {
					return <ChatHistoryItem item={item} key={'action-' + i} />
				})}
			</div>
		)
	}

	const showContent = !collapsed || !complete

	return (
		<div className="chat-history-group">
			{complete && (
				<button onClick={() => setCollapsed((v) => !v)}>
					<span>{showContent ? <ChevronDownIcon /> : <ChevronRightIcon />}</span>
					{summary}
				</button>
			)}
			{showContent && (
				<div className="agent-actions-container">
					{nonEmptyItems.map((item, i) => {
						return <ChatHistoryItemExpanded action={item.action} key={'action-' + i} />
					})}
				</div>
			)}
		</div>
	)
}

function ChatHistoryItem({ item }: { item: ChatHistoryActionItem }) {
	const agent = useAgent()
	const { action } = item
	const { description, summary } = getActionInfo(action, agent)
	const collapsible = summary !== null
	const [collapsed, setCollapsed] = useState(collapsible)

	if (!description) return null

	return (
		<div className="agent-actions-container">
			{action.complete && collapsible && (
				<button onClick={() => setCollapsed((v) => !v)}>
					<span>{collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}</span>
					{summary}
				</button>
			)}

			{(!collapsed || !action.complete) && <ChatHistoryItemExpanded action={action} />}
		</div>
	)
}

function ChatHistoryItemExpanded({ action }: { action: Streaming<AgentAction> }) {
	const agent = useAgent()
	const { icon, description } = getActionInfo(action, agent)
	// WP28 Part C: a `message` action is the assistant actually talking to the user, so it
	// gets its own bubble with a small avatar icon, distinct from the compact tool-step rows
	// used for every other action type (create, update, review, and so on).
	const isMessage = action._type === 'message'

	return (
		<div className={`agent-action agent-action-type-${action._type}${isMessage ? ' agent-message-bubble' : ''}`}>
			{isMessage ? (
				<span className="agent-message-avatar">
					<AgentIcon type="comment" />
				</span>
			) : (
				icon && (
					<span>
						<AgentIcon type={icon} />
					</span>
				)
			)}
			<span className="agent-action-description">
				<MarkdownMessage text={description} />
			</span>
		</div>
	)
}
