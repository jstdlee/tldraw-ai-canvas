import { useEffect, useRef } from 'react'
import { useValue } from 'tldraw'
import { IconSparkle } from '../../ui'
import { TldrawAgent } from '../../agent/TldrawAgent'
import { ChatHistorySection, getAgentHistorySections } from './ChatHistorySection'

/*
Chat history is stored as a list of history items.

Within the UI, we split this list of items into sections.
Each section contains a user prompt item, and all the agent's actions that follow it.

Each section is rendered as a separate component.
The model's actions are grouped together into collapsible groups if appropriate.


Here's an example of how the UI might look:

- Chat history
	- Section
		- Prompt
		- Action group
			- Action
			- Action
		- Action group
			- Action
	- Section
		- Prompt
		- Action group
			- Action

*/

export function ChatHistory({ agent }: { agent: TldrawAgent }) {
	const historyItems = useValue('chatHistory', () => agent.chat.getHistory(), [agent])
	const sections = getAgentHistorySections(historyItems)
	const historyRef = useRef<HTMLDivElement>(null)
	const previousScrollDistanceFromBottomRef = useRef(0)

	useEffect(() => {
		if (!historyRef.current) return

		// If a new prompt is submitted by the user, scroll to the bottom
		if (historyItems.at(-1)?.type === 'prompt') {
			if (previousScrollDistanceFromBottomRef.current <= 0) {
				historyRef.current.scrollTo(0, historyRef.current.scrollHeight)
				previousScrollDistanceFromBottomRef.current = 0
			}
			return
		}

		// If the user is scrolled to the bottom, keep them there while new actions appear
		if (previousScrollDistanceFromBottomRef.current <= 0) {
			const scrollDistanceFromBottom =
				historyRef.current.scrollHeight -
				historyRef.current.scrollTop -
				historyRef.current.clientHeight

			if (scrollDistanceFromBottom > 0) {
				historyRef.current.scrollTo(0, historyRef.current.scrollHeight)
			}
		}
	}, [historyRef, historyItems])

	// Keep track of the user's scroll position
	const handleScroll = () => {
		if (!historyRef.current) return
		const scrollDistanceFromBottom =
			historyRef.current.scrollHeight -
			historyRef.current.scrollTop -
			historyRef.current.clientHeight

		previousScrollDistanceFromBottomRef.current = scrollDistanceFromBottom
	}

	const isGenerating = useValue('isGenerating', () => agent.requests.isGenerating(), [agent])

	if (sections.length === 0) {
		// WP28 Part C / WP44: the quick action chips above the thread are the "what to try" list.
		return (
			<div className="chat-history chat-history-empty">
				<div className="chat-empty-state">
					<IconSparkle size={22} />
					<p className="chat-empty-state-title">Ask, draw, or build</p>
					<p className="chat-empty-state-subtitle">
						Select something on the canvas, then pick an action above or type below.
					</p>
				</div>
			</div>
		)
	}

	return (
		<div className="chat-history" ref={historyRef} onScroll={handleScroll}>
			{sections.map((section, i) => {
				return (
					<ChatHistorySection
						key={'history-section-' + i}
						id={'chat-section-' + i}
						section={section}
						loading={i === sections.length - 1 && isGenerating}
					/>
				)
			})}
		</div>
	)
}
