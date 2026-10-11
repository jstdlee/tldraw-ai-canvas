import { FormEventHandler, useState } from 'react'
import { Editor, useValue } from 'tldraw'
import { AtIcon } from '../../shared/icons/AtIcon'
import { BrainIcon } from '../../shared/icons/BrainIcon'
import { ChevronDownIcon } from '../../shared/icons/ChevronDownIcon'
import { getModelLabel, ModelSelect } from '../ai/aiConfig'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { openBuildPanel } from '../pipeline/aiBuild'
import { UiButton } from '../ui'
import { ContextItemTag } from './ContextItemTag'
import { SelectionTag } from './SelectionTag'

export function ChatInput({
	handleSubmit,
	inputRef,
}: {
	handleSubmit: FormEventHandler<HTMLFormElement>
	inputRef: React.RefObject<HTMLTextAreaElement | null>
}) {
	const agent = useAgent()
	const { editor } = agent
	const [inputValue, setInputValue] = useState('')
	const isGenerating = useValue('isGenerating', () => agent.requests.isGenerating(), [agent])

	const isContextToolActive = useValue(
		'isContextToolActive',
		() => {
			const tool = editor.getCurrentTool()
			return tool.id === 'target-shape' || tool.id === 'target-area'
		},
		[editor]
	)

	const selectedShapes = useValue('selectedShapes', () => editor.getSelectedShapes(), [editor])
	// WP22 B5: the canvas agent draws shapes/arrows; a selection with cards (node workflow
	// shapes) is better served by Build with AI, which can wire/arrange/configure them.
	const selectionHasCards = selectedShapes.some((s) => s.type === 'node')
	const contextItems = useValue('contextItems', () => agent.context.getItems(), [agent])
	const modelName = useValue('modelName', () => agent.modelName.getModelName(), [agent])
	const modelLabel = useValue('model label', () => getModelLabel(modelName || null, 'agent'), [modelName])

	return (
		<div className="chat-input">
			<form
				onSubmit={(e) => {
					e.preventDefault()
					setInputValue('')
					handleSubmit(e)
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
					{selectedShapes.length > 0 && <SelectionTag onClick={() => editor.selectNone()} />}
					{contextItems.map((item, i) => (
						<ContextItemTag
							editor={editor}
							onClick={() => agent.context.remove(item)}
							key={'context-item-' + i}
							item={item}
						/>
					))}
				</div>

				{selectionHasCards && inputValue.trim() !== '' && (
					<div className="chat-cards-hint">
						<span>Your selection has cards — wiring and parameters need Build with AI.</span>
						<UiButton
							size="sm"
							label="Build with cards instead"
							onClick={() => {
								const text = inputValue
								setInputValue('')
								openBuildPanel(text)
							}}
						/>
					</div>
				)}

				<textarea
					ref={inputRef}
					name="input"
					autoComplete="off"
					placeholder="Ask, learn, brainstorm, draw"
					value={inputValue}
					onInput={(e) => setInputValue(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault()
							//idk about this but it works oops -max
							const form = e.currentTarget.closest('form')
							if (form) {
								const submitEvent = new Event('submit', { bubbles: true, cancelable: true })
								form.dispatchEvent(submitEvent)
							}
						}
					}}
				/>
				<span className="chat-actions">
					<div className="chat-actions-left">
						<div className="chat-model-select">
							<div className="chat-model-select-label">
								<BrainIcon /> {modelLabel}
							</div>
							<ModelSelect
								capability="agent"
								value={modelName}
								onChange={(key) => agent.modelName.setModelName(key)}
							/>
							<ChevronDownIcon />
						</div>
					</div>
					<button className="chat-input-submit" disabled={inputValue === '' && !isGenerating}>
						{isGenerating && inputValue === '' ? '◼' : '⬆'}
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
