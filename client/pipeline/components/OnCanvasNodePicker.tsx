import { Dialog, VisuallyHidden } from 'radix-ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	TLShapeId,
	useEditor,
	usePassThroughWheelEvents,
	useQuickReactor,
	useValue,
	Vec,
	VecModel,
} from 'tldraw'
import { getConnectionBindings } from '../connection/ConnectionBindingUtil'
import { getConnectionTerminals } from '../connection/ConnectionShapeUtil'
import { PORT_TYPE_COLORS, PortDataType } from '../constants'
import { getNodeDefinitions, NodeType } from '../nodes/nodeTypes'
import { getNodeOutputPortInfo, getPortDataType } from '../nodes/nodePorts'
import { arePortDataTypesCompatible } from '../ports/portCompatibility'
import { isMultiInfoValue, NodeDefinition, STOP_EXECUTION } from '../nodes/types/shared'
import { NODE_DESCRIPTIONS } from '../../../shared/nodeDescriptions'
import {
	PickerCandidate,
	rankCandidates,
	readPickerRecency,
	RankedCandidate,
	recordPick,
} from '../../../shared/pickerRank'
import { IconCheck, IconJevMark, IconSearch, UiCheckbox, UiTextInput } from '../../ui'
import { EditorAtom } from '../utils'

export interface OnCanvasNodePickerState {
	connectionShapeId: TLShapeId
	location: 'start' | 'end' | 'middle'
	onPick: (nodeType: NodeType, position: VecModel) => void
	onClose: () => void
}

export const onCanvasNodePickerState = new EditorAtom<OnCanvasNodePickerState | null>(
	'on canvas node picker',
	() => null
)

const SMART_RANKING_KEY = 'oh-my-tldraw:picker-smart-ranking'
const JEV_DEBOUNCE_MS = 350
const JEV_TIMEOUT_MS = 2500
const JEV_MIN_QUERY_LENGTH = 3
const JEV_MIN_CANDIDATES = 3
const JEV_TOP_N = 8

function readSmartRanking(): boolean {
	try {
		return localStorage.getItem(SMART_RANKING_KEY) !== 'off'
	} catch {
		return true
	}
}

function writeSmartRanking(on: boolean) {
	try {
		localStorage.setItem(SMART_RANKING_KEY, on ? 'on' : 'off')
	} catch {
		// Private mode, or no localStorage: the choice just isn't remembered.
	}
}

export function OnCanvasNodePicker() {
	const editor = useEditor()
	const onClose = useCallback(() => {
		const state = onCanvasNodePickerState.get(editor)
		if (!state) return
		onCanvasNodePickerState.set(editor, null)
		state.onClose()
	}, [editor])

	return <OnCanvasNodePickerDialog onClose={onClose} />
}

/** The source output port feeding the dropped wire: its data type, and a short text preview. */
function useSourcePort(connectionShapeId: TLShapeId | undefined) {
	const editor = useEditor()
	return useValue(
		'picker source port',
		() => {
			if (!connectionShapeId) return null
			const connection = editor.getShape(connectionShapeId)
			if (!connection || !editor.isShapeOfType(connection, 'connection')) return null
			const bindings = getConnectionBindings(editor, connection)
			if (!bindings.start) return { dataType: 'any' as PortDataType, title: '', preview: '' }
			const dataType = getPortDataType(editor, bindings.start.toId, bindings.start.props.portId) ?? 'any'
			const sourceShape = editor.getShape(bindings.start.toId)
			let title = ''
			let preview = ''
			if (sourceShape && editor.isShapeOfType(sourceShape, 'node')) {
				const label = (sourceShape.props as { label?: string }).label
				title =
					(typeof label === 'string' && label.trim()) ||
					getNodeDefinitions(editor)[sourceShape.props.node.type]?.title ||
					sourceShape.props.node.type
				const info = getNodeOutputPortInfo(editor, sourceShape.id)[bindings.start.props.portId]
				const value = info ? (isMultiInfoValue(info) ? info.value[0] : info.value) : null
				if (value != null && value !== STOP_EXECUTION) preview = String(value).slice(0, 300)
			}
			return { dataType, title, preview }
		},
		[editor, connectionShapeId]
	)
}

function OnCanvasNodePickerDialog({ onClose }: { onClose: () => void }) {
	const editor = useEditor()
	const state = useValue('picker state', () => onCanvasNodePickerState.get(editor), [editor])
	const location = state?.location
	const shouldRender = !!location
	const [container, setContainer] = useState<HTMLDivElement | null>(null)
	usePassThroughWheelEvents(useMemo(() => ({ current: container }), [container]))

	useQuickReactor(
		'OnCanvasNodePicker',
		() => {
			const current = onCanvasNodePickerState.get(editor)
			if (!current) return
			if (!container) return

			const connection = editor.getShape(current.connectionShapeId)
			if (!connection || !editor.isShapeOfType(connection, 'connection')) {
				onClose()
				return
			}

			const terminals = getConnectionTerminals(editor, connection)
			const terminalInConnectionSpace =
				current.location === 'middle'
					? Vec.Lrp(terminals.start, terminals.end, 0.5)
					: terminals[current.location]

			const terminalInPageSpace = editor
				.getShapePageTransform(connection)
				.applyToPoint(terminalInConnectionSpace)

			const terminalInViewportSpace = editor.pageToViewport(terminalInPageSpace)
			// Same size at every zoom, and kept inside the viewport so the list is never cut off.
			const viewport = editor.getViewportScreenBounds()
			const margin = 8
			const w = container.offsetWidth || 340
			const h = container.offsetHeight || 420
			const x = Math.max(margin, Math.min(terminalInViewportSpace.x, viewport.w - w - margin))
			const y = Math.max(margin, Math.min(terminalInViewportSpace.y, viewport.h - h - margin))
			container.style.transform = `translate(${x}px, ${y}px)`
		},
		[editor, container]
	)

	return (
		<Dialog.Root
			open={shouldRender}
			modal={false}
			onOpenChange={(isOpen) => {
				if (!isOpen) onClose()
			}}
		>
			<Dialog.Content
				ref={setContainer}
				className={`OnCanvasNodePicker OnCanvasNodePicker_${location ?? 'end'}`}
			>
				<div className="OnCanvasNodePicker-content">
					<VisuallyHidden.Root>
						<Dialog.Title>Insert node</Dialog.Title>
					</VisuallyHidden.Root>
					{state && <NodeSearchPicker state={state} onClose={onClose} />}
				</div>
			</Dialog.Content>
		</Dialog.Root>
	)
}

function candidateFor(def: NodeDefinition<NodeType>): PickerCandidate {
	const described = NODE_DESCRIPTIONS[def.type]
	return {
		type: def.type,
		title: described?.title ?? def.title,
		description: described?.description ?? '',
		keywords: described?.keywords ?? [],
	}
}

function NodeSearchPicker({
	state,
	onClose,
}: {
	state: OnCanvasNodePickerState
	onClose: () => void
}) {
	const editor = useEditor()
	const source = useSourcePort(state.connectionShapeId)
	const sourceDataType = source?.dataType ?? 'any'

	const [query, setQuery] = useState('')
	const [activeIndex, setActiveIndex] = useState(0)
	const [othersOpen, setOthersOpen] = useState(false)
	const [smartRanking, setSmartRanking] = useState(readSmartRanking)
	const [jevOrder, setJevOrder] = useState<{ query: string; types: string[] } | null>(null)
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		inputRef.current?.focus()
	}, [])

	const allDefs = useValue(
		'picker node defs',
		() => Object.values(getNodeDefinitions(editor)).filter((def) => !def.hidden),
		[editor]
	)

	const compatible = useMemo(
		() =>
			(allDefs as NodeDefinition<NodeType>[]).filter((def) => {
				// Check every input port the node type would have once created, at its default values.
				const defaultNode = def.getDefault()
				const ports = def.getPorts({ props: { node: defaultNode } } as never, defaultNode)
				return Object.values(ports).some(
					(port) => port.terminal === 'end' && arePortDataTypesCompatible(port.dataType, sourceDataType)
				)
			}),
		[allDefs, sourceDataType]
	)

	const candidates = useMemo(() => compatible.map(candidateFor), [compatible])
	const recency = useMemo(() => readPickerRecency(), [])

	const recentTypes = useMemo(() => {
		if (query.trim()) return []
		return Object.entries(recency)
			.filter(([type]) => candidates.some((c) => c.type === type))
			.sort((a, b) => b[1].last - a[1].last)
			.slice(0, 5)
			.map(([type]) => type)
	}, [recency, candidates, query])

	const localRanked = useMemo(
		() => rankCandidates(query, candidates, recency),
		[query, candidates, recency]
	)

	// JEV re-rank: debounce 350ms, only for a real query with enough candidates.
	useEffect(() => {
		const q = query.trim()
		if (!smartRanking || q.length < JEV_MIN_QUERY_LENGTH || localRanked.length < JEV_MIN_CANDIDATES) {
			return
		}
		const controller = new AbortController()
		const timeout = window.setTimeout(() => {
			const top = localRanked.slice(0, JEV_TOP_N)
			const timer = window.setTimeout(() => controller.abort(), JEV_TIMEOUT_MS)
			void fetch('/api/jev', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: controller.signal,
				body: JSON.stringify({
					type: 'choice',
					question: `Which node does the user want next? Query: "${q}"`,
					context: source?.title
						? `${source.title} output (${sourceDataType}): ${source.preview}`
						: `A new node (${sourceDataType} output)`,
					options: top.map(
						(entry) => `${entry.candidate.type}: ${entry.candidate.title} — ${entry.candidate.description}`
					),
				}),
			})
				.then((response) => (response.ok ? response.json() : null))
				.then((result: { probabilities?: Record<string, number> } | null) => {
					if (!result?.probabilities) return
					// Stale response (query changed meanwhile): ignore it.
					if (query.trim() !== q) return
					const order = Object.entries(result.probabilities)
						.sort((a, b) => b[1] - a[1])
						.map(([key]) => key.split(':')[0].trim())
						.filter((type) => top.some((entry) => entry.candidate.type === type))
					if (order.length) setJevOrder({ query: q, types: order })
				})
				.catch(() => {
					// Timeout or network error: keep the local order silently.
				})
				.finally(() => window.clearTimeout(timer))
		}, JEV_DEBOUNCE_MS)
		return () => {
			window.clearTimeout(timeout)
			controller.abort()
		}
	}, [query, localRanked, smartRanking, source, sourceDataType])

	const usedJev = smartRanking && jevOrder && jevOrder.query === query.trim()

	const ranked = useMemo((): RankedCandidate[] => {
		if (!usedJev) return localRanked
		// Normalise both orders to 0..1 by rank, then blend: 0.6 local, 0.4 JEV.
		const localNorm = new Map(localRanked.map((entry, i) => [entry.candidate.type, 1 - i / localRanked.length]))
		const jevProb = new Map(jevOrder!.types.map((type, i) => [type, 1 - i / jevOrder!.types.length]))
		const combined = localRanked.map((entry) => ({
			candidate: entry.candidate,
			score: 0.6 * (localNorm.get(entry.candidate.type) ?? 0) + 0.4 * (jevProb.get(entry.candidate.type) ?? 0),
		}))
		combined.sort((a, b) => b.score - a.score)
		return combined
	}, [usedJev, localRanked, jevOrder])

	const recentCandidates = useMemo(
		() => recentTypes.map((type) => candidates.find((c) => c.type === type)!).filter(Boolean),
		[recentTypes, candidates]
	)
	const recentSet = useMemo(() => new Set(recentTypes), [recentTypes])
	const bestShown = query.trim() ? ranked : ranked.filter((entry) => !recentSet.has(entry.candidate.type))
	const BEST_LIMIT = 8
	const best = bestShown.slice(0, BEST_LIMIT)
	const others = bestShown.slice(BEST_LIMIT)

	const flatList = useMemo(
		() => [
			...recentCandidates.map((c) => ({ type: c.type })),
			...best.map((entry) => ({ type: entry.candidate.type })),
			...(othersOpen ? others.map((entry) => ({ type: entry.candidate.type })) : []),
		],
		[recentCandidates, best, others, othersOpen]
	)

	useEffect(() => setActiveIndex(0), [query])

	const pick = useCallback(
		(type: string) => {
			const def = (allDefs as NodeDefinition<NodeType>[]).find((d) => d.type === type)
			if (!def) return

			const connection = editor.getShape(state.connectionShapeId)
			if (!connection || !editor.isShapeOfType(connection, 'connection')) {
				onClose()
				return
			}
			const terminals = getConnectionTerminals(editor, connection)
			const terminalInConnectionSpace =
				state.location === 'middle' ? Vec.Lrp(terminals.start, terminals.end, 0.5) : terminals[state.location]
			const terminalInPageSpace = editor
				.getShapePageTransform(connection)
				.applyToPoint(terminalInConnectionSpace)

			recordPick(type)
			state.onPick(def.getDefault(), terminalInPageSpace)
			onClose()
		},
		[allDefs, editor, onClose, state]
	)

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === 'Escape') {
			event.preventDefault()
			onClose()
			return
		}
		if (event.key === 'ArrowDown') {
			event.preventDefault()
			setActiveIndex((i) => Math.min(flatList.length - 1, i + 1))
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault()
			setActiveIndex((i) => Math.max(0, i - 1))
		}
		if (event.key === 'Enter') {
			event.preventDefault()
			const active = flatList[activeIndex]
			if (active) pick(active.type)
		}
	}

	return (
		<div className="NodeSearchPicker">
			<div className="NodeSearchPicker-search">
				<IconSearch size={14} />
				<UiTextInput
					ref={inputRef}
					autoFocus
					placeholder="Search nodes…"
					value={query}
					onChange={setQuery}
					onKeyDown={onKeyDown}
				/>
			</div>
			<div className="NodeSearchPicker-list" role="listbox">
				{recentCandidates.length > 0 && (
					<>
						<div className="NodeSearchPicker-section">Recent</div>
						{recentCandidates.map((candidate) => (
							<PickerRow
								key={candidate.type}
								candidate={candidate}
								active={flatList[activeIndex]?.type === candidate.type}
								onPick={() => pick(candidate.type)}
							/>
						))}
					</>
				)}
				<div className="NodeSearchPicker-section">
					Best matches
					{usedJev && (
						<span className="NodeSearchPicker-jev" title="Re-ranked with JEV">
							<IconJevMark size={11} /> ranked
						</span>
					)}
				</div>
				{best.map((entry) => (
					<PickerRow
						key={entry.candidate.type}
						candidate={entry.candidate}
						active={flatList[activeIndex]?.type === entry.candidate.type}
						onPick={() => pick(entry.candidate.type)}
					/>
				))}
				{best.length === 0 && <div className="NodeSearchPicker-empty">No matching nodes</div>}
				{others.length > 0 && (
					<button
						type="button"
						className="NodeSearchPicker-others"
						onClick={() => setOthersOpen((v) => !v)}
					>
						Other compatible ({others.length}) {othersOpen ? '▾' : '▸'}
					</button>
				)}
				{othersOpen &&
					others.map((entry) => (
						<PickerRow
							key={entry.candidate.type}
							candidate={entry.candidate}
							active={flatList[activeIndex]?.type === entry.candidate.type}
							onPick={() => pick(entry.candidate.type)}
						/>
					))}
			</div>
			<div className="NodeSearchPicker-footer">
				<UiCheckbox
					checked={smartRanking}
					label="Smart ranking"
					onChange={(on) => {
						setSmartRanking(on)
						writeSmartRanking(on)
					}}
				/>
			</div>
		</div>
	)
}

function PickerRow({
	candidate,
	active,
	onPick,
}: {
	candidate: PickerCandidate
	active: boolean
	onPick: () => void
}) {
	const editor = useEditor()
	const def = (getNodeDefinitions(editor) as Record<string, NodeDefinition<NodeType>>)[candidate.type]
	return (
		<button
			type="button"
			role="option"
			aria-selected={active}
			className={'NodeSearchPicker-row' + (active ? ' is-active' : '')}
			onPointerDown={editor.markEventAsHandled}
			onClick={onPick}
		>
			<span className="NodeSearchPicker-row-icon" style={{ color: PORT_TYPE_COLORS.any }}>
				{def?.icon}
			</span>
			<span className="NodeSearchPicker-row-text">
				<span className="NodeSearchPicker-row-title">{candidate.title}</span>
				{candidate.description && (
					<span className="NodeSearchPicker-row-desc">{candidate.description}</span>
				)}
			</span>
			{active && <IconCheck size={12} />}
		</button>
	)
}
