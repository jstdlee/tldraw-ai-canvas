import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { DefaultColorStyle, Editor, TLDefaultColorStyle, TLShapeId, useActions, useEditor, useValue } from 'tldraw'
import { FEATURE_ROWS } from '../../shared/featureList'
import { getNodeDefinitions, NodeType } from '../pipeline/nodes/nodeTypes'
import { diveGroup, groupPlainText, leaveGroup } from '../pipeline/groups/groupActions'
import { $findOpen } from '../clips/FindBar'
import { createNodeAt, wireNodes } from '../pipeline/placeNode'
import { CardDoc, getCardDocs, searchCards } from '../../shared/cardSearch'
import { readPickerRecency, recordPick } from '../../shared/pickerRank'
import { PickerRow } from '../pipeline/components/OnCanvasNodePicker'
import { useJevRerank } from '../pipeline/components/useJevRerank'
import { IconGroup, IconJevMark, IconGlobe, IconSearch, IconSidebarCollapse, UiTextInput } from '../ui'
import { initNativeMenuScrollArrows } from '../ui/nativeMenuScrollArrows'
import {
	$backup,
	$colorChordOpen,
	$featuresOpen,
	$insertPalette,
	$libraryRail,
	$mapOpen,
	$paletteOpen,
	$searchHits,
	advanceColorChordToColor,
	cancelColorChord,
	getColorChordStep,
	loadBackup,
	openInsertPaletteAtPointer,
	startColorChord,
} from './shellState'

function stop(event: { stopPropagation: () => void; target?: EventTarget | null; currentTarget?: EventTarget | null }) {
	event.stopPropagation()
}

/** Colour keys for the Ctrl/Cmd+B, C, <key> chord. */
const CHORD_COLORS: Record<string, string> = {
	g: 'green',
	k: 'black',
	d: 'black',
	b: 'blue',
	r: 'red',
	y: 'yellow',
}
function applyChordColor(editor: Editor, color: string) {
	const value = color as TLDefaultColorStyle
	editor.setStyleForSelectedShapes(DefaultColorStyle, value)
	editor.setStyleForNextShapes(DefaultColorStyle, value)
	const nodeIds = editor
		.getSelectedShapes()
		.filter((shape) => shape.type === 'node')
		.map((shape) => shape.id)
	if (nodeIds.length) {
		editor.run(() => {
			for (const id of nodeIds) {
				editor.updateShape({ id, type: 'node', props: { color } })
			}
		})
	}
}

export function ShellChrome() {
	const editor = useEditor()
	const actions = useActions()

	// WP27 Part A: scroll arrows for tldraw's own context menu / Insert submenus. Idempotent and
	// DOM-watcher based (see nativeMenuScrollArrows.ts) since those menus aren't our React tree.
	useEffect(() => {
		initNativeMenuScrollArrows()
	}, [])

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const tag = (event.target as HTMLElement | null)?.tagName
			const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (event.target as HTMLElement | null)?.isContentEditable

			const chordStep = getColorChordStep()
			if (chordStep !== 'idle') {
				if (event.key === 'Escape') {
					event.preventDefault()
					cancelColorChord()
					return
				}
				const key = event.key.toLowerCase()
				if (chordStep === 'wait-c') {
					if (key === 'c') {
						event.preventDefault()
						advanceColorChordToColor()
						return
					}
					if (key in CHORD_COLORS) {
						// A colour key straight after Ctrl+B is also accepted.
						event.preventDefault()
						applyChordColor(editor, CHORD_COLORS[key])
						cancelColorChord()
						return
					}
					cancelColorChord()
				} else if (chordStep === 'wait-color') {
					if (key in CHORD_COLORS) {
						event.preventDefault()
						applyChordColor(editor, CHORD_COLORS[key])
					}
					cancelColorChord()
					return
				}
			}

			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p' && event.shiftKey) {
				// Ctrl/Cmd+Shift+P groups the selection as a box. Handled here (not left to
				// tldraw's own kbd dispatch for the 'pack-nodes' action) so it is never
				// swallowed by the browser's own reserved Ctrl/Cmd+Shift+P shortcut, and so
				// the plain Ctrl/Cmd+P branch below only ever sees the palette toggle.
				event.preventDefault()
				event.stopPropagation()
				actions['pack-nodes']?.onSelect('kbd')
				return
			}
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p' && !event.shiftKey) {
				event.preventDefault()
				event.stopPropagation()
				$paletteOpen.set(!$paletteOpen.get())
			}
			if (!typing && event.shiftKey && !event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'b') {
				event.preventDefault()
				$libraryRail.set(!$libraryRail.get())
			}
			if (!typing && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'b') {
				// Ctrl/Cmd+B opens the colour chord; prevented only outside text fields so
				// bold-text shortcuts in a text field still work.
				event.preventDefault()
				startColorChord()
				return
			}
			if (!typing && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'e') {
				event.preventDefault()
				event.stopPropagation()
				actions['erase-selection']?.onSelect('kbd')
			}
			// "/" opens the insert palette at the pointer: never while typing in a field, and
			// never while tldraw itself is editing a shape (typing inside a text/node field).
			if (
				!typing &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey &&
				event.key === '/' &&
				editor.getEditingShapeId() === null
			) {
				event.preventDefault()
				openInsertPaletteAtPointer(editor)
				return
			}
			// Ctrl/Cmd+Shift+I opens the same insert palette from anywhere.
			if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'i') {
				event.preventDefault()
				event.stopPropagation()
				openInsertPaletteAtPointer(editor)
			}
		}
		window.addEventListener('keydown', onKey, true)
		return () => window.removeEventListener('keydown', onKey, true)
	}, [editor, actions])

	return (
		<>
			<GroupBack editor={editor} />
			<CommandPalette editor={editor} />
			<InsertPalette editor={editor} />
			<MapView editor={editor} />
			<FeaturePanel />
			<BackupClock editor={editor} />
			<ColorChordHint />
		</>
	)
}

/** Floating hint shown while the Ctrl/Cmd+B colour chord is active. */
function ColorChordHint() {
	const open = useValue('color chord open', () => $colorChordOpen.get(), [])
	if (!open) return null
	return (
		<div className="ColorChordHint" onPointerDown={stop}>
			Colour: G green · K default · B blue · R red · Y yellow
		</div>
	)
}

function GroupBack({ editor }: { editor: Editor }) {
	const focused = useValue('focused group', () => editor.getFocusedGroup(), [editor])
	if (!focused || focused.type !== 'group') return null
	const label = typeof focused.meta?.label === 'string' ? focused.meta.label : 'Group'
	const text = groupPlainText(editor, focused.id)
	return (
		<div className="GroupBack" onPointerDown={stop}>
			<button type="button" onClick={() => leaveGroup(editor)}>
				Back to {label}
			</button>
			<button type="button" onClick={() => diveGroup(editor)}>
				Fit
			</button>
			{text && <span className="GroupBack-text">{text.slice(0, 180)}</span>}
		</div>
	)
}

/** Every non-hidden node type, as the one search engine's card documents. */
function useVisibleCardDocs(editor: Editor) {
	return useMemo(() => {
		const visible = new Set<string>(
			Object.values(getNodeDefinitions(editor))
				.filter((def) => !def.hidden)
				.map((def) => def.type)
		)
		return getCardDocs().filter((d) => visible.has(d.type))
	}, [editor])
}

/** Insert `doc`'s card (preset per `doc.deep`, if any) at the viewport centre and select it. */
function insertCard(editor: Editor, doc: CardDoc) {
	const def = getNodeDefinitions(editor)[doc.type as keyof ReturnType<typeof getNodeDefinitions>]
	if (!def) return
	recordPick(doc.id)
	const node = doc.deep ? { ...def.getDefault(), [doc.deep.field]: doc.deep.value } : def.getDefault()
	createNodeAt(editor, node as NodeType, { near: 'viewport', select: true })
}

/** The JEV context line: the selected card's title, if there is exactly one selected. */
function useSelectedCardTitle(editor: Editor): string {
	return useValue(
		'selected card title',
		() => {
			const shape = editor.getOnlySelectedShape()
			if (shape?.type !== 'node') return 'No card selected'
			const defs = getNodeDefinitions(editor)
			const label = (shape.props as { label?: string }).label
			const title =
				(typeof label === 'string' && label.trim()) ||
				defs[shape.props.node.type as keyof typeof defs]?.title ||
				shape.props.node.type
			return `Selected card: ${title}`
		},
		[editor]
	)
}

/**
 * WP27 Part C: a palette row for a feature/tool action (Find, Map view, Features, Collapse
 * library) — the same icon/title/hint look as `PickerRow`'s card rows, plus an optional
 * keyboard shortcut on the right, so the palette's first rows match the rest instead of
 * being bare `<button>` text.
 */
function CommandRow({
	icon,
	label,
	hint,
	shortcut,
	onClick,
}: {
	icon: ReactNode
	label: string
	hint?: string
	shortcut?: string
	onClick: () => void
}) {
	return (
		<button type="button" className="NodeSearchPicker-row" onClick={onClick}>
			<span className="NodeSearchPicker-row-icon">{icon}</span>
			<span className="NodeSearchPicker-row-text">
				<span className="NodeSearchPicker-row-title">{label}</span>
				{hint && <span className="NodeSearchPicker-row-desc">{hint}</span>}
			</span>
			{shortcut && <span className="NodeSearchPicker-row-shortcut">{shortcut}</span>}
		</button>
	)
}

/**
 * Ctrl/Cmd+P: features, tools and, in an "Insert" section, every card from the one
 * search engine (shared/cardSearch.ts) — the same ranking the library and the wire-drop
 * picker use. Ctrl/Cmd+Shift+I / "/" open the narrower insert-mode palette instead
 * (see `InsertPalette` below), which inserts at the pointer and can wire as it goes.
 */
function CommandPalette({ editor }: { editor: Editor }) {
	const open = useValue('palette', () => $paletteOpen.get(), [])
	const [query, setQuery] = useState('')
	const cardDocs = useVisibleCardDocs(editor)

	// WP27 Part C: these rows render with the same look as every other palette row
	// (CommandRow below, which shares PickerRow's icon/title/hint/shortcut layout) instead of
	// their own bare-button markup.
	const tools = useMemo(
		() => [
			{ id: 'find', label: 'Find on canvas', hint: 'Search text and labels on this canvas', shortcut: 'Ctrl F', icon: <IconSearch size={15} />, run: () => $findOpen.set(true) },
			{ id: 'map', label: 'Map view', hint: 'See every shape and pan by clicking', icon: <IconGlobe size={15} />, run: () => $mapOpen.set(!$mapOpen.get()) },
			{ id: 'features', label: 'Features compared with tldraw', hint: 'What this app adds over plain tldraw', icon: <IconGroup size={15} />, run: () => $featuresOpen.set(true) },
			{ id: 'library', label: 'Collapse node library', hint: 'Toggle the card library drawer', shortcut: 'Shift B', icon: <IconSidebarCollapse size={15} />, run: () => $libraryRail.set(!$libraryRail.get()) },
		],
		[]
	)

	const matchedTools = useMemo(() => {
		const q = query.trim().toLowerCase()
		return tools.filter((item) => !q || item.label.toLowerCase().includes(q))
	}, [tools, query])

	const localRanked = useMemo(() => {
		if (!open) return []
		return searchCards(query, cardDocs, { recency: readPickerRecency() }).slice(0, 20)
	}, [open, query, cardDocs])
	const selectedCardTitle = useSelectedCardTitle(editor)
	const { ranked: cardResults, usedJev } = useJevRerank(query, localRanked, selectedCardTitle)

	const runFirst = () => {
		if (matchedTools[0]) {
			matchedTools[0].run()
		} else if (cardResults[0]) {
			insertCard(editor, cardResults[0].doc)
		} else {
			return
		}
		$paletteOpen.set(false)
	}

	if (!open) return null
	return (
		<div className="Palette-backdrop" onPointerDown={(event) => event.target === event.currentTarget && $paletteOpen.set(false)}>
			<div className="Palette" role="dialog" aria-label="Command palette">
				<input
					autoFocus
					placeholder="Search features and cards"
					value={query}
					onPointerDown={stop}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						event.stopPropagation()
						if (event.key === 'Escape') $paletteOpen.set(false)
						if (event.key === 'Enter') runFirst()
					}}
				/>
				<div className="Palette-list">
					{matchedTools.map((item) => (
						<CommandRow
							key={item.id}
							icon={item.icon}
							label={item.label}
							hint={item.hint}
							shortcut={item.shortcut}
							onClick={() => {
								item.run()
								$paletteOpen.set(false)
							}}
						/>
					))}
					{cardResults.length > 0 && (
						<div className="NodeSearchPicker-section">
							Insert
							{usedJev && (
								<span className="NodeSearchPicker-jev" title="Re-ranked with JEV">
									<IconJevMark size={11} /> ranked
								</span>
							)}
						</div>
					)}
					{cardResults.map((entry) => (
						<PickerRow
							key={entry.doc.id}
							doc={entry.doc}
							active={false}
							onPick={() => {
								insertCard(editor, entry.doc)
								$paletteOpen.set(false)
							}}
						/>
					))}
				</div>
			</div>
		</div>
	)
}

/**
 * The "/" / Ctrl+Shift+I insert palette: searches every card (the same engine as
 * `CommandPalette`'s "Insert" section) and inserts at the pointer with `createNodeAt`
 * (free spot). Shift+Enter also wires the new card to the selected card's first
 * compatible output port, mirroring the wire-drop picker's own "insert and wire" flow.
 */
function InsertPalette({ editor }: { editor: Editor }) {
	const at = useValue('insert palette', () => $insertPalette.get(), [])
	const [query, setQuery] = useState('')
	const [activeIndex, setActiveIndex] = useState(0)
	const inputRef = useRef<HTMLInputElement>(null)
	const cardDocs = useVisibleCardDocs(editor)

	useEffect(() => {
		if (!at) return
		setQuery('')
		setActiveIndex(0)
		inputRef.current?.focus()
	}, [at])

	const localRanked = useMemo(() => {
		if (!at) return []
		return searchCards(query, cardDocs, { recency: readPickerRecency() }).slice(0, 30)
	}, [at, query, cardDocs])
	const selectedCardTitle = useSelectedCardTitle(editor)
	const { ranked: results, usedJev } = useJevRerank(query, localRanked, selectedCardTitle)

	const close = () => $insertPalette.set(null)

	const insert = (doc: CardDoc, wireToSelection: boolean) => {
		const def = getNodeDefinitions(editor)[doc.type as keyof ReturnType<typeof getNodeDefinitions>]
		if (!def || !at) return
		recordPick(doc.id)
		const node = doc.deep ? { ...def.getDefault(), [doc.deep.field]: doc.deep.value } : def.getDefault()
		const selected = wireToSelection ? editor.getOnlySelectedShape() : null
		const newId = createNodeAt(editor, node as NodeType, { near: at, select: true })
		if (selected?.type === 'node') wireNodes(editor, selected.id, newId)
		close()
	}

	if (!at) return null
	return (
		<div className="Palette-backdrop" onPointerDown={(event) => event.target === event.currentTarget && close()}>
			<div className="Palette Palette-insert" role="dialog" aria-label="Insert card">
				<div className="NodeSearchPicker-search">
					<IconSearch size={14} />
					<UiTextInput
						ref={inputRef}
						autoFocus
						placeholder="Insert card…"
						value={query}
						onChange={setQuery}
						onKeyDown={(event) => {
							event.stopPropagation()
							if (event.key === 'Escape') {
								close()
								return
							}
							if (event.key === 'ArrowDown') {
								event.preventDefault()
								setActiveIndex((i) => Math.min(results.length - 1, i + 1))
								return
							}
							if (event.key === 'ArrowUp') {
								event.preventDefault()
								setActiveIndex((i) => Math.max(0, i - 1))
								return
							}
							if (event.key === 'Enter') {
								event.preventDefault()
								const entry = results[activeIndex]
								if (entry) insert(entry.doc, event.shiftKey)
							}
						}}
					/>
				</div>
				<div className="Palette-list NodeSearchPicker-list" role="listbox">
					{usedJev && results.length > 0 && (
						<div className="NodeSearchPicker-section">
							<span className="NodeSearchPicker-jev" title="Re-ranked with JEV">
								<IconJevMark size={11} /> ranked
							</span>
						</div>
					)}
					{results.map((entry, i) => (
						<PickerRow key={entry.doc.id} doc={entry.doc} active={i === activeIndex} onPick={() => insert(entry.doc, false)} />
					))}
					{results.length === 0 && <div className="NodeSearchPicker-empty">No matching cards</div>}
				</div>
				<div className="NodeSearchPicker-footer Palette-insert-hint">
					Enter inserts · Shift+Enter inserts and wires from the selected card
				</div>
			</div>
		</div>
	)
}

function MapView({ editor }: { editor: Editor }) {
	const open = useValue('map', () => $mapOpen.get(), [])
	const hits = useValue('hits', () => $searchHits.get(), [])
	// Subscribe to shapes, page bounds, camera, and viewport so the map (and the
	// little viewport rectangle) tracks pan/zoom instead of a stale snapshot.
	const shapes = useValue('map shapes', () => (open ? editor.getCurrentPageShapes() : []), [editor, open])
	const page = useValue('map page', () => (open ? editor.getCurrentPageBounds() : undefined), [editor, open])
	const camera = useValue('map camera', () => (open ? editor.getCamera() : { x: 0, y: 0, z: 1 }), [editor, open])
	const view = useValue('map view', () => (open ? editor.getViewportPageBounds() : undefined), [editor, open])
	const tick = shapes.length
	if (!open) return null
	const width = 220
	const height = 150
	const scale = page && page.width && page.height ? Math.min(width / page.width, height / page.height) : 1
	const pan = (event: { currentTarget: SVGSVGElement; clientX: number; clientY: number }) => {
		if (!page) return
		const rect = event.currentTarget.getBoundingClientRect()
		const x = page.minX + ((event.clientX - rect.left) / width) * page.width
		const y = page.minY + ((event.clientY - rect.top) / height) * page.height
		editor.centerOnPoint({ x, y }, { animation: { duration: 0 } })
	}
	return (
		<div
			className="MapView"
			onPointerDown={stop}
			title={`${tick} shapes`}
		>
			<svg
				width={width}
				height={height}
				onPointerDown={(event) => {
					event.currentTarget.setPointerCapture(event.pointerId)
					pan(event)
				}}
				onPointerMove={(event) => {
					if (event.buttons === 1) pan(event)
				}}
			>
				{page &&
					shapes.slice(0, 400).map((shape) => {
						const bounds = editor.getShapePageBounds(shape.id)
						if (!bounds) return null
						const hot = hits.includes(shape.id)
						return (
							<rect
								key={shape.id}
								className={hot ? 'MapView-hit' : undefined}
								x={(bounds.minX - page.minX) * scale}
								y={(bounds.minY - page.minY) * scale}
								width={Math.max(2, bounds.width * scale)}
								height={Math.max(2, bounds.height * scale)}
							/>
						)
					})}
				{page && view && (
					<rect
						className="MapView-camera"
						x={(view.minX - page.minX) * scale}
						y={(view.minY - page.minY) * scale}
						width={Math.max(4, view.width * scale)}
						height={Math.max(4, view.height * scale)}
						fill="none"
					/>
				)}
			</svg>
			<button type="button" onClick={() => $mapOpen.set(false)} aria-label="Close map">
				×
			</button>
			<span className="MapView-zoom">{camera.z.toFixed(2)}</span>
		</div>
	)
}

function FeaturePanel() {
	const open = useValue('features', () => $featuresOpen.get(), [])
	if (!open) return null
	return (
		<div className="SideSheet SideSheet-wide" onPointerDown={stop}>
			<div className="SideSheet-bar">
				<strong>Compared with tldraw</strong>
				<button type="button" onClick={() => $featuresOpen.set(false)} aria-label="Close">×</button>
			</div>
			<table className="FeatureTable">
				<thead>
					<tr>
						<th>Feature</th>
						<th>tldraw</th>
						<th>Oh My tldraw</th>
					</tr>
				</thead>
				<tbody>
					{FEATURE_ROWS.map((row) => (
						<tr key={row.name}>
							<td>{row.name}</td>
							<td>{row.tldraw}</td>
							<td>{row.here}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

function BackupClock({ editor }: { editor: Editor }) {
	const settings = useValue('backup', () => $backup.get(), [])
	useEffect(() => {
		$backup.set(loadBackup())
	}, [])
	useEffect(() => {
		if (!settings.minutes) return
		const id = window.setInterval(() => {
			void fetch('/api/backup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ snapshot: editor.getSnapshot(), target: settings.target }),
			})
		}, settings.minutes * 60_000)
		return () => window.clearInterval(id)
	}, [editor, settings.minutes, settings.target])
	return null
}

export function openMap() {
	$mapOpen.set(!$mapOpen.get())
}

export function openFeatures() {
	$featuresOpen.set(true)
}

export function toggleLibraryRail() {
	$libraryRail.set(!$libraryRail.get())
}
