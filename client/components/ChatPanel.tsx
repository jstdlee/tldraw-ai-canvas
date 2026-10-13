import { FormEventHandler, useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useValue } from 'tldraw'
import { getModelLabel, openProvidersDialog } from '../ai/aiConfig'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { IconClose, IconSparkle, UiIconButton } from '../ui'
import { ChatHistory } from './chat-history/ChatHistory'
import { getAgentHistorySections } from './chat-history/ChatHistorySection'
import { ChatInput } from './ChatInput'
import { ChatPlanMessage } from './ChatPlanMessage'
import { ChatPlanEntry } from './chatPlan'
import { TodoList } from './TodoList'

/**
 * WP28 Part C: the chat panel's whole header — mounted in the floating panel's draggable
 * bar (`client/App.tsx`), not inside `ChatPanel` itself, so title, model chip, new chat,
 * history and close all live in one row instead of two stacked header bars.
 */
export function ChatPanelHeader({ onClose }: { onClose: () => void }) {
	const agent = useAgent()
	const modelName = useValue('modelName', () => agent.modelName.getModelName(), [agent])
	const modelLabel = useValue('model label', () => getModelLabel(modelName || null, 'agent'), [modelName])
	const [historyOpen, setHistoryOpen] = useState(false)
	const [historyAnchor, setHistoryAnchor] = useState<{ top: number; right: number } | null>(null)
	const historyButtonRef = useRef<HTMLButtonElement>(null)
	const historyItems = useValue('chatHistory for history menu', () => agent.chat.getHistory(), [agent])
	const prompts = getAgentHistorySections(historyItems)
		.map((section, i) => ({ i, text: section.prompt.userFacingMessage ?? section.prompt.agentFacingMessage }))
		.filter((p) => p.text.trim() !== '')

	const toggleHistory = () => {
		if (!historyOpen && historyButtonRef.current) {
			// WP28 Part C: the popover is portalled to <body> and positioned here, because the
			// floating panel clips overflow (so its own content never spills past its edges) —
			// an absolutely-positioned popover inside it would get cut off.
			const rect = historyButtonRef.current.getBoundingClientRect()
			setHistoryAnchor({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
		}
		setHistoryOpen((v) => !v)
	}

	const jumpTo = (i: number) => {
		setHistoryOpen(false)
		document.getElementById('chat-section-' + i)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
	}

	return (
		<div className="chat-float-bar">
			<strong className="chat-float-bar-title">
				<IconSparkle size={16} /> Agent chat
			</strong>
			<button
				className="chat-model-chip"
				type="button"
				title="Set up AI providers and models"
				onClick={openProvidersDialog}
			>
				{modelLabel}
			</button>
			<div className="chat-float-bar-actions">
				<div className="chat-history-menu">
					<UiIconButton
						ref={historyButtonRef}
						icon={<HistoryIcon />}
						title="Jump to an earlier message"
						active={historyOpen}
						onClick={toggleHistory}
					/>
					{historyOpen &&
						historyAnchor &&
						createPortal(
							<>
								<div className="chat-history-menu-backdrop" onClick={() => setHistoryOpen(false)} />
								<div
									className="chat-history-menu-popover"
									style={{ position: 'fixed', top: historyAnchor.top, right: historyAnchor.right }}
								>
									{prompts.length === 0 ? (
										<div className="chat-history-menu-empty">No messages yet</div>
									) : (
										prompts.map(({ i, text }) => (
											<button key={i} type="button" onClick={() => jumpTo(i)}>
												{text.length > 60 ? text.slice(0, 60) + '…' : text}
											</button>
										))
									)}
								</div>
							</>,
							document.body
						)}
				</div>
				<UiIconButton icon={<IconSparkle size={14} />} title="New chat" onClick={() => agent.reset()} />
				<UiIconButton icon={<IconClose />} title="Close" onClick={onClose} />
			</div>
		</div>
	)
}

function HistoryIcon() {
	return (
		<svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M2.5 8a5.5 5.5 0 1 1 1.6 3.9" />
			<path d="M2 5.5V8h2.5" />
			<path d="M8 5v3l2 1.2" />
		</svg>
	)
}

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

	const isDark = useValue('dark mode', () => agent.editor.user.getIsDarkMode(), [agent])

	return (
		<div className={`chat-panel ${isDark ? 'tl-theme__dark' : 'tl-theme__light'}`}>
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
