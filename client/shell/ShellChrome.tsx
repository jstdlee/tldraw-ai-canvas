import { useEffect, useMemo, useState } from 'react'
import { Editor, TLShapeId, useEditor, useValue } from 'tldraw'
import { FEATURE_ROWS } from '../../shared/featureList'
import { getNodeDefinitions } from '../pipeline/nodes/nodeTypes'
import { createShapeId } from 'tldraw'
import { diveGroup, groupPlainText, leaveGroup } from '../pipeline/groups/groupActions'
import { historyMemory, restoreOp, searchDisk, watchHistory } from './opHistory'
import { $findOpen } from '../clips/FindBar'
import { $backup, $featuresOpen, $historyOpen, $libraryRail, $mapOpen, $paletteOpen, $searchHits, loadBackup } from './shellState'

function stop(event: { stopPropagation: () => void; target?: EventTarget | null; currentTarget?: EventTarget | null }) {
	event.stopPropagation()
}

export function ShellChrome() {
	const editor = useEditor()
	useEffect(() => watchHistory(editor), [editor])
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const tag = (event.target as HTMLElement | null)?.tagName
			const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (event.target as HTMLElement | null)?.isContentEditable
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p' && !event.shiftKey) {
				event.preventDefault()
				event.stopPropagation()
				$paletteOpen.set(!$paletteOpen.get())
			}
			if (!typing && event.shiftKey && !event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'b') {
				event.preventDefault()
				$libraryRail.set(!$libraryRail.get())
			}
		}
		window.addEventListener('keydown', onKey, true)
		return () => window.removeEventListener('keydown', onKey, true)
	}, [])
	return (
		<>
			<GroupBack editor={editor} />
			<CommandPalette editor={editor} />
			<MapView editor={editor} />
			<HistoryPanel editor={editor} />
			<FeaturePanel />
			<BackupClock editor={editor} />
		</>
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

function CommandPalette({ editor }: { editor: Editor }) {
	const open = useValue('palette', () => $paletteOpen.get(), [])
	const [query, setQuery] = useState('')
	const items = useMemo(() => {
		const nodes = Object.values(getNodeDefinitions(editor))
			.filter((def) => !def.hidden)
			.map((def) => ({ id: `node:${def.type}`, label: `Insert ${def.title}`, run: () => insertNode(editor, def.type) }))
		const tools = [
			{ id: 'find', label: 'Find on canvas', run: () => $findOpen.set(true) },
			{ id: 'map', label: 'Map view', run: () => $mapOpen.set(!$mapOpen.get()) },
			{ id: 'history', label: 'Operation history', run: () => $historyOpen.set(true) },
			{ id: 'features', label: 'Features compared with tldraw', run: () => $featuresOpen.set(true) },
			{ id: 'library', label: 'Collapse node library', run: () => $libraryRail.set(!$libraryRail.get()) },
		]
		const q = query.trim().toLowerCase()
		return [...tools, ...nodes].filter((item) => !q || item.label.toLowerCase().includes(q))
	}, [editor, query])
	if (!open) return null
	return (
		<div className="Palette-backdrop" onPointerDown={(event) => event.target === event.currentTarget && $paletteOpen.set(false)}>
			<div className="Palette" role="dialog" aria-label="Command palette">
				<input
					autoFocus
					placeholder="Search features and nodes"
					value={query}
					onPointerDown={stop}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						event.stopPropagation()
						if (event.key === 'Escape') $paletteOpen.set(false)
						if (event.key === 'Enter' && items[0]) {
							items[0].run()
							$paletteOpen.set(false)
						}
					}}
				/>
				<div className="Palette-list">
					{items.slice(0, 40).map((item) => (
						<button
							key={item.id}
							type="button"
							onClick={() => {
								item.run()
								$paletteOpen.set(false)
							}}
						>
							{item.label}
						</button>
					))}
				</div>
			</div>
		</div>
	)
}

function insertNode(editor: Editor, type: string) {
	const def = getNodeDefinitions(editor)[type as keyof ReturnType<typeof getNodeDefinitions>]
	if (!def) return
	const id = createShapeId()
	const center = editor.getViewportPageBounds().center
	editor.run(() => {
		editor.createShape({ id, type: 'node', x: center.x - 130, y: center.y - 40, props: { node: def.getDefault() } })
		editor.select(id)
	})
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

function HistoryPanel({ editor }: { editor: Editor }) {
	const open = useValue('history', () => $historyOpen.get(), [])
	const [query, setQuery] = useState('')
	const [disk, setDisk] = useState<ReturnType<typeof historyMemory>>([])
	useEffect(() => {
		if (!open) return
		void searchDisk(query).then(setDisk)
	}, [open, query])
	if (!open) return null
	const q = query.trim().toLowerCase()
	const local = historyMemory().filter((op) => !q || op.label.includes(q) || op.shapeId.includes(q)).slice(-40).reverse()
	return (
		<div className="SideSheet" onPointerDown={stop}>
			<div className="SideSheet-bar">
				<strong>History</strong>
				<button type="button" onClick={() => $historyOpen.set(false)} aria-label="Close">×</button>
			</div>
			<input placeholder="Search operations" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.stopPropagation()} />
			<p className="NodeHint">The last 100 stay in memory. Older ones are in the data folder.</p>
			{local.map((op, index) => (
				<button key={`${op.t}-${index}`} type="button" onClick={() => restoreOp(editor, op.record)}>
					{op.kind} {op.label}
				</button>
			))}
			{disk.length > 0 && <strong>On disk</strong>}
			{disk.slice(-20).reverse().map((op, index) => (
				<button key={`disk-${op.t}-${index}`} type="button" onClick={() => restoreOp(editor, op.record)}>
					{op.kind} {op.label}
				</button>
			))}
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

export function openHistory() {
	$historyOpen.set(true)
}

export function openFeatures() {
	$featuresOpen.set(true)
}

export function toggleLibraryRail() {
	$libraryRail.set(!$libraryRail.get())
}
