import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TLShapeId, useToasts, useValue } from 'tldraw'
import { AgentTaskRequest, getQuickActions, QuickAction, quickAction } from '../../shared/agentRouting'
import { NODE_GROUPS } from '../../shared/nodeGroups'
import { NODE_SPECS } from '../../shared/nodeSpecs'
import { getModelLabel, openProvidersDialog } from '../ai/aiConfig'
import { $agentPanelRequest } from '../agent/agentPanelState'
import { cardErrorMessage, getEditorScope, runAgentRequest } from '../agent/agentTasks'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { loadAllowedTypes, saveAllowedTypes } from '../pipeline/aiBuild'
import { IconChevronDown, IconChevronRight, IconClose, IconMore, IconPlus, IconSparkle, UiChip, UiIconButton } from '../ui'
import { PresetsSheet, RewriteSheet } from './AgentSheets'
import { ChatHistory } from './chat-history/ChatHistory'
import { getAgentHistorySections } from './chat-history/ChatHistorySection'
import { autoGrow, ChatInput } from './ChatInput'
import { TodoList } from './TodoList'

type Sheet = 'rewrite' | 'presets'

/** Focus here means the user is doing something else: do not move it. */
const BUSY_FOCUS = 'input, textarea, select, [contenteditable="true"], [role="menu"], [role="menuitem"], [role="dialog"], .agent-dock'

/** A popover portalled to <body>, anchored under a header button (the dock clips overflow). */
function useAnchoredPopover() {
	const [open, setOpen] = useState(false)
	const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)
	const buttonRef = useRef<HTMLButtonElement>(null)
	const toggle = () => {
		if (!open && buttonRef.current) {
			const rect = buttonRef.current.getBoundingClientRect()
			setAnchor({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
		}
		setOpen((v) => !v)
	}
	return { open, setOpen, anchor, buttonRef, toggle }
}

/**
 * WP44: the dock's header — title, model chip, a menu (Build options, Rewrite presets),
 * history, new chat, close.
 */
export function ChatPanelHeader({ onClose, onOpenSheet }: { onClose: () => void; onOpenSheet: (sheet: Sheet) => void }) {
	const agent = useAgent()
	const modelName = useValue('modelName', () => agent.modelName.getModelName(), [agent])
	const modelLabel = useValue('model label', () => getModelLabel(modelName || null, 'agent'), [modelName])
	const history = useAnchoredPopover()
	const menu = useAnchoredPopover()
	const [buildOptions, setBuildOptions] = useState(false)
	const historyItems = useValue('chatHistory for history menu', () => agent.chat.getHistory(), [agent])
	const prompts = getAgentHistorySections(historyItems)
		.map((section, i) => ({ i, text: section.prompt.userFacingMessage ?? section.prompt.agentFacingMessage }))
		.filter((p) => p.text.trim() !== '')

	const jumpTo = (i: number) => {
		history.setOpen(false)
		document.getElementById('chat-section-' + i)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
	}

	return (
		<div className="agent-dock-header">
			<strong className="agent-dock-title">
				<IconSparkle size={16} /> Agent
			</strong>
			<button className="chat-model-chip" type="button" title="Set up AI providers and models" onClick={openProvidersDialog}>
				{modelLabel}
			</button>
			<div className="agent-dock-header-actions">
				<UiIconButton
					ref={menu.buttonRef}
					icon={<IconMore />}
					title="Agent options"
					active={menu.open}
					onClick={() => {
						setBuildOptions(false)
						menu.toggle()
					}}
				/>
				{menu.open &&
					menu.anchor &&
					createPortal(
						<>
							<div className="chat-history-menu-backdrop" onClick={() => menu.setOpen(false)} />
							<div
								className="chat-history-menu-popover agent-dock-menu"
								style={{ position: 'fixed', top: menu.anchor.top, right: menu.anchor.right }}
							>
								{buildOptions ? (
									<BuildOptions />
								) : (
									<>
										<button type="button" onClick={() => setBuildOptions(true)}>
											Build options…
										</button>
										<button
											type="button"
											onClick={() => {
												menu.setOpen(false)
												onOpenSheet('presets')
											}}
										>
											Rewrite presets…
										</button>
									</>
								)}
							</div>
						</>,
						document.body
					)}
				<UiIconButton ref={history.buttonRef} icon={<HistoryIcon />} title="Jump to an earlier message" active={history.open} onClick={history.toggle} />
				{history.open &&
					history.anchor &&
					createPortal(
						<>
							<div className="chat-history-menu-backdrop" onClick={() => history.setOpen(false)} />
							<div
								className="chat-history-menu-popover"
								style={{ position: 'fixed', top: history.anchor.top, right: history.anchor.right }}
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
				<UiIconButton icon={<IconPlus />} title="New chat" onClick={() => agent.reset()} />
				<UiIconButton icon={<IconClose />} title="Close" onClick={onClose} />
			</div>
		</div>
	)
}

function typesByGroup() {
	const byGroup = new Map<string, string[]>()
	for (const [type, spec] of Object.entries(NODE_SPECS)) {
		if (spec.hidden) continue
		if (!byGroup.has(spec.group)) byGroup.set(spec.group, [])
		byGroup.get(spec.group)!.push(type)
	}
	return byGroup
}

/** "Node types the AI may use" for build tasks (was in the Build with AI panel). */
function BuildOptions() {
	const grouped = useMemo(typesByGroup, [])
	const [allowedTypes, setAllowedTypes] = useState<Set<string>>(() => new Set(loadAllowedTypes()))
	const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
	const commit = (next: Set<string>) => {
		setAllowedTypes(next)
		saveAllowedTypes([...next])
	}
	const toggleGroup = (groupId: string) => {
		const types = grouped.get(groupId) ?? []
		const allOn = types.every((t) => allowedTypes.has(t))
		const next = new Set(allowedTypes)
		for (const t of types) (allOn ? next.delete(t) : next.add(t))
		commit(next)
	}
	const toggleType = (type: string) => {
		const next = new Set(allowedTypes)
		if (next.has(type)) next.delete(type)
		else next.add(type)
		commit(next)
	}
	return (
		<div className="agent-build-options">
			<div className="agent-build-options-title">Node types the AI may use ({allowedTypes.size})</div>
			{NODE_GROUPS.map((group) => {
				const types = grouped.get(group.id) ?? []
				if (!types.length) return null
				const onCount = types.filter((t) => allowedTypes.has(t)).length
				const expanded = expandedGroup === group.id
				return (
					<div key={group.id} className="agent-build-options-group">
						<UiChip label={`${group.label} (${onCount}/${types.length})`} active={onCount === types.length} onClick={() => toggleGroup(group.id)} />
						<UiIconButton
							icon={expanded ? <IconChevronDown /> : <IconChevronRight />}
							title={expanded ? 'Hide types' : 'Show types'}
							onClick={() => setExpandedGroup(expanded ? null : group.id)}
						/>
						{expanded && (
							<div className="agent-build-options-types">
								{types.map((type) => (
									<UiChip key={type} label={NODE_SPECS[type].title} active={allowedTypes.has(type)} onClick={() => toggleType(type)} />
								))}
							</div>
						)}
					</div>
				)
			})}
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

/**
 * WP44: the docked agent panel's body — scope bar, quick actions, the thread, an optional
 * sheet (Rewrite / Rewrite presets) and the input. Every AI feature runs here.
 */
export function ChatPanel({ sheet, setSheet }: { sheet: Sheet | null; setSheet: (sheet: Sheet | null) => void }) {
	const agent = useAgent()
	const { editor } = agent
	const toasts = useToasts()
	const inputRef = useRef<HTMLTextAreaElement>(null)
	const [input, setInput] = useState('')
	const [pending, setPending] = useState<QuickAction | null>(null)

	const scope = useValue('agent scope', () => getEditorScope(editor), [editor])
	// A string, so the chips only change when the card's chips or error really change.
	const cardKey = useValue(
		'agent scope card',
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

	// The pending action belongs to the scope it was picked for.
	useEffect(() => setPending(null), [scope.kind])

	const run = useCallback(
		(request: AgentTaskRequest) => runAgentRequest(agent, getEditorScope(editor), request),
		[agent, editor]
	)

	const pickAction = useCallback(
		(action: QuickAction) => {
			if (action.needs === 'sheet') {
				setSheet('rewrite')
				return
			}
			if (action.needs === 'input') {
				setInput(action.prefill ?? '')
				// A card chip like "Find and replace…" is just a start for free text (routed to the card).
				setPending(action.id === 'card-chip' ? null : action)
				focusInput(action.id !== 'card-chip')
				return
			}
			const text = action.id === 'fix-error' ? card?.error : action.text
			run({ action: action.id, text })
		},
		[card, focusInput, run, setSheet]
	)

	const send = (text: string) => {
		if (text.trim() === '') {
			// An empty send stops the drawing agent, as before.
			agent.cancel()
			return
		}
		if (pending) {
			const action = pending
			setPending(null)
			run({ action: action.id, text })
			return
		}
		run({ text })
	}

	// Requests from menus, shortcuts and cards (openAgentPanel).
	const request = useValue('agent panel request', () => $agentPanelRequest.get(), [])
	// Each request runs once, even when React runs this effect twice (StrictMode).
	const handledNonce = useRef(0)
	useEffect(() => {
		if (!request || request.nonce === handledNonce.current) return
		handledNonce.current = request.nonce
		$agentPanelRequest.set(null)
		if (request.sheet) setSheet(request.sheet)
		if (request.run) {
			const result = runAgentRequest(agent, getEditorScope(editor), request.run)
			if (result.status === 'needs-input' && 'action' in request.run) {
				const action = quickAction(request.run.action)
				if (action.needs === 'sheet') setSheet('rewrite')
				else pickAction(action)
			}
		}
		if (request.prefill != null) {
			setInput(request.prefill)
			focusInput()
		} else if (request.focus) {
			focusInput()
		}
	}, [request, agent, editor, pickAction, focusInput, setSheet])

	const isDark = useValue('dark mode', () => editor.user.getIsDarkMode(), [editor])

	return (
		<div className={`chat-panel ${isDark ? 'tl-theme__dark' : 'tl-theme__light'}`}>
			<div className="agent-scope-bar">
				<span className={`agent-scope-chip agent-scope-${scope.kind}`} title="What the next task will use">
					<span className="agent-scope-label">{scope.label}</span>
					{scope.kind !== 'canvas' && (
						<button type="button" className="agent-scope-clear" title="Clear the selection" onClick={() => editor.selectNone()}>
							<IconClose size={12} />
						</button>
					)}
				</span>
			</div>
			<QuickActions actions={actions} onPick={pickAction} />
			<ChatHistory agent={agent} />
			<div className="chat-input-container">
				<TodoList agent={agent} />
				{sheet === 'rewrite' && (
					<RewriteSheet
						scopeLabel={scope.kind === 'canvas' ? 'Text' : scope.label}
						onClose={() => setSheet(null)}
						onEditPresets={() => setSheet('presets')}
						onRun={(instructions, label) => {
							setSheet(null)
							run({ action: 'rewrite', text: instructions, label })
						}}
					/>
				)}
				{sheet === 'presets' && (
					<PresetsSheet
						onClose={() => setSheet(null)}
						onSaved={(message) => toasts.addToast({ title: message, severity: 'success' })}
					/>
				)}
				<ChatInput
					inputRef={inputRef}
					value={input}
					onChange={setInput}
					onSend={send}
					pending={pending}
					onClearPending={() => {
						setPending(null)
						setInput('')
					}}
				/>
			</div>
		</div>
	)
}

/** Quick action chips: at most two lines, then "More" shows the rest. */
function QuickActions({ actions, onPick }: { actions: QuickAction[]; onPick: (action: QuickAction) => void }) {
	const ref = useRef<HTMLDivElement>(null)
	const [expanded, setExpanded] = useState(false)
	const [overflows, setOverflows] = useState(false)
	useEffect(() => setExpanded(false), [actions])
	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		let frame = 0
		const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1)
		measure()
		// Measure on the next frame, so showing "More" never re-enters this observer in one frame.
		const observer = new ResizeObserver(() => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(measure)
		})
		observer.observe(el)
		return () => {
			cancelAnimationFrame(frame)
			observer.disconnect()
		}
	}, [actions, expanded])
	return (
		<div className="agent-quick-actions">
			<div ref={ref} className={'agent-quick-actions-list' + (expanded ? ' is-expanded' : '')}>
				{actions.map((action, i) => (
					<button
						key={action.id + i}
						type="button"
						className={'agent-quick-action' + (action.id === 'fix-error' ? ' is-danger' : '')}
						data-action={action.id}
						onClick={() => onPick(action)}
					>
						{action.label}
					</button>
				))}
			</div>
			{(overflows || expanded) && (
				<button type="button" className="agent-quick-action agent-quick-more" onClick={() => setExpanded((v) => !v)}>
					{expanded ? 'Less' : 'More'}
				</button>
			)}
		</div>
	)
}
