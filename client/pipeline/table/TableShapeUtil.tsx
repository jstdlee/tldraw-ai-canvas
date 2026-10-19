import classNames from 'classnames'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	createShapeId,
	createShapePropsMigrationIds,
	createShapePropsMigrationSequence,
	Editor,
	getColorValue,
	HTMLContainer,
	RecordProps,
	Rectangle2d,
	resizeBox,
	ShapeUtil,
	T,
	TLResizeInfo,
	TLShape,
	useEditor,
	useValue,
} from 'tldraw'
import {
	buildTableTemplate,
	computeAutoFitRowHeight,
	computeAutoFitWidth,
	DEFAULT_ROW_HEIGHT,
	deleteColumn,
	deleteRow,
	duplicateRow,
	insertColumn,
	insertRow,
	MAX_COLUMN_WIDTH,
	MIN_COLUMN_WIDTH,
	MIN_ROW_HEIGHT,
	nextTableId,
	pasteIntoTable,
	parseRawGrid,
	reorderColumn,
	reorderRow,
	scaleColumnWidths,
	scaleRowHeights,
	setColumnType,
	sortByColumn,
	TABLE_SOFT_ROW_LIMIT,
	TABLE_TEMPLATE_LABELS,
	TableColumn,
	TableColumnType,
	TableData,
	TableRow,
	TableStatusOption,
	tableHeight,
	tableWidth,
	toCSV,
	toMarkdown,
	withTableDefaults,
	type TableTemplateId,
} from '../../../shared/table/canvasTableOps'
import { IconCheck, IconChevronDown, IconClose, IconMore, UiButton, UiIconButton } from '../../ui'

export const TABLE_TYPE = 'table'
/** Width of the row-number gutter column. Part of the shape's real on-screen footprint (the CSS
 * grid in TableShapeComponent renders it as an extra leading column), so every geometry
 * calculation (getGeometry, onResize) must add it to shared/table/canvasTableOps's tableWidth —
 * that function only knows about the data columns. */
export const ROW_GUTTER_PX = 24

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		[TABLE_TYPE]: {
			table: TableData
			color?: string
			size?: 's' | 'm' | 'l' | 'xl'
			dash?: 'none' | 'solid' | 'dashed' | 'dotted'
		}
	}
}

export type TableShape = TLShape<typeof TABLE_TYPE>

const stop = (e: { stopPropagation(): void }) => e.stopPropagation()

/** Perceived-luminance check so a status/priority pill's text reads clearly against its own
 * solid background colour in BOTH themes — a fixed "semi background + solid text" pairing (the
 * original approach) was too low-contrast for several colours in dark mode (grey, violet) where
 * tldraw's own 'solid' and 'semi' variants of the same hue sit close together in lightness. */
function pillTextColor(bgHex: string): string {
	const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(bgHex)
	if (!m) return '#ffffff'
	const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255)
	const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
	const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
	return luminance > 0.45 ? '#1a1a1a' : '#ffffff'
}

export function rowHeightForSize(size: TableShape['props']['size']): number {
	switch (size) {
		case 's':
			return 26
		case 'l':
			return 40
		case 'xl':
			return 52
		default:
			return DEFAULT_ROW_HEIGHT
	}
}

export function fontPxForSize(size: TableShape['props']['size']): number {
	switch (size) {
		case 's':
			return 11
		case 'l':
			return 15
		case 'xl':
			return 18
		default:
			return 12.5
	}
}

const tableColumnOptionValidator = T.object({ id: T.string, label: T.string, color: T.string })
const tableColumnValidator = T.object({
	id: T.string,
	name: T.string,
	width: T.number,
	type: T.literalEnum('text', 'number', 'status', 'checkbox', 'date', 'link', 'person'),
	align: T.literalEnum('left', 'center', 'right').optional(),
	options: T.arrayOf(tableColumnOptionValidator).optional(),
})
const tableRowValidator = T.object({
	id: T.string,
	height: T.number.optional(),
	color: T.string.optional(),
	cells: T.dict(T.string, T.string),
})
const tableDataValidator = T.object({
	columns: T.arrayOf(tableColumnValidator),
	rows: T.arrayOf(tableRowValidator),
	headerRow: T.boolean,
	rowNumbers: T.boolean.optional(),
})

const tableShapeVersions = createShapePropsMigrationIds(TABLE_TYPE, {
	EnsureTableDefaults: 1,
})

/** v1: fills anything missing/malformed in `table` (old/foreign data, a future smaller schema)
 * from withTableDefaults, the same helper getDefaultProps and every mutation here goes through —
 * see tests/canvasTableOps.test.ts and tests/e2e/old-canvas-migration.spec.ts. */
const tableShapeMigrations = createShapePropsMigrationSequence({
	sequence: [
		{
			id: tableShapeVersions.EnsureTableDefaults,
			up(props: any) {
				props.table = withTableDefaults(props?.table)
				if (typeof props.headerRow !== 'undefined') {
					// headerRow briefly lived at the top level in an early draft; fold it in and drop it.
					props.table.headerRow = !!props.headerRow
					delete props.headerRow
				}
			},
		},
	],
})

export class TableShapeUtil extends ShapeUtil<TableShape> {
	static override type = TABLE_TYPE
	static override migrations = tableShapeMigrations
	static override props: RecordProps<TableShape> = {
		table: tableDataValidator,
		color: T.string.optional(),
		size: T.literalEnum('s', 'm', 'l', 'xl').optional(),
		dash: T.literalEnum('none', 'solid', 'dashed', 'dotted').optional(),
	}

	getDefaultProps(): TableShape['props'] {
		return { table: buildTableTemplate('comparison'), color: 'black', size: 'm', dash: 'solid' }
	}

	override canEdit() {
		// Cell editing is handled entirely inside the component (see activeCell/editingCell
		// state) — tldraw's own "editing shape" concept is for a single text box, not a grid.
		return false
	}
	override canResize() {
		return true
	}
	override hideRotateHandle() {
		return true
	}
	override isAspectRatioLocked() {
		return false
	}

	getGeometry(shape: TableShape) {
		return new Rectangle2d({
			width: tableWidth(shape.props.table.columns) + ROW_GUTTER_PX,
			height: tableHeight(shape.props.table, rowHeightForSize(shape.props.size)),
			isFilled: true,
		})
	}

	override onResize(shape: TableShape, info: TLResizeInfo<TableShape>) {
		const table = shape.props.table
		const rowH = rowHeightForSize(shape.props.size)
		const prevW = tableWidth(table.columns) + ROW_GUTTER_PX
		const prevH = tableHeight(table, rowH)
		// Position math only (resizeBox needs w/h props, which this shape doesn't have) —
		// same trick NodeShapeUtil.onResize uses for non-box nodes.
		const asBox = (s: TableShape, w: number, h: number) => ({ ...s, props: { ...s.props, w, h } }) as any
		const { x, y } = resizeBox(asBox(shape, prevW, prevH), {
			...info,
			initialShape: asBox(info.initialShape, prevW, prevH),
		})
		const scaleX = Math.max(0.1, Math.abs(info.scaleX))
		const scaleY = Math.max(0.1, Math.abs(info.scaleY))
		return {
			x,
			y,
			props: {
				...shape.props,
				table: {
					...table,
					columns: scaleColumnWidths(table.columns, scaleX),
					rows: scaleRowHeights(table.rows, scaleY, rowH),
				},
			},
		}
	}

	component(shape: TableShape) {
		return <TableShapeComponent shape={shape} />
	}

	getIndicatorPath(shape: TableShape) {
		const { width, height } = this.getGeometry(shape).bounds
		const path = new Path2D()
		path.roundRect(0, 0, width, height, 4)
		return path
	}
}

// ---------------------------------------------------------------------------------------------
// Insert helpers (used by the toolbar/insert menu and the agent action)
// ---------------------------------------------------------------------------------------------

export function createTableShapeAt(
	editor: Editor,
	table: TableData,
	center: { x: number; y: number },
	opts?: { select?: boolean }
) {
	const id = createShapeId()
	const markId = editor.markHistoryStoppingPoint('create table')
	editor.run(() => {
		editor.createShape<TableShape>({ id, type: TABLE_TYPE, props: { table, color: 'black', size: 'm', dash: 'solid' } })
		const shape = editor.getShape<TableShape>(id)
		const bounds = shape && editor.getShapePageBounds(id)
		if (shape && bounds) {
			editor.updateShape({ id, type: TABLE_TYPE, x: center.x - bounds.width / 2, y: center.y - bounds.height / 2 })
		}
		if (opts?.select !== false) editor.select(id)
	})
	editor.markHistoryStoppingPoint('create table')
	return { id, markId }
}

export function insertTableTemplate(editor: Editor, templateId: TableTemplateId) {
	const center = editor.getViewportPageBounds().center
	return createTableShapeAt(editor, buildTableTemplate(templateId), center)
}

export function insertBlankTable(editor: Editor, cols: number, rows: number) {
	const center = editor.getViewportPageBounds().center
	const table = withTableDefaults({
		columns: Array.from({ length: cols }, (_, i) => ({ id: nextTableId('col'), name: `Column ${i + 1}`, width: 140, type: 'text' })),
		rows: Array.from({ length: rows }, () => ({ id: nextTableId('row'), cells: {} })),
		headerRow: true,
	})
	return createTableShapeAt(editor, table, center)
}

export { TABLE_TEMPLATE_LABELS }

/**
 * WP40 Pipelines (secondary): "Use as data" — creates a Prompt card next to the table with the
 * table as CSV, and wires nothing else. A real output port on the table shape (so a wire could
 * go table -> DataPipe/Chart/For each) would need the connection/port system
 * (client/pipeline/ports/*, ConnectionBindingUtil) to support a port on a non-"node" shape type —
 * every port today is read off `NodeShape.props.node` (see getNodePorts/getNodeOutputPortInfo),
 * so that is a materially larger change than this WP's budget; this is the documented fallback.
 */
export function tableUseAsData(editor: Editor, tableShapeId: TableShape['id']) {
	const shape = editor.getShape<TableShape>(tableShapeId)
	if (!shape) return
	const csv = toCSV(shape.props.table)
	const markId = editor.markHistoryStoppingPoint('table: use as data')
	editor.run(() => {
		const id = createShapeId()
		editor.createShape({ id, type: 'node', props: { node: { type: 'prompt', text: csv } } })
		const anchor = editor.getShapePageBounds(tableShapeId)
		const bounds = editor.getShapePageBounds(id)
		if (anchor && bounds) {
			editor.updateShape({ id, type: 'node', x: anchor.x + anchor.width + 40, y: anchor.y })
		}
		editor.select(id)
	})
	return markId
}

// ---------------------------------------------------------------------------------------------
// Measuring (DOM-dependent; the math itself lives in shared/table/canvasTableOps.ts)
// ---------------------------------------------------------------------------------------------

let measureCtx: CanvasRenderingContext2D | null | undefined

function getMeasureCtx() {
	measureCtx ??= document.createElement('canvas').getContext('2d')
	return measureCtx
}

function cellDisplayText(col: TableColumn, raw: string): string {
	if (col.type === 'status') return col.options?.find((o) => o.id === raw)?.label ?? raw
	if (col.type === 'checkbox') return raw === 'true' ? 'Done' : ''
	return raw
}

function measureColumnAutoFitWidth(table: TableData, col: TableColumn, fontPx: number): number {
	const ctx = getMeasureCtx()
	if (!ctx) return col.width
	ctx.font = `600 ${fontPx}px var(--tl-font-sans, sans-serif)`
	const headerW = ctx.measureText(col.name).width
	ctx.font = `${fontPx}px var(--tl-font-sans, sans-serif)`
	const widths = [headerW, ...table.rows.map((r) => ctx.measureText(cellDisplayText(col, r.cells[col.id] ?? '')).width)]
	return computeAutoFitWidth(widths, { min: MIN_COLUMN_WIDTH, max: MAX_COLUMN_WIDTH })
}

function wrappedHeight(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, lineHeight: number): number {
	if (!text) return lineHeight
	const words = text.split(/\s+/).filter(Boolean)
	let lines = 1
	let lineWidth = 0
	for (const w of words) {
		const wWidth = ctx.measureText(w + ' ').width
		if (lineWidth + wWidth > maxWidth && lineWidth > 0) {
			lines++
			lineWidth = wWidth
		} else {
			lineWidth += wWidth
		}
	}
	return lines * lineHeight
}

function measureRowAutoFitHeight(table: TableData, row: TableRow, fontPx: number): number {
	const ctx = getMeasureCtx()
	if (!ctx) return row.height ?? DEFAULT_ROW_HEIGHT
	ctx.font = `${fontPx}px var(--tl-font-sans, sans-serif)`
	const lineHeight = Math.round(fontPx * 1.5)
	const heights = table.columns.map((col) =>
		wrappedHeight(ctx, cellDisplayText(col, row.cells[col.id] ?? ''), Math.max(20, col.width - 20), lineHeight)
	)
	return computeAutoFitRowHeight(heights, { min: DEFAULT_ROW_HEIGHT, max: 400 })
}

// ---------------------------------------------------------------------------------------------
// Context menu (right-click on a row/column handle or a cell) — a plain portal popup, not
// tldraw's Radix-based menu primitives, so it can open on contextmenu instead of only on click.
// ---------------------------------------------------------------------------------------------

type MenuTarget =
	| { kind: 'row'; index: number }
	| { kind: 'column'; index: number }
	| { kind: 'cell'; row: number; col: number }
	| { kind: 'table' }

function TablePopupMenu({
	x,
	y,
	onClose,
	children,
}: {
	x: number
	y: number
	onClose: () => void
	children: React.ReactNode
}) {
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const onDown = (e: PointerEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose()
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose()
		}
		window.addEventListener('pointerdown', onDown, true)
		window.addEventListener('keydown', onKey, true)
		return () => {
			window.removeEventListener('pointerdown', onDown, true)
			window.removeEventListener('keydown', onKey, true)
		}
	}, [onClose])
	const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
	const vh = typeof window !== 'undefined' ? window.innerHeight : 800
	const left = Math.min(x, vw - 220)
	const top = Math.min(y, vh - 40)
	return createPortal(
		<div ref={ref} className="TablePopupMenu" style={{ left, top }} onPointerDown={stop} onContextMenu={(e) => e.preventDefault()}>
			{children}
		</div>,
		document.body
	)
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
	return (
		<button type="button" className={classNames('TablePopupMenu-item', { danger })} onClick={onClick}>
			{label}
		</button>
	)
}

function MenuSeparator() {
	return <div className="TablePopupMenu-sep" />
}

// ---------------------------------------------------------------------------------------------
// The shape component
// ---------------------------------------------------------------------------------------------

interface ActiveCell {
	row: number
	col: number
}

function clampCell(table: TableData, cell: ActiveCell): ActiveCell {
	return {
		row: Math.max(0, Math.min(table.rows.length - 1, cell.row)),
		col: Math.max(0, Math.min(table.columns.length - 1, cell.col)),
	}
}

function TableShapeComponent({ shape }: { shape: TableShape }) {
	const editor = useEditor()
	const table = shape.props.table
	const fontPx = fontPxForSize(shape.props.size)
	const rowH = rowHeightForSize(shape.props.size)

	const isOnlySelected = useValue(
		'table only selected',
		() => editor.getOnlySelectedShape()?.id === shape.id,
		[editor, shape.id]
	)
	const isDarkMode = useValue('dark', () => editor.user.getIsDarkMode(), [editor])
	const resolveColor = useMemo(() => {
		const theme = editor.getCurrentTheme().colors[editor.getColorMode()]
		return (name: string, variant: 'solid' | 'semi' = 'solid') => getColorValue(theme, name, variant)
	}, [editor, isDarkMode])

	const rootRef = useRef<HTMLDivElement>(null)
	// Set right before any setEditing(false) that must NOT let the <input>'s resulting blur
	// commit its (stale/unwanted) draft — Esc, and losing the sole-selection out from under an
	// open edit. Consumed (and reset) by stopEdit.
	const cancellingRef = useRef(false)
	const [active, setActive] = useState<ActiveCell | null>(null)
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState('')
	const [selectDraftOnFocus, setSelectDraftOnFocus] = useState(true)
	const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null)
	const [colTypeMenu, setColTypeMenu] = useState<{ index: number; x: number; y: number } | null>(null)
	const [renamingCol, setRenamingCol] = useState<number | null>(null)
	const [statusPicker, setStatusPicker] = useState<ActiveCell | null>(null)

	// Live drag preview (column/row resize) before the single commit on pointerup.
	const [dragWidths, setDragWidths] = useState<number[] | null>(null)
	const [dragHeights, setDragHeights] = useState<number[] | null>(null)
	const dragRef = useRef<{
		type: 'col' | 'row'
		index: number
		startSize: number
		startPointer: number
	} | null>(null)

	const colWidths = dragWidths ?? table.columns.map((c) => c.width)
	const rowHeights = dragHeights ?? table.rows.map((r) => r.height ?? rowH)
	const totalWidthPx = ROW_GUTTER_PX + colWidths.reduce((a, b) => a + b, 0)
	const totalHeightPx = (table.headerRow ? rowH : 0) + rowHeights.reduce((a, b) => a + b, 0)

	// Focus the root when the table becomes the sole selection, so arrow keys / typing work
	// right after a click without needing a second click into a cell. A table just created from
	// a menu (context menu / main menu "Insert table") is selected while that menu is still
	// closing — Radix restores focus to whatever had it before the menu opened (e.g. another
	// table shape still mid-edit) right after this effect runs, stealing it back. One
	// requestAnimationFrame re-assertion, after that restore has had its turn, wins the race.
	useEffect(() => {
		if (isOnlySelected) {
			const el = rootRef.current
			el?.focus()
			setActive((a) => a ?? clampCell(table, { row: 0, col: 0 }))
			const raf = requestAnimationFrame(() => {
				if (document.activeElement !== el) el?.focus()
			})
			return () => cancelAnimationFrame(raf)
		} else {
			// Losing the sole selection mid-edit (e.g. a global Escape/selectNone, or clicking
			// another shape) must not let the about-to-unmount <input>'s blur commit its draft.
			cancellingRef.current = true
			setEditing(false)
			setActive(null)
			setMenu(null)
			// Never leave this table's root holding real DOM focus once it's no longer the sole
			// selection — otherwise a keystroke meant for a newly-selected shape can land here.
			if (document.activeElement === rootRef.current) rootRef.current?.blur()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isOnlySelected])

	const updateTable = useCallback(
		(next: TableData) => {
			// Without this, tldraw coalesces consecutive updateShape calls on the same shape into
			// one undo step — every discrete edit (a cell commit, a row/column op, a resize-drag's
			// final commit, a status pick…) needs its own stopping point so "every committed edit
			// is one undo step" (WP40) actually holds instead of merging unrelated edits together.
			editor.markHistoryStoppingPoint('table edit')
			editor.updateShape<TableShape>({ id: shape.id, type: TABLE_TYPE, props: { table: next } })
		},
		[editor, shape.id]
	)

	const commitCell = useCallback(
		(cell: ActiveCell, value: string) => {
			const col = table.columns[cell.col]
			const row = table.rows[cell.row]
			if (!col || !row) return
			if ((row.cells[col.id] ?? '') === value) return
			const rows = table.rows.slice()
			rows[cell.row] = { ...row, cells: { ...row.cells, [col.id]: value } }
			updateTable({ ...table, rows })
		},
		[table, updateTable]
	)

	const startEdit = useCallback(
		(cell: ActiveCell, initialDraft?: string) => {
			const col = table.columns[cell.col]
			if (!col) return
			if (col.type === 'checkbox') return // toggled directly, never "edited"
			setActive(cell)
			if (col.type === 'status') {
				setStatusPicker(cell)
				return
			}
			const row = table.rows[cell.row]
			// Opened by double-click/Enter (no initialDraft): keep the existing value and select
			// it all, so the next keystroke replaces it (standard spreadsheet behaviour). Opened
			// by typing a replacement character on a selected cell: the draft is already just
			// that one character — selecting it would make the *next* keystroke replace it too
			// and silently drop everything after the first character typed.
			setDraft(initialDraft ?? row?.cells[col.id] ?? '')
			setSelectDraftOnFocus(initialDraft === undefined)
			setEditing(true)
		},
		[table]
	)

	/** Esc: cancel directly (no commit), and flag it so the blur that follows (the about-to-
	 * unmount <input> loses focus) doesn't commit the stale draft on top. */
	const cancelEdit = useCallback(() => {
		cancellingRef.current = true
		setEditing(false)
		rootRef.current?.focus()
	}, [])

	// tldraw's own container listens for Escape (and other shortcuts) with a plain, bubble-phase
	// `container.addEventListener('keydown', ...)` on its OWN root element — an ancestor of this
	// shape's whole DOM subtree, but one React mounts even FURTHER up the real tree than that
	// (React delegates all synthetic events from its own root). So in real native bubble order,
	// tldraw's container handler always runs before this shape's React onKeyDown ever gets a
	// chance to call stopPropagation — Escape closed the cell edit via tldraw's own path (a plain
	// blur/selection change), never through cancelEdit, and committed the stale draft instead of
	// cancelling it. A native listener on this shape's own root fires first in that same bubble
	// pass (it's the nearer ancestor of the real event target), so it can get there first.
	useEffect(() => {
		const root = rootRef.current
		if (!root) return
		const onNativeKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && editing) {
				e.stopPropagation()
				cancelEdit()
			}
		}
		root.addEventListener('keydown', onNativeKeyDown)
		return () => root.removeEventListener('keydown', onNativeKeyDown)
	}, [editing, cancelEdit])

	const stopEdit = useCallback(
		(commit: boolean) => {
			if (cancellingRef.current) {
				cancellingRef.current = false
				return
			}
			if (editing && active && commit) commitCell(active, draft)
			setEditing(false)
			rootRef.current?.focus()
		},
		[editing, active, draft, commitCell]
	)

	const moveActive = useCallback(
		(delta: { row?: number; col?: number }) => {
			setActive((a) => {
				const base = a ?? { row: 0, col: 0 }
				return clampCell(table, { row: base.row + (delta.row ?? 0), col: base.col + (delta.col ?? 0) })
			})
		},
		[table]
	)

	/** Enter / Tab while editing: commit the draft, exit editing, and move — one undo step
	 * (the commit), then an ordinary selection change (not a history event). */
	const commitAndMove = useCallback(
		(delta: { row?: number; col?: number }) => {
			if (active) commitCell(active, draft)
			setEditing(false)
			setActive((a) => {
				const base = a ?? { row: 0, col: 0 }
				return clampCell(table, { row: base.row + (delta.row ?? 0), col: base.col + (delta.col ?? 0) })
			})
			rootRef.current?.focus()
		},
		[active, draft, commitCell, table]
	)

	const onRootKeyDown = (e: React.KeyboardEvent) => {
		if (editing || statusPicker) return
		if (!active) return
		const mod = e.ctrlKey || e.metaKey
		if (e.key === 'ArrowUp') {
			e.preventDefault()
			e.stopPropagation()
			moveActive({ row: -1 })
		} else if (e.key === 'ArrowDown') {
			e.preventDefault()
			e.stopPropagation()
			moveActive({ row: 1 })
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault()
			e.stopPropagation()
			moveActive({ col: -1 })
		} else if (e.key === 'ArrowRight') {
			e.preventDefault()
			e.stopPropagation()
			moveActive({ col: 1 })
		} else if (e.key === 'Tab') {
			e.preventDefault()
			e.stopPropagation()
			moveActive({ col: e.shiftKey ? -1 : 1 })
		} else if (e.key === 'Enter' && mod) {
			e.preventDefault()
			e.stopPropagation()
			updateTable(insertRow(table, active.row, 'below'))
		} else if (e.key === 'Enter') {
			e.preventDefault()
			e.stopPropagation()
			startEdit(active)
		} else if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault()
			e.stopPropagation()
			commitCell(active, '')
		} else if (e.key.length === 1 && !mod && !e.altKey) {
			e.preventDefault()
			e.stopPropagation()
			startEdit(active, e.key)
		}
	}

	// Column/row resize drag --------------------------------------------------------------
	// Mutating a ref doesn't re-run a useEffect (its dependency array is only read at render
	// time), so the window pointermove/pointerup listeners that used to live in a
	// `useEffect(..., [dragRef.current])` never actually attached — the first drag always had
	// zero effect. Attach them imperatively, right when the drag starts, instead.
	const beginColResize = (index: number, e: React.PointerEvent) => {
		stop(e)
		e.preventDefault()
		const d = { type: 'col' as const, index, startSize: table.columns[index].width, startPointer: e.clientX }
		dragRef.current = d
		// A plain variable (not a setState updater callback) holding the latest preview value —
		// `onUp` reads it directly as an ordinary statement. Calling `updateTable` (an
		// `editor.updateShape`, which synchronously fans out to other components' tldraw/signia
		// subscriptions, e.g. PipelineRegions) from INSIDE a setState updater function previously
		// ran it during React's render phase for this update, which is exactly what triggered
		// "Cannot update a component while rendering a different component".
		let latest = table.columns.map((c) => c.width)
		setDragWidths(latest)

		const onMove = (ev: PointerEvent) => {
			const delta = ev.clientX - d.startPointer
			const scale = editor.getZoomLevel()
			const w = Math.max(MIN_COLUMN_WIDTH, Math.round(d.startSize + delta / scale))
			latest = table.columns.map((c, i) => (i === d.index ? w : c.width))
			setDragWidths(latest)
		}
		const onUp = () => {
			dragRef.current = null
			window.removeEventListener('pointermove', onMove)
			const columns = table.columns.map((c, i) => ({ ...c, width: latest[i] }))
			setDragWidths(null)
			updateTable({ ...table, columns })
		}
		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', onUp, { once: true })
	}

	const beginRowResize = (index: number, e: React.PointerEvent) => {
		stop(e)
		e.preventDefault()
		const d = { type: 'row' as const, index, startSize: table.rows[index].height ?? rowH, startPointer: e.clientY }
		dragRef.current = d
		let latest = table.rows.map((r) => r.height ?? rowH)
		setDragHeights(latest)

		const onMove = (ev: PointerEvent) => {
			const delta = ev.clientY - d.startPointer
			const scale = editor.getZoomLevel()
			const h = Math.max(MIN_ROW_HEIGHT, Math.round(d.startSize + delta / scale))
			latest = table.rows.map((r, i) => (i === d.index ? h : r.height ?? rowH))
			setDragHeights(latest)
		}
		const onUp = () => {
			dragRef.current = null
			window.removeEventListener('pointermove', onMove)
			const rows = table.rows.map((r, i) => ({ ...r, height: latest[i] }))
			setDragHeights(null)
			updateTable({ ...table, rows })
		}
		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', onUp, { once: true })
	}
	const autoFitColumn = (index: number, e: React.MouseEvent) => {
		stop(e)
		const col = table.columns[index]
		const width = measureColumnAutoFitWidth(table, col, fontPx)
		const columns = table.columns.slice()
		columns[index] = { ...col, width }
		updateTable({ ...table, columns })
	}
	const autoFitRow = (index: number, e: React.MouseEvent) => {
		stop(e)
		const row = table.rows[index]
		const height = measureRowAutoFitHeight(table, row, fontPx)
		const rows = table.rows.slice()
		rows[index] = { ...row, height }
		updateTable({ ...table, rows })
	}

	// Paste ---------------------------------------------------------------------------------
	const onPaste = (e: React.ClipboardEvent) => {
		if (editing) return
		const text = e.clipboardData.getData('text/plain')
		if (!text) return
		e.preventDefault()
		e.stopPropagation()
		const grid = parseRawGrid(text)
		const at = active ?? { row: 0, col: 0 }
		editor.markHistoryStoppingPoint('paste into table')
		updateTable(pasteIntoTable(table, at.row, at.col, grid))
	}
	const onCopy = (e: React.ClipboardEvent) => {
		if (editing || !active) return
		const col = table.columns[active.col]
		const row = table.rows[active.row]
		if (!col || !row) return
		e.preventDefault()
		e.clipboardData.setData('text/plain', cellDisplayText(col, row.cells[col.id] ?? ''))
	}

	const openMenu = (target: MenuTarget, e: React.MouseEvent) => {
		e.preventDefault()
		stop(e)
		setMenu({ x: e.clientX, y: e.clientY, target })
	}

	const rowReorderRef = useRef<{ from: number } | null>(null)
	const colReorderRef = useRef<{ from: number } | null>(null)

	const over500 = table.rows.length > TABLE_SOFT_ROW_LIMIT

	return (
		<HTMLContainer
			className={classNames('TableShape', `TableShape_${shape.props.size ?? 'm'}`, {
				TableShape_selected: isOnlySelected,
				TableShape_editing: editing,
			})}
			style={
				{
					'--tbl-font': `${fontPx}px`,
					'--tbl-accent': shape.props.color
						? getColorValue(editor.getCurrentTheme().colors[editor.getColorMode()], shape.props.color, 'solid')
						: undefined,
				} as React.CSSProperties
			}
			onPointerDownCapture={(event) => {
				// This shape's own content has `pointer-events: all` (so clicks/drags/typing work
				// inside it), which stops a plain click from ever reaching tldraw's own
				// click-to-select handling the way it would for a shape that lets pointer events
				// pass through to the canvas underneath. Select explicitly instead — the same fix
				// NodeShapeComponent uses for the same reason (see its onPointerDownCapture).
				if (editor.getOnlySelectedShape()?.id !== shape.id) editor.select(shape.id)
				// tldraw opens its own (canvas-wide) context menu from the right-click pointerdown
				// itself, via its input pipeline — not from the DOM 'contextmenu' event, so
				// preventDefault/stopPropagation on the contextmenu handler below never reached it.
				// Stopping the native pointerdown here (button 2) keeps that gesture from reaching
				// tldraw at all, so this shape's own right-click menu (TablePopupMenu) is the only
				// one that opens.
				if (event.button === 2) event.stopPropagation()
			}}
		>
			<div
				ref={rootRef}
				className="TableShape-root"
				tabIndex={isOnlySelected ? 0 : -1}
				onKeyDown={onRootKeyDown}
				onPaste={onPaste}
				onCopy={onCopy}
				onContextMenu={(e) => openMenu({ kind: 'table' }, e)}
				style={{
					gridTemplateColumns: `${ROW_GUTTER_PX}px ${colWidths.map((w) => `${w}px`).join(' ')}`,
					gridTemplateRows: `${table.headerRow ? rowH : 0}px ${rowHeights.map((h) => `${h}px`).join(' ')}`,
				}}
			>
				{/* corner */}
				<div className="TableShape-corner" style={{ gridColumn: 1, gridRow: 1 }} />
				{/* column headers */}
				{table.headerRow &&
					table.columns.map((col, ci) => (
						<div
							key={col.id}
							className="TableShape-colHeader"
							style={{ gridColumn: ci + 2, gridRow: 1 }}
							draggable
							onDragStart={() => (colReorderRef.current = { from: ci })}
							onDragOver={(e) => e.preventDefault()}
							onDrop={(e) => {
								e.preventDefault()
								const from = colReorderRef.current?.from
								colReorderRef.current = null
								if (from == null || from === ci) return
								updateTable(reorderColumn(table, from, ci))
							}}
							onContextMenu={(e) => openMenu({ kind: 'column', index: ci }, e)}
						>
							{renamingCol === ci ? (
								<input
									autoFocus
									className="TableShape-colNameInput"
									defaultValue={col.name}
									onPointerDown={stop}
									onKeyDown={(e) => {
										stop(e)
										if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
										if (e.key === 'Escape') setRenamingCol(null)
									}}
									onBlur={(e) => {
										const name = e.target.value.trim() || col.name
										const columns = table.columns.slice()
										columns[ci] = { ...col, name }
										updateTable({ ...table, columns })
										setRenamingCol(null)
									}}
								/>
							) : (
								<span
									className="TableShape-colName"
									title="Double-click to rename"
									onDoubleClick={(e) => {
										stop(e)
										setRenamingCol(ci)
									}}
								>
									{col.name}
								</span>
							)}
							<button
								type="button"
								className="TableShape-colMenuBtn"
								onPointerDown={stop}
								onClick={(e) => {
									stop(e)
									setColTypeMenu({ index: ci, x: e.clientX, y: e.clientY })
								}}
							>
								<IconChevronDown size={11} />
							</button>
							{colTypeMenu?.index === ci && (
								<ColumnMenu
									col={col}
									x={colTypeMenu.x}
									y={colTypeMenu.y}
									onClose={() => setColTypeMenu(null)}
									onSort={(dir) => updateTable(sortByColumn(table, ci, dir))}
									onType={(t) => updateTable(setColumnType(table, ci, t))}
									onAlign={(a) => {
										const columns = table.columns.slice()
										columns[ci] = { ...col, align: a }
										updateTable({ ...table, columns })
									}}
								/>
							)}
						</div>
					))}
				{/* row gutter + cells */}
				{table.rows.map((row, ri) => (
					<RowGutter
						key={`g-${row.id}`}
						index={ri}
						headerOffset={table.headerRow}
						showNumbers={!!table.rowNumbers}
						onContextMenu={(e) => openMenu({ kind: 'row', index: ri }, e)}
						onDragStart={() => (rowReorderRef.current = { from: ri })}
						onDrop={() => {
							const from = rowReorderRef.current?.from
							rowReorderRef.current = null
							if (from == null || from === ri) return
							updateTable(reorderRow(table, from, ri))
						}}
					/>
				))}
				{table.rows.map((row, ri) =>
					table.columns.map((col, ci) => {
						const isActive = active?.row === ri && active?.col === ci
						const isEditingThis = isActive && editing
						return (
							<TableCell
								key={`${row.id}:${col.id}`}
								col={col}
								row={row}
								value={row.cells[col.id] ?? ''}
								gridColumn={ci + 2}
								gridRow={(table.headerRow ? 2 : 1) + ri}
								active={isActive}
								editing={isEditingThis}
								draft={isEditingThis ? draft : ''}
								onDraftChange={setDraft}
								onSelect={() => {
									setActive({ row: ri, col: ci })
									rootRef.current?.focus()
								}}
								onStartEdit={() => startEdit({ row: ri, col: ci })}
								onToggleCheckbox={() => commitCell({ row: ri, col: ci }, row.cells[col.id] === 'true' ? '' : 'true')}
								onCommitEnter={() => commitAndMove({ row: 1 })}
								onCommitTab={(shiftKey) => commitAndMove({ col: shiftKey ? -1 : 1 })}
								onCancel={cancelEdit}
								onBlurCommit={() => stopEdit(true)}
								onContextMenu={(e) => openMenu({ kind: 'cell', row: ri, col: ci }, e)}
								isDark={isDarkMode}
								resolveColor={resolveColor}
								selectDraftOnFocus={selectDraftOnFocus}
							/>
						)
					})
				)}
				{statusPicker && (
					<StatusPicker
						column={table.columns[statusPicker.col]}
						current={table.rows[statusPicker.row]?.cells[table.columns[statusPicker.col].id] ?? ''}
						gridColumn={statusPicker.col + 2}
						gridRow={(table.headerRow ? 2 : 1) + statusPicker.row}
						onPick={(id) => {
							commitCell(statusPicker, id)
							setStatusPicker(null)
							rootRef.current?.focus()
						}}
						onAddOption={(label) => {
							const col = table.columns[statusPicker.col]
							const opt: TableStatusOption = { id: nextTableId('opt'), label, color: 'blue' }
							const columns = table.columns.slice()
							columns[statusPicker.col] = { ...col, options: [...(col.options ?? []), opt] }
							const rows = table.rows.slice()
							const row = rows[statusPicker.row]
							rows[statusPicker.row] = { ...row, cells: { ...row.cells, [col.id]: opt.id } }
							updateTable({ ...table, columns, rows })
							setStatusPicker(null)
							rootRef.current?.focus()
						}}
						onClose={() => {
							setStatusPicker(null)
							rootRef.current?.focus()
						}}
						resolveColor={resolveColor}
					/>
				)}
				{/* Resize-handle overlay: rendered last (and absolutely positioned, not nested in a
				    header/gutter cell) so it always paints above every data cell — a handle nested
				    inside the header row and merely stretched tall with CSS overflowed its own
				    parent and lost the hit-test to later-painted body cells covering the same
				    pixels (equal/auto stacking context, later DOM wins). */}
				{table.columns.map((col, ci) => {
					const left = ROW_GUTTER_PX + colWidths.slice(0, ci + 1).reduce((a, b) => a + b, 0)
					return (
						<div
							key={`cr-${col.id}`}
							className="TableShape-colResize"
							style={{ left: left - 3, height: totalHeightPx }}
							onPointerDown={(e) => beginColResize(ci, e)}
							onDoubleClick={(e) => autoFitColumn(ci, e)}
						/>
					)
				})}
				{table.rows.map((row, ri) => {
					const top = (table.headerRow ? rowH : 0) + rowHeights.slice(0, ri + 1).reduce((a, b) => a + b, 0)
					return (
						<div
							key={`rr-${row.id}`}
							className="TableShape-rowResize"
							style={{ top: top - 3, width: totalWidthPx }}
							onPointerDown={(e) => beginRowResize(ri, e)}
							onDoubleClick={(e) => autoFitRow(ri, e)}
						/>
					)
				})}
			</div>
			{/* hover "+" handles */}
			<button
				type="button"
				className="TableShape-addRow"
				title="Add row"
				onPointerDown={stop}
				onClick={() => updateTable(insertRow(table, table.rows.length - 1, 'below'))}
			>
				+
			</button>
			<button
				type="button"
				className="TableShape-addCol"
				title="Add column"
				onPointerDown={stop}
				onClick={() => updateTable(insertColumn(table, table.columns.length - 1, 'right'))}
			>
				+
			</button>
			{over500 && (
				<div className="TableShape-bigHint">
					{table.rows.length} rows — for large data, use DataPipe / Table view instead.
				</div>
			)}
			{menu && (
				<TableContextMenu
					target={menu.target}
					x={menu.x}
					y={menu.y}
					table={table}
					onClose={() => setMenu(null)}
					onUpdate={updateTable}
				/>
			)}
		</HTMLContainer>
	)
}

function RowGutter({
	index,
	headerOffset,
	showNumbers,
	onContextMenu,
	onDragStart,
	onDrop,
}: {
	index: number
	headerOffset: boolean
	/** Permanent (table-menu "Show row numbers" on) vs. hover-only (default — see table.css's
	 * `.TableShape-rowGutter:hover .TableShape-rowNum`, avoiding a redundant "1 1 / 2 2…" next to
	 * a table that already has its own "#" column, e.g. the Issue list template). */
	showNumbers: boolean
	onContextMenu: (e: React.MouseEvent) => void
	onDragStart: () => void
	onDrop: () => void
}) {
	return (
		<div
			className={classNames('TableShape-rowGutter', { 'TableShape-rowGutter_numbered': showNumbers })}
			style={{ gridColumn: 1, gridRow: (headerOffset ? 2 : 1) + index }}
			draggable
			onDragStart={onDragStart}
			onDragOver={(e) => e.preventDefault()}
			onDrop={(e) => {
				e.preventDefault()
				onDrop()
			}}
			onContextMenu={onContextMenu}
		>
			<span className="TableShape-rowNum">{index + 1}</span>
		</div>
	)
}

function ColumnMenu({
	col,
	x,
	y,
	onClose,
	onSort,
	onType,
	onAlign,
}: {
	col: TableColumn
	x: number
	y: number
	onClose: () => void
	onSort: (dir: 'asc' | 'desc') => void
	onType: (t: TableColumnType) => void
	onAlign: (a: 'left' | 'center' | 'right') => void
}) {
	const TYPES: TableColumnType[] = ['text', 'number', 'status', 'checkbox', 'date', 'link', 'person']
	return (
		<TablePopupMenu x={x} y={y} onClose={onClose}>
			<MenuItem label="Sort ascending" onClick={() => (onSort('asc'), onClose())} />
			<MenuItem label="Sort descending" onClick={() => (onSort('desc'), onClose())} />
			<MenuSeparator />
			<div className="TablePopupMenu-label">Type</div>
			{TYPES.map((t) => (
				<MenuItem key={t} label={t + (col.type === t ? ' ✓' : '')} onClick={() => (onType(t), onClose())} />
			))}
			<MenuSeparator />
			<div className="TablePopupMenu-label">Align</div>
			{(['left', 'center', 'right'] as const).map((a) => (
				<MenuItem key={a} label={a} onClick={() => (onAlign(a), onClose())} />
			))}
		</TablePopupMenu>
	)
}

// --- Cell rendering ----------------------------------------------------------------------

function TableCell({
	col,
	row,
	value,
	gridColumn,
	gridRow,
	active,
	editing,
	draft,
	onDraftChange,
	onSelect,
	onStartEdit,
	onToggleCheckbox,
	onCommitEnter,
	onCommitTab,
	onCancel,
	onBlurCommit,
	onContextMenu,
	isDark,
	resolveColor,
	selectDraftOnFocus,
}: {
	col: TableColumn
	row: TableRow
	value: string
	gridColumn: number
	gridRow: number
	active: boolean
	editing: boolean
	draft: string
	onDraftChange: (v: string) => void
	onSelect: () => void
	onStartEdit: () => void
	onToggleCheckbox: () => void
	/** Enter: commit the draft, exit editing, move the active cell down one row. */
	onCommitEnter: () => void
	/** Tab / Shift+Tab: commit the draft, exit editing, move the active cell right/left. */
	onCommitTab: (shiftKey: boolean) => void
	onCancel: () => void
	onBlurCommit: () => void
	onContextMenu: (e: React.MouseEvent) => void
	isDark: boolean
	resolveColor: (name: string, variant?: 'solid' | 'semi') => string
	/** true: select the whole draft (opened via dblclick/Enter on existing text). false: put the
	 * caret at the end (opened by typing a replacement character — see startEdit). */
	selectDraftOnFocus: boolean
}) {
	const inputRef = useRef<HTMLInputElement>(null)
	useEffect(() => {
		if (editing) {
			const el = inputRef.current
			el?.focus()
			if (selectDraftOnFocus) el?.select()
			else el?.setSelectionRange(el.value.length, el.value.length)
		}
		// Only re-run when editing starts, not on every draft keystroke.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editing])

	const align = col.align ?? (col.type === 'number' ? 'right' : col.type === 'checkbox' ? 'center' : 'left')
	const option = col.type === 'status' ? col.options?.find((o) => o.id === value) : undefined

	const onKeyDown = (e: React.KeyboardEvent) => {
		e.stopPropagation()
		if (e.key === 'Escape') onCancel()
		else if (e.key === 'Enter') {
			e.preventDefault()
			onCommitEnter()
		} else if (e.key === 'Tab') {
			e.preventDefault()
			onCommitTab(e.shiftKey)
		}
	}

	let body: React.ReactNode
	if (editing) {
		body = (
			<input
				ref={inputRef}
				className="TableShape-cellInput"
				type={col.type === 'number' ? 'text' : col.type === 'date' ? 'date' : 'text'}
				value={draft}
				onChange={(e) => onDraftChange(e.target.value)}
				onKeyDown={onKeyDown}
				onPointerDown={stop}
				onBlur={onBlurCommit}
			/>
		)
	} else if (col.type === 'checkbox') {
		body = (
			<button
				type="button"
				className={classNames('TableShape-checkbox', { checked: value === 'true' })}
				onPointerDown={stop}
				onClick={onToggleCheckbox}
				aria-label={value === 'true' ? 'Done' : 'Not done'}
			>
				{value === 'true' && <IconCheck size={13} />}
			</button>
		)
	} else if (col.type === 'status') {
		body = option ? (
			(() => {
				const bg = resolveColor(option.color, 'solid')
				return (
					<span className="TableShape-pill" style={{ background: bg, color: pillTextColor(bg) }}>
						{option.label}
					</span>
				)
			})()
		) : (
			<span className="TableShape-placeholder" />
		)
	} else if (col.type === 'link') {
		let host = ''
		try {
			host = value ? new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).host : ''
		} catch {
			host = value
		}
		body = value ? (
			<span className="TableShape-link">
				<span className="TableShape-linkHost">{host}</span>
				<button
					type="button"
					className="TableShape-linkOpen"
					title="Open link"
					onPointerDown={stop}
					onClick={(e) => {
						stop(e)
						window.open(/^https?:\/\//i.test(value) ? value : `https://${value}`, '_blank', 'noreferrer')
					}}
				>
					↗
				</button>
			</span>
		) : (
			<span className="TableShape-placeholder" />
		)
	} else if (col.type === 'person') {
		const initials = value
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase())
			.join('')
		body = value ? (
			<span className="TableShape-person">
				<span className="TableShape-avatar" aria-hidden>
					{initials}
				</span>
				<span className="TableShape-personName">{value}</span>
			</span>
		) : (
			<span className="TableShape-placeholder" />
		)
	} else {
		body = <span className="TableShape-text">{value}</span>
	}

	return (
		<div
			className={classNames('TableShape-cell', `TableShape-cell_${col.type}`, `TableShape-align_${align}`, {
				active,
				editing,
			})}
			style={{ gridColumn, gridRow, background: row.color ? resolveColor(row.color, 'semi') : undefined }}
			data-dark={isDark || undefined}
			onClick={(e) => {
				if (e.metaKey || e.ctrlKey) {
					if (col.type === 'link' && value) {
						window.open(/^https?:\/\//i.test(value) ? value : `https://${value}`, '_blank', 'noreferrer')
						return
					}
				}
				onSelect()
			}}
			onDoubleClick={(e) => {
				stop(e)
				onStartEdit()
			}}
			onContextMenu={onContextMenu}
		>
			{body}
		</div>
	)
}

function StatusPicker({
	column,
	current,
	gridColumn,
	gridRow,
	onPick,
	onAddOption,
	onClose,
	resolveColor,
}: {
	column: TableColumn
	current: string
	gridColumn: number
	gridRow: number
	onPick: (id: string) => void
	onAddOption: (label: string) => void
	onClose: () => void
	resolveColor: (name: string, variant?: 'solid' | 'semi') => string
}) {
	const [draft, setDraft] = useState('')
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const onDown = (e: PointerEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose()
		}
		window.addEventListener('pointerdown', onDown, true)
		return () => window.removeEventListener('pointerdown', onDown, true)
	}, [onClose])
	return (
		<div ref={ref} className="TableShape-statusPicker" style={{ gridColumn, gridRow }} onPointerDown={stop}>
			{(column.options ?? []).map((o) => (
				<button
					key={o.id}
					type="button"
					className={classNames('TablePopupMenu-item', 'TableShape-statusOption', { picked: o.id === current })}
					onClick={() => onPick(o.id)}
				>
					<span className="TableShape-pill" style={{ background: resolveColor(o.color, 'solid'), color: pillTextColor(resolveColor(o.color, 'solid')) }}>
						{o.label}
					</span>
				</button>
			))}
			<div className="TableShape-statusAdd">
				<input
					placeholder="Add option…"
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && draft.trim()) onAddOption(draft.trim())
						if (e.key === 'Escape') onClose()
					}}
				/>
			</div>
		</div>
	)
}

// --- Row/column/cell/table context menu ------------------------------------------------

function TableContextMenu({
	target,
	x,
	y,
	table,
	onClose,
	onUpdate,
}: {
	target: MenuTarget
	x: number
	y: number
	table: TableData
	onClose: () => void
	onUpdate: (t: TableData) => void
}) {
	const update = (t: TableData) => {
		onUpdate(t)
		onClose()
	}
	return (
		<TablePopupMenu x={x} y={y} onClose={onClose}>
			{target.kind === 'row' && (
				<>
					<MenuItem label="Insert row above" onClick={() => update(insertRow(table, target.index, 'above'))} />
					<MenuItem label="Insert row below" onClick={() => update(insertRow(table, target.index, 'below'))} />
					<MenuItem label="Duplicate row" onClick={() => update(duplicateRow(table, target.index))} />
					<MenuSeparator />
					<MenuItem label="Delete row" danger onClick={() => update(deleteRow(table, target.index))} />
				</>
			)}
			{target.kind === 'column' && (
				<>
					<MenuItem label="Insert column left" onClick={() => update(insertColumn(table, target.index, 'left'))} />
					<MenuItem label="Insert column right" onClick={() => update(insertColumn(table, target.index, 'right'))} />
					<MenuSeparator />
					<MenuItem label="Delete column" danger onClick={() => update(deleteColumn(table, target.index))} />
				</>
			)}
			{target.kind === 'cell' && (
				<>
					<MenuItem label="Insert row above" onClick={() => update(insertRow(table, target.row, 'above'))} />
					<MenuItem label="Insert row below" onClick={() => update(insertRow(table, target.row, 'below'))} />
					<MenuItem label="Insert column left" onClick={() => update(insertColumn(table, target.col, 'left'))} />
					<MenuItem label="Insert column right" onClick={() => update(insertColumn(table, target.col, 'right'))} />
					<MenuSeparator />
					<MenuItem label="Duplicate row" onClick={() => update(duplicateRow(table, target.row))} />
					<MenuItem
						label="Row colour…"
						onClick={() => {
							const rows = table.rows.slice()
							const current = rows[target.row]
							const palette = ['grey', 'blue', 'yellow', 'green', 'red', undefined]
							const idx = palette.indexOf(current.color as any)
							rows[target.row] = { ...current, color: palette[(idx + 1) % palette.length] }
							update({ ...table, rows })
						}}
					/>
					<MenuSeparator />
					<MenuItem label="Delete row" danger onClick={() => update(deleteRow(table, target.row))} />
					<MenuItem label="Delete column" danger onClick={() => update(deleteColumn(table, target.col))} />
				</>
			)}
			{target.kind === 'table' && (
				<>
					<MenuItem label={table.headerRow ? 'Hide header row' : 'Show header row'} onClick={() => update({ ...table, headerRow: !table.headerRow })} />
					<MenuItem
						label={table.rowNumbers ? 'Hide row numbers' : 'Show row numbers'}
						onClick={() => update({ ...table, rowNumbers: !table.rowNumbers })}
					/>
					<MenuSeparator />
					<MenuItem label="Copy as CSV" onClick={() => (navigator.clipboard.writeText(toCSV(table)), onClose())} />
					<MenuItem label="Copy as Markdown" onClick={() => (navigator.clipboard.writeText(toMarkdown(table)), onClose())} />
				</>
			)}
		</TablePopupMenu>
	)
}
