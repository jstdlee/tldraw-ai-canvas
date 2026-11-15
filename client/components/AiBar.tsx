import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { atom, TLShapeId, useValue } from 'tldraw'
import { AgentTaskRequest, getQuickActions, QuickAction, quickAction } from '../../shared/agentRouting'
import { PreviewMarks, previewMarks, previewMarksCss } from '../../shared/aiPreview'
import { SmallSpinner } from '../../shared/icons/SmallSpinner'
import { NODE_SPECS } from '../../shared/nodeSpecs'
import { openAgentPanel } from '../agent/agentPanelState'
import {
	answerQuestion,
	cardErrorMessage,
	getEditorScope,
	getOpenPreviews,
	getOpenQuestion,
	installPreviewWatcher,
	isAgentBusy,
} from '../agent/agentTasks'
import { $aiBarRequest } from '../agent/aiBarState'
import { TldrawAgentApp } from '../agent/TldrawAgentApp'
import { TldrawAgentAppContextProvider, useAgent } from '../agent/TldrawAgentAppProvider'
import { IconClose, IconPlay, IconSparkle, UiIconButton } from '../ui'
import { ApplyFirstPrompt } from './ChatPanel'
import { autoGrow } from './ChatInput'
import { SendResult, useAgentSend } from './useAgentSend'

const BAR_WIDTH = 420
const GAP = 12
const EDGE = 8
const MAX_CHIPS = 4
const BUSY_FOCUS = 'input, textarea, select, [contenteditable="true"], [role="menu"], [role="menuitem"], .agent-dock'

/** States in which the bar stays out of the way (a drag, a resize, text editing…). */
const BUSY_STATES = [
	'select.translating',
	'select.resizing',
	'select.rotating',
	'select.dragging_handle',
	'select.brushing',
	'select.scribble_brushing',
	'select.cropping',
	'select.pointing_handle',
]

/** The agent app, set by App (the canvas layer is a stable component without props). */
export const $aiBarApp = atom<TldrawAgentApp | null>('ai bar app', null)

/**
 * WP48: mounted in InFrontOfTheCanvas. The AI bar, the preview marks on the canvas, and the
 * watcher that turns an edit of a previewed shape into Apply.
 */
export function AiBarHost() {
	const app = useValue('ai bar app', () => $aiBarApp.get(), [])
	if (!app) return null
	return (
		<TldrawAgentAppContextProvider app={app}>
			<AiPreviewMarks />
			<AiBar />
		</TldrawAgentAppContextProvider>
	)
}

/** The open previews' marks: new shapes semi-transparent and dashed, changed fields highlighted. */
function AiPreviewMarks() {
	const agent = useAgent()
	useEffect(() => installPreviewWatcher(agent), [agent])
	const css = useValue(
		'ai preview css',
		() => {
			const tasks = getOpenPreviews(agent)
			if (!tasks.length) return ''
			const all: PreviewMarks = { added: [], changed: [], fields: {} }
			for (const task of tasks) {
				const marks = previewMarks(task.previewDiff as Parameters<typeof previewMarks>[0])
				all.added.push(...marks.added)
				all.changed.push(...marks.changed.filter((id) => !marks.added.includes(id)))
				for (const [id, keys] of Object.entries(marks.fields)) all.fields[id] = [...(all.fields[id] ?? []), ...keys]
			}
			return previewMarksCss(all)
		},
		[agent]
	)
	return css ? <style data-ai-preview="">{css}</style> : null
}

/** Quick actions for the current scope (the same chips as the dock). */
function useScopeActions() {
	const agent = useAgent()
	const { editor } = agent
	const scope = useValue('ai bar scope', () => getEditorScope(editor), [editor])
	const cardKey = useValue(
		'ai bar scope card',
		() => {
			if (scope.kind !== 'card') return ''
			const shape = editor.getShape(scope.ids[0] as TLShapeId)
			const type = (shape?.props as { node?: { type?: string } } | undefined)?.node?.type ?? ''
			return JSON.stringify({ chips: NODE_SPECS[type]?.assistant.chips ?? [], error: cardErrorMessage(editor, scope.ids[0] as TLShapeId) })
		},
		[editor, scope]
	)
	const card = useMemo(() => (cardKey ? (JSON.parse(cardKey) as { chips: string[]; error: string }) : undefined), [cardKey])
	const actions = useMemo(
		() => getQuickActions({ kind: scope.kind }, card ? { chips: card.chips, hasError: !!card.error } : undefined),
		[scope.kind, card]
	)
	return { scope, card, actions }
}

/**
 * WP48: the one AI entry. A small "Ask AI" input just above the selection (below it when there
 * is no room), following pan and zoom; Ctrl+K opens it anywhere (the canvas center with nothing
 * selected). Enter sends: the dock opens with the task in the thread, the bar shows a progress
 * line and closes when the task reaches a preview, an answer or an error. A question from the
 * agent shows here with its answers as chips.
 */
function AiBar() {
	const agent = useAgent()
	const { editor } = agent
	const { scope, card, actions } = useScopeActions()
	const { send, confirm, resolveConfirm, adjustTask, cancelAdjust } = useAgentSend()
	const inputRef = useRef<HTMLTextAreaElement>(null)
	const barRef = useRef<HTMLDivElement>(null)
	const [input, setInput] = useState('')
	const [pending, setPending] = useState<QuickAction | null>(null)
	const [explicit, setExplicit] = useState(false)
	const [dismissed, setDismissed] = useState<string | null>(null)
	const [working, setWorking] = useState<{ seenBusy: boolean; since: number } | null>(null)
	const [askedId, setAskedId] = useState<string | null>(null)
	const [showMore, setShowMore] = useState(false)
	const [height, setHeight] = useState(48)

	const selectionKey = useValue('ai bar selection', () => editor.getSelectedShapeIds().join(','), [editor])
	const blocked = useValue(
		'ai bar blocked',
		() => editor.getIsReadonly() || editor.getEditingShapeId() != null || editor.isInAny(...BUSY_STATES),
		[editor]
	)
	const inSelect = useValue('ai bar select tool', () => editor.isIn('select'), [editor])
	const busy = useValue('ai bar busy', () => isAgentBusy(agent), [agent])
	const question = useValue(
		'ai bar question',
		() => {
			const q = getOpenQuestion(agent)
			return q ? { id: q.id, text: q.text ?? '', options: q.options ?? [] } : null
		},
		[agent]
	)

	// A new selection gets its own bar, even after Escape on the last one.
	useEffect(() => {
		setShowMore(false)
		setPending(null)
	}, [selectionKey])

	const close = useCallback(() => {
		setExplicit(false)
		setDismissed(editor.getSelectedShapeIds().join(','))
		setPending(null)
		setAskedId(null)
		inputRef.current?.blur()
	}, [editor])

	const focusInput = useCallback((selectAll = false) => {
		const focus = () => {
			const el = inputRef.current
			if (!el || document.activeElement === el) return
			el.focus()
			autoGrow(el)
			if (selectAll) el.select()
			else el.setSelectionRange(el.value.length, el.value.length)
		}
		requestAnimationFrame(focus)
		// A closing context menu hands focus back to the canvas a moment later: take it once
		// more, but never from a field, menu or dialog the user has moved on to.
		setTimeout(() => {
			const active = document.activeElement
			if (active && active !== document.body && active.closest(BUSY_FOCUS)) return
			focus()
		}, 150)
	}, [])

	const afterSend = useCallback(
		(result: SendResult | null) => {
			if (!result || result.status !== 'started') return
			setInput('')
			setPending(null)
			setAskedId(null)
			setShowMore(false)
			if (inputRef.current) inputRef.current.style.height = 'auto'
			setWorking({ seenBusy: false, since: Date.now() })
			// The thread is the history: open the dock (if closed) so the task shows.
			openAgentPanel({})
		},
		[]
	)

	const pickAction = useCallback(
		(action: QuickAction) => {
			setShowMore(false)
			if (action.needs === 'sheet') {
				openAgentPanel({ sheet: 'rewrite' })
				return
			}
			if (action.needs === 'input') {
				setExplicit(true)
				setInput(action.prefill ?? '')
				// A card chip like "Find and replace…" is just a start for free text.
				setPending(action.id === 'card-chip' ? null : action)
				focusInput(action.id !== 'card-chip')
				return
			}
			const text = action.id === 'fix-error' ? card?.error : action.text
			afterSend(send({ action: action.id, text }))
		},
		[afterSend, card, focusInput, send]
	)

	const submit = useCallback(
		(request: AgentTaskRequest) => {
			const result = send(request)
			if (result.status === 'needs-input' && 'action' in request) {
				pickAction(quickAction(request.action))
				return
			}
			afterSend(result)
		},
		[afterSend, pickAction, send]
	)

	const sendInput = () => {
		const text = input.trim()
		if (!text) return
		if (pending) submit({ action: pending.id, text })
		else submit({ text })
	}

	// Requests from Ctrl+K, menus and the Fix button on a card error.
	const request = useValue('ai bar request', () => $aiBarRequest.get(), [])
	const handledNonce = useRef(0)
	useEffect(() => {
		if (!request || request.nonce === handledNonce.current) return
		handledNonce.current = request.nonce
		$aiBarRequest.set(null)
		setExplicit(true)
		setDismissed(null)
		if (request.run) {
			submit(request.run)
		} else if (request.prefill != null) {
			setInput(request.prefill)
			setPending(null)
			focusInput()
		} else {
			focusInput()
		}
	}, [request, submit, focusInput])

	// The progress line ends when the work does: keep the bar for a question, else close it.
	useEffect(() => {
		if (!working) return
		if (busy) {
			if (!working.seenBusy) setWorking({ ...working, seenBusy: true })
			return
		}
		if (!working.seenBusy && Date.now() - working.since < 600) {
			const timer = setTimeout(() => setWorking((w) => (w ? { ...w } : w)), 650)
			return () => clearTimeout(timer)
		}
		setWorking(null)
		if (question) {
			setAskedId(question.id)
			setExplicit(true)
		} else {
			close()
		}
	}, [busy, working, question, close])

	// Clicking the canvas or opening a context menu closes the bar.
	useEffect(() => {
		const onEvent = (info: { type: string; name: string }) => {
			if (info.type === 'pointer' && info.name === 'pointer_down') {
				setExplicit(false)
				setAskedId(null)
				setPending(null)
			}
		}
		editor.on('event', onEvent as never)
		const container = editor.getContainer()
		const onContextMenu = () => close()
		container.addEventListener('contextmenu', onContextMenu)
		return () => {
			editor.off('event', onEvent as never)
			container.removeEventListener('contextmenu', onContextMenu)
		}
	}, [editor, close])

	// Where: above the selection bounds in viewport space, flipped below when there is no room.
	const anchor = useValue(
		'ai bar anchor',
		() => {
			const viewport = editor.getViewportScreenBounds()
			const bounds = editor.getSelectedShapeIds().length ? editor.getSelectionPageBounds() : null
			if (!bounds) return { kind: 'center' as const, vw: viewport.w, vh: viewport.h }
			const tl = editor.pageToViewport({ x: bounds.minX, y: bounds.minY })
			const br = editor.pageToViewport({ x: bounds.maxX, y: bounds.maxY })
			return { kind: 'selection' as const, vw: viewport.w, vh: viewport.h, left: tl.x, top: tl.y, right: br.x, bottom: br.y }
		},
		[editor]
	)

	const showQuestion = !!question && question.id === askedId
	const visible =
		!blocked &&
		(explicit || !!working || showQuestion || (!!selectionKey && dismissed !== selectionKey && inSelect))

	useLayoutEffect(() => {
		const el = barRef.current
		if (!el) return
		const measure = () => setHeight(el.offsetHeight)
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(el)
		return () => observer.disconnect()
	}, [visible])

	if (!visible) return null

	const width = Math.max(200, Math.min(BAR_WIDTH, anchor.vw - EDGE * 2))
	let left: number
	let top: number
	let placement: 'above' | 'below' | 'center'
	if (anchor.kind === 'center') {
		left = anchor.vw / 2 - width / 2
		top = Math.max(EDGE, anchor.vh * 0.38 - height / 2)
		placement = 'center'
	} else {
		left = (anchor.left + anchor.right) / 2 - width / 2
		const above = anchor.top - GAP - height
		const below = anchor.bottom + GAP
		if (above >= EDGE) {
			top = above
			placement = 'above'
		} else if (below + height <= anchor.vh - EDGE) {
			top = below
			placement = 'below'
		} else {
			// The selection fills the view: keep to the top edge.
			top = EDGE
			placement = 'above'
		}
	}
	left = Math.min(Math.max(EDGE, left), Math.max(EDGE, anchor.vw - width - EDGE))

	const chips = showMore ? actions : actions.slice(0, MAX_CHIPS)
	const isDark = editor.user.getIsDarkMode()

	return (
		<div
			ref={barRef}
			className={`ai-bar ${isDark ? 'tl-theme__dark' : 'tl-theme__light'}`}
			data-placement={placement}
			role="dialog"
			aria-label="Ask AI"
			style={{ left, top, width }}
			onPointerDown={(e) => e.stopPropagation()}
			onKeyDown={(e) => e.stopPropagation()}
			onKeyUp={(e) => e.stopPropagation()}
			onWheel={(e) => e.stopPropagation()}
		>
			<div className="ai-bar-row">
				<span className={`ai-bar-scope agent-scope-${scope.kind}`} title="What the AI will work on">
					{scope.label}
				</span>
				{pending && (
					<button
						type="button"
						className="agent-pending-tag"
						title="Cancel this action"
						onClick={() => {
							setPending(null)
							setInput('')
						}}
					>
						{pending.label}
						<IconClose size={12} />
					</button>
				)}
				{adjustTask && !pending && (
					<button type="button" className="agent-pending-tag" title="Stop adjusting" onClick={cancelAdjust}>
						Adjust
						<IconClose size={12} />
					</button>
				)}
				<textarea
					ref={inputRef}
					className="ai-bar-input"
					name="ai-bar-input"
					rows={1}
					autoComplete="off"
					placeholder={pending?.placeholder ?? (showQuestion ? 'Or type your answer' : 'Ask AI…')}
					value={input}
					onFocus={() => setExplicit(true)}
					onChange={(e) => {
						setInput(e.currentTarget.value)
						autoGrow(e.currentTarget)
					}}
					onKeyDown={(e) => {
						if (e.key === 'Escape') {
							e.preventDefault()
							if (pending) {
								setPending(null)
								setInput('')
								return
							}
							close()
							editor.focus()
							return
						}
						if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
							e.preventDefault()
							sendInput()
						}
					}}
				/>
				<UiIconButton icon={<IconPlay size={14} />} title="Send (Enter)" disabled={!input.trim()} onClick={sendInput} />
			</div>
			{confirm && <ApplyFirstPrompt onChoose={(choice) => afterSend(resolveConfirm(choice))} />}
			{working ? (
				<div className="ai-bar-progress" role="status">
					<SmallSpinner />
					<span>Working… the result shows in the Agent panel.</span>
				</div>
			) : showQuestion && question ? (
				<div className="ai-bar-question">
					<div className="ai-bar-question-text">
						<IconSparkle size={14} />
						<span>{question.text}</span>
					</div>
					{question.options.length > 0 && (
						<div className="ai-bar-chips">
							{question.options.map((option) => (
								<button
									key={option}
									type="button"
									className="agent-quick-action"
									onClick={() => {
										answerQuestion(agent, question.id, option)
										setAskedId(null)
										setWorking({ seenBusy: false, since: Date.now() })
									}}
								>
									{option}
								</button>
							))}
						</div>
					)}
				</div>
			) : (
				chips.length > 0 && (
					<div className="ai-bar-chips">
						{chips.map((action, i) => (
							<button
								key={action.id + i}
								type="button"
								className={'agent-quick-action' + (action.id === 'fix-error' ? ' is-danger' : '')}
								data-action={action.id}
								onClick={() => pickAction(action)}
							>
								{action.label}
							</button>
						))}
						{actions.length > MAX_CHIPS && (
							<button type="button" className="agent-quick-action agent-quick-more" onClick={() => setShowMore((v) => !v)}>
								{showMore ? 'Less' : 'More…'}
							</button>
						)}
					</div>
				)
			)}
		</div>
	)
}
