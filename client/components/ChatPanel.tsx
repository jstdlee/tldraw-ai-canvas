import { FormEventHandler, useCallback, useRef, useState } from 'react'
import { useValue } from 'tldraw'
import { openProvidersDialog } from '../ai/aiConfig'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { ChatHistory } from './chat-history/ChatHistory'
import { ChatInput } from './ChatInput'
import { ChatPlanMessage } from './ChatPlanMessage'
import { ChatPlanEntry } from './chatPlan'
import { TodoList } from './TodoList'

export function ChatPanel() {
	const agent = useAgent()
	const inputRef = useRef<HTMLTextAreaElement>(null)
	// WP23 Part F: Build-with-AI plan messages from sending the chat with cards selected —
	// shown in the thread instead of going through the drawing agent.
	const [planEntries, setPlanEntries] = useState<ChatPlanEntry[]>([])

	const handleSubmit = useCallback<FormEventHandler<HTMLFormElement>>(
		async (e) => {
			e.preventDefault()
			if (!inputRef.current) return
			const formData = new FormData(e.currentTarget)
			const value = formData.get('input') as string

			// If the user's message is empty, just cancel the current request (if there is one)
			if (value === '') {
				agent.cancel()
				return
			}

			// Clear the chat input (context is cleared after it's captured in requestAgentActions)
			inputRef.current.value = ''

			// Sending a new message to the agent should interrupt the current request
			agent.interrupt({
				input: {
					agentMessages: [value],
					bounds: agent.editor.getViewportPageBounds(),
					source: 'user',
					contextItems: agent.context.getItems(),
				},
			})
		},
		[agent]
	)

	const handleNewChat = useCallback(() => {
		agent.reset()
	}, [agent])

	const isDark = useValue('dark mode', () => agent.editor.user.getIsDarkMode(), [agent])

	return (
		<div className={`chat-panel ${isDark ? 'tl-theme__dark' : 'tl-theme__light'}`}>
			<div className="chat-header">
				<span className="chat-header-title">Canvas agent</span>
				<button className="chat-header-link" onClick={openProvidersDialog} title="Set up AI providers and models">
					AI providers
				</button>
				<button className="new-chat-button" onClick={handleNewChat} title="New chat">
					+
				</button>
			</div>
			<ChatHistory
				agent={agent}
				trailing={planEntries.map((entry) => (
					<ChatPlanMessage
						key={entry.id}
						editor={agent.editor}
						entry={entry}
						onRevise={() => inputRef.current?.focus()}
					/>
				))}
			/>
			<div className="chat-input-container">
				<TodoList agent={agent} />
				<ChatInput
					handleSubmit={handleSubmit}
					inputRef={inputRef}
					onPlan={(entry) => setPlanEntries((entries) => [...entries, entry])}
				/>
			</div>
		</div>
	)
}
