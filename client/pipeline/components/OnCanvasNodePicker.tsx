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
import { NODE_GROUP_LABELS } from '../../../shared/nodeGroups'
import { CardDoc, getCardDocs, searchCards } from '../../../shared/cardSearch'
import { readPickerRecency, recordPick } from '../../../shared/pickerRank'
import { useJevRerank } from './useJevRerank'
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
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		inputRef.current?.focus()
	}, [])

	const allDefs = useValue(
		'picker node defs',
		() => Object.values(getNodeDefinitions(editor)).filter((def) => !def.hidden),
		[editor]
	)
	const visibleTypes = useMemo(
		() => new Set<string>((allDefs as NodeDefinition<NodeType>[]).map((d) => d.type)),
		[allDefs]
	)

	// Every input port each node type would have once created, at its default values.
	const compatibleTypes = useMemo(() => {
		const set = new Set<string>()
		for (const def of allDefs as NodeDefinition<NodeType>[]) {
			const defaultNode = def.getDefault()
			const ports = def.getPorts({ props: { node: defaultNode } } as never, defaultNode)
			const ok = Object.values(ports).some(
				(port) => port.terminal === 'end' && arePortDataTypesCompatible(sourceDataType, port.dataType)
			)
			if (ok) set.add(def.type)
		}
		return set
	}, [allDefs, sourceDataType])

	// One search engine (shared/cardSearch.ts): plain cards plus deep entries ("DataPipe ·
	// Pivot", "Chart · Line", …), hard-filtered to types whose input ports accept this wire.
	const docs = useMemo(() => getCardDocs().filter((d) => visibleTypes.has(d.type)), [visibleTypes])
	const recency = useMemo(() => readPickerRecency(), [])

	const recentIds = useMemo(() => {
		if (query.trim()) return []
		return Object.entries(recency)
			.filter(([id]) => docs.some((d) => d.id === id && compatibleTypes.has(d.type)))
			.sort((a, b) => b[1].last - a[1].last)
			.slice(0, 5)
			.map(([id]) => id)
	}, [recency, docs, compatibleTypes, query])

	const localRanked = useMemo(
		() => searchCards(query, docs, { recency, compatibleTypes, requireCompatible: true }),
		[query, docs, recency, compatibleTypes]
	)

	const jevContext = source?.title
		? `${source.title} output (${sourceDataType}): ${source.preview}`
		: `A new node (${sourceDataType} output)`
	const { ranked, usedJev, smartRanking, setSmartRanking } = useJevRerank(query, localRanked, jevContext)

	const recentCandidates = useMemo(
		() => recentIds.map((id) => docs.find((d) => d.id === id)!).filter(Boolean),
		[recentIds, docs]
	)
	const recentSet = useMemo(() => new Set(recentIds), [recentIds])
	const bestShown = query.trim() ? ranked : ranked.filter((entry) => !recentSet.has(entry.doc.id))
	const BEST_LIMIT = 8
	const best = bestShown.slice(0, BEST_LIMIT)
	const others = bestShown.slice(BEST_LIMIT)

	const flatList = useMemo(
		() => [
			...recentCandidates.map((c) => ({ id: c.id })),
			...best.map((entry) => ({ id: entry.doc.id })),
			...(othersOpen ? others.map((entry) => ({ id: entry.doc.id })) : []),
		],
		[recentCandidates, best, others, othersOpen]
	)

	useEffect(() => setActiveIndex(0), [query])

	const pick = useCallback(
		(doc: CardDoc) => {
			const def = (allDefs as NodeDefinition<NodeType>[]).find((d) => d.type === doc.type)
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

			recordPick(doc.id)
			const node = doc.deep ? { ...def.getDefault(), [doc.deep.field]: doc.deep.value } : def.getDefault()
			state.onPick(node as NodeType, terminalInPageSpace)
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
			const doc = active && docs.find((d) => d.id === active.id)
			if (doc) pick(doc)
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
						{recentCandidates.map((doc) => (
							<PickerRow
								key={doc.id}
								doc={doc}
								active={flatList[activeIndex]?.id === doc.id}
								onPick={() => pick(doc)}
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
						key={entry.doc.id}
						doc={entry.doc}
						active={flatList[activeIndex]?.id === entry.doc.id}
						onPick={() => pick(entry.doc)}
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
							key={entry.doc.id}
							doc={entry.doc}
							active={flatList[activeIndex]?.id === entry.doc.id}
							onPick={() => pick(entry.doc)}
						/>
					))}
			</div>
			<div className="NodeSearchPicker-footer">
				<UiCheckbox checked={smartRanking} label="Smart ranking" onChange={setSmartRanking} />
			</div>
		</div>
	)
}

export function PickerRow({
	doc,
	active,
	onPick,
}: {
	doc: CardDoc
	active: boolean
	onPick: () => void
}) {
	const editor = useEditor()
	const def = (getNodeDefinitions(editor) as Record<string, NodeDefinition<NodeType>>)[doc.type]
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
				<span className="NodeSearchPicker-row-title">
					{doc.title}
					<span className="NodeSearchPicker-row-group">{NODE_GROUP_LABELS[doc.group] ?? doc.group}</span>
				</span>
				{doc.description && <span className="NodeSearchPicker-row-desc">{doc.description}</span>}
			</span>
			{active && <IconCheck size={12} />}
		</button>
	)
}
