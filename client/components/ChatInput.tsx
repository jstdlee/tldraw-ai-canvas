import { useValue, Editor } from 'tldraw'
import { AtIcon } from '../../shared/icons/AtIcon'
import type { QuickAction } from '../../shared/agentRouting'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { IconClose, IconPlay, IconStop } from '../ui'
import { ContextItemTag } from './ContextItemTag'

/** WP28 Part C: grows the textarea to fit its content (up to the CSS max-height, which
 * then scrolls), instead of a fixed-size box. */
export function autoGrow(el: HTMLTextAreaElement) {
	el.style.height = 'auto'
	el.style.height = el.scrollHeight + 'px'
}

/**
 * WP44: the agent panel's one input. Enter sends, Shift+Enter is a new line. There is no
 * Draw/Build mode any more: the panel routes each message from the scope (routeAgentTask).
 * `pending` is a quick action waiting for its one extra answer (Translate…: the language).
 */
export function ChatInput({
	inputRef,
	value,
	onChange,
	onSend,
	pending,
	onClearPending,
}: {
	inputRef: React.RefObject<HTMLTextAreaElement | null>
	value: string
	onChange: (value: string) => void
	onSend: (text: string) => void
	pending: QuickAction | null
	onClearPending: () => void
}) {
	const agent = useAgent()
	const { editor } = agent
	const isGenerating = useValue('isGenerating', () => agent.requests.isGenerating(), [agent])

	const isContextToolActive = useValue(
		'isContextToolActive',
		() => {
			const tool = editor.getCurrentTool()
			return tool.id === 'target-shape' || tool.id === 'target-area'
		},
		[editor]
	)
	const contextItems = useValue('contextItems', () => agent.context.getItems(), [agent])

	const send = () => {
		const text = value
		onChange('')
		if (inputRef.current) inputRef.current.style.height = 'auto'
		onSend(text)
	}

	return (
		<div className="chat-input">
			<form
				onSubmit={(e) => {
					e.preventDefault()
					send()
				}}
			>
				<div className="prompt-tags">
					<div className={'chat-context-select ' + (isContextToolActive ? 'active' : '')}>
						<div className="chat-context-select-label">
							<AtIcon /> Add Context
						</div>
						<select
							id="chat-context-select"
							value=" "
							onChange={(e) => {
								const action = ADD_CONTEXT_ACTIONS.find((action) => action.name === e.target.value)
								if (action) action.onSelect(editor)
							}}
						>
							{ADD_CONTEXT_ACTIONS.map((action) => {
								return (
									<option key={action.name} value={action.name}>
										{action.name}
									</option>
								)
							})}
						</select>
					</div>
					{contextItems.map((item, i) => (
						<ContextItemTag
							editor={editor}
							onClick={() => agent.context.remove(item)}
							key={'context-item-' + i}
							item={item}
						/>
					))}
					{pending && (
						<button type="button" className="agent-pending-tag" title="Cancel this action" onClick={onClearPending}>
							{pending.label}
							<IconClose size={12} />
						</button>
					)}
				</div>

				<textarea
					ref={inputRef}
					name="input"
					autoComplete="off"
					rows={1}
					placeholder={pending?.placeholder ?? 'Ask, draw, build, or pick an action above'}
					value={value}
					onInput={(e) => {
						onChange(e.currentTarget.value)
						autoGrow(e.currentTarget)
					}}
					onKeyDown={(e) => {
						if (e.key === 'Escape' && pending) {
							e.preventDefault()
							onClearPending()
							return
						}
						if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
							e.preventDefault()
							send()
						}
					}}
				/>
				<span className="chat-actions">
					<button
						className="chat-input-submit"
						title={isGenerating && value === '' ? 'Stop' : 'Send'}
						disabled={value === '' && !isGenerating}
					>
						{isGenerating && value === '' ? <IconStop size={14} /> : <IconPlay size={14} />}
					</button>
				</span>
			</form>
		</div>
	)
}

const ADD_CONTEXT_ACTIONS = [
	{
		name: 'Pick Shapes',
		onSelect: (editor: Editor) => {
			editor.setCurrentTool('target-shape')
			editor.focus()
		},
	},
	{
		name: 'Pick Area',
		onSelect: (editor: Editor) => {
			editor.setCurrentTool('target-area')
			editor.focus()
		},
	},
	{
		name: ' ',
		onSelect: (editor: Editor) => {
			const currentTool = editor.getCurrentTool()
			if (currentTool.id === 'target-area' || currentTool.id === 'target-shape') {
				editor.setCurrentTool('select')
			}
		},
	},
]
