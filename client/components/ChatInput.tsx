import { FormEventHandler, useState } from 'react'
import { Editor, useValue } from 'tldraw'
import { AtIcon } from '../../shared/icons/AtIcon'
import { BrainIcon } from '../../shared/icons/BrainIcon'
import { ChevronDownIcon } from '../../shared/icons/ChevronDownIcon'
import { getModelLabel, ModelSelect } from '../ai/aiConfig'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { buildWithAI, gatherBuildScope } from '../pipeline/aiBuild'
import { ChatPlanEntry } from './chatPlan'
import { ContextItemTag } from './ContextItemTag'
import { SelectionTag } from './SelectionTag'

/** For this one message, build with the selection, or draw — see the mode chip below. */
type ChatMode = 'drawing' | 'building'

function newPlanEntryId(): string {
	return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `plan-${Date.now()}-${Math.random()}`
}

export function ChatInput({
	handleSubmit,
	inputRef,
	onPlan,
}: {
	handleSubmit: FormEventHandler<HTMLFormElement>
	inputRef: React.RefObject<HTMLTextAreaElement | null>
	/** WP23 Part F: called with the finished plan when the message is sent in "building" mode. */
	onPlan: (entry: ChatPlanEntry) => void
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
	const cardCount = selectedShapes.filter((s) => s.type === 'node').length
	// WP23 Part F: cards selected means "wire them up and fill parameters" (Build with AI),
	// not "draw this" — unless the chip is clicked to force the other mode for this message.
	const [forcedMode, setForcedMode] = useState<ChatMode | null>(null)
	const autoMode: ChatMode = cardCount > 0 ? 'building' : 'drawing'
	const mode = forcedMode ?? autoMode
	const [buildBusy, setBuildBusy] = useState(false)
	const contextItems = useValue('contextItems', () => agent.context.getItems(), [agent])
	const modelName = useValue('modelName', () => agent.modelName.getModelName(), [agent])
	const modelLabel = useValue('model label', () => getModelLabel(modelName || null, 'agent'), [modelName])

	const runBuild = async (goal: string) => {
		const scope = gatherBuildScope(editor)
		const selectedIds = scope.nodeShapes.map((s) => s.id)
		setBuildBusy(true)
		try {
			const result = await buildWithAI(editor, goal)
			onPlan({ id: newPlanEntryId(), goal, plan: result.plan, warnings: result.warnings, selectedIds })
		} catch (cause) {
			onPlan({
				id: newPlanEntryId(),
				goal,
				plan: { summary: `Could not build a plan: ${(cause as Error).message}`, add: [], update: [], wires: [], unwire: [], notes: [], arrange: 'none' },
				warnings: [],
				selectedIds,
			})
		} finally {
			setBuildBusy(false)
		}
	}

	return (
		<div className="chat-input">
			<form
				onSubmit={(e) => {
					e.preventDefault()
					const text = inputValue
					setInputValue('')
					// An empty submit just cancels any running request (handleSubmit's own job) —
					// nothing to build or draw, so the chat's mode does not apply.
					if (text.trim() === '') {
						handleSubmit(e)
						return
					}
					const sendMode = mode
					setForcedMode(null)
					if (sendMode === 'building') {
						void runBuild(text)
						return
					}
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

				<div className={'chat-mode-chip' + (mode === 'building' ? ' is-building' : '')}>
					<span>{mode === 'building' ? `Building with ${cardCount} card${cardCount === 1 ? '' : 's'}` : 'Drawing'}</span>
					<button
						type="button"
						title={mode === 'building' ? 'Switch to drawing for this message' : 'Switch to building for this message'}
						onClick={() => setForcedMode(mode === 'building' ? 'drawing' : 'building')}
					>
						{mode === 'building' ? 'Draw instead' : 'Build instead'}
					</button>
				</div>

				<textarea
					ref={inputRef}
					name="input"
					autoComplete="off"
					placeholder={mode === 'building' ? 'What should these cards do? (Enter to build)' : 'Ask, learn, brainstorm, draw'}
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
					<button
						className="chat-input-submit"
						disabled={(inputValue === '' && !isGenerating) || buildBusy}
					>
						{buildBusy ? '…' : isGenerating && inputValue === '' ? '◼' : '⬆'}
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
