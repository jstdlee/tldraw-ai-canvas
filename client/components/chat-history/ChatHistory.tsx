import { ReactNode, useEffect, useRef } from 'react'
import { useValue } from 'tldraw'
import { IconSparkle } from '../../ui'
import { TldrawAgent } from '../../agent/TldrawAgent'
import { ChatHistorySection, getAgentHistorySections } from './ChatHistorySection'

/** WP28 Part C: shown when a new chat has no messages yet. Each chip sends a ready-made
 * request so a user can get going without having to think of a first prompt. */
const SUGGESTIONS = [
	{ label: 'Draw a flowchart', message: 'Draw a simple flowchart with 3 steps' },
	{ label: 'Sketch an idea', message: 'Sketch a rough idea for a mobile app home screen' },
	{ label: 'Build with my cards', message: 'Wire up the cards I have on the canvas' },
	{ label: 'What can you do?', message: 'What can you help me with here?' },
]

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

export function ChatHistory({
	agent,
	trailing,
}: {
	agent: TldrawAgent
	/** WP23 Part F: Build-with-AI plan messages, rendered after the agent's own history so
	 * they scroll with it, inside the same chat thread. */
	trailing?: ReactNode
}) {
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

	const sendSuggestion = (message: string) => {
		agent.interrupt({
			input: {
				agentMessages: [message],
				bounds: agent.editor.getViewportPageBounds(),
				source: 'user',
				contextItems: agent.context.getItems(),
			},
		})
	}

	const hasTrailing = Array.isArray(trailing) ? trailing.length > 0 : !!trailing

	if (sections.length === 0 && !hasTrailing) {
		return (
			<div className="chat-history chat-history-empty">
				<div className="chat-empty-state">
					<IconSparkle size={22} />
					<p className="chat-empty-state-title">Ask, learn, or start drawing</p>
					<p className="chat-empty-state-subtitle">
						Chat about the canvas, or pick something to try:
					</p>
					<div className="chat-empty-state-suggestions">
						{SUGGESTIONS.map((s) => (
							<button key={s.label} type="button" className="chat-suggestion-chip" onClick={() => sendSuggestion(s.message)}>
								{s.label}
							</button>
						))}
					</div>
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
			{trailing}
		</div>
	)
}
