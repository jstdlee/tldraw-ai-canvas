/**
 * WP40: pure logic for the canvas-native `table` shape (presentation / small-list tables, not
 * DataPipe). No tldraw import, no DOM — testable in Node. The shape util
 * (client/pipeline/table/TableShapeUtil.tsx) is the only caller that touches the editor; this
 * file is the part that's worth unit-testing on its own (parsing, autofit math, sort, migration
 * defaults).
 */

export type TableColumnType = 'text' | 'number' | 'status' | 'checkbox' | 'date' | 'link' | 'person'

export interface TableStatusOption {
	id: string
	label: string
	/** One of STATUS_COLOR_NAMES (client CSS maps each to a swatch, light + dark). */
	color: string
}

export interface TableColumn {
	id: string
	name: string
	width: number
	type: TableColumnType
	align?: 'left' | 'center' | 'right'
	/** status columns only. */
	options?: TableStatusOption[]
}

export interface TableRow {
	id: string
	height?: number
	/** A tldraw colour name, or undefined for no tint. */
	color?: string
	cells: Record<string, string>
}

export interface TableData {
	columns: TableColumn[]
	rows: TableRow[]
	headerRow: boolean
	/** Permanent row-number labels in the gutter. Off by default (the gutter handle still shows a
	 * number on hover, for drag/select/right-click) — mainly useful for a table whose own "#"
	 * column isn't a plain 1-based row index (sorted, or numbering something else). */
	rowNumbers?: boolean
}

export const DEFAULT_COLUMN_WIDTH = 140
export const MIN_COLUMN_WIDTH = 44
export const MAX_COLUMN_WIDTH = 640
export const DEFAULT_ROW_HEIGHT = 32
export const MIN_ROW_HEIGHT = 22
export const MAX_ROW_HEIGHT = 400
export const HEADER_ROW_HEIGHT = 32

export const STATUS_COLOR_NAMES = ['grey', 'blue', 'yellow', 'green', 'violet', 'red', 'orange'] as const

/** Rows above this get a "use DataPipe / Table view instead" hint (WP40 Performance). */
export const TABLE_SOFT_ROW_LIMIT = 500

let idSeq = 0
/** Deterministic-enough unique id, overridable in tests via `seed` for reproducible fixtures. */
export function nextTableId(prefix: string, seed?: number): string {
	idSeq += 1
	return `${prefix}${seed ?? idSeq}_${Math.random().toString(36).slice(2, 7)}`
}

export function makeColumn(partial: Partial<TableColumn> & { name: string }): TableColumn {
	return {
		id: partial.id ?? nextTableId('col'),
		name: partial.name,
		width: partial.width ?? DEFAULT_COLUMN_WIDTH,
		type: partial.type ?? 'text',
		align: partial.align,
		options: partial.options,
	}
}

export function makeRow(columns: TableColumn[], partial?: Partial<TableRow>): TableRow {
	const cells: Record<string, string> = {}
	for (const col of columns) cells[col.id] = partial?.cells?.[col.id] ?? ''
	return {
		id: partial?.id ?? nextTableId('row'),
		height: partial?.height,
		color: partial?.color,
		cells,
	}
}

export function createEmptyTable(numCols: number, numRows: number): TableData {
	const columns = Array.from({ length: Math.max(1, numCols) }, (_, i) =>
		makeColumn({ name: i === 0 ? 'Column' : `Column ${i + 1}` })
	)
	const rows = Array.from({ length: Math.max(1, numRows) }, () => makeRow(columns))
	return { columns, rows, headerRow: true }
}

export const DEFAULT_STATUS_OPTIONS: TableStatusOption[] = [
	{ id: 'open', label: 'Open', color: 'blue' },
	{ id: 'in_progress', label: 'In progress', color: 'yellow' },
	{ id: 'review', label: 'Review', color: 'violet' },
	{ id: 'done', label: 'Done', color: 'green' },
]

// --- Templates (WP40 Insert) -------------------------------------------------------------

export type TableTemplateId = 'issue-list' | 'pr-list' | 'checklist' | 'comparison'

export const TABLE_TEMPLATE_LABELS: Record<TableTemplateId, string> = {
	'issue-list': 'Issue list',
	'pr-list': 'PR list',
	checklist: 'Checklist',
	comparison: 'Comparison',
}

function templateTable(columns: TableColumn[], rowCount: number): TableData {
	const rows = Array.from({ length: rowCount }, () => makeRow(columns))
	return { columns, rows, headerRow: true }
}

export function buildTableTemplate(id: TableTemplateId): TableData {
	switch (id) {
		case 'issue-list':
			return templateTable(
				[
					makeColumn({ name: '#', type: 'number', width: 56, align: 'right' }),
					makeColumn({ name: 'Title', type: 'text', width: 260 }),
					makeColumn({ name: 'Status', type: 'status', width: 130, options: DEFAULT_STATUS_OPTIONS }),
					makeColumn({ name: 'Owner', type: 'person', width: 130 }),
					makeColumn({
						name: 'Priority',
						type: 'status',
						width: 110,
						options: [
							{ id: 'low', label: 'Low', color: 'grey' },
							{ id: 'medium', label: 'Medium', color: 'blue' },
							{ id: 'high', label: 'High', color: 'orange' },
							{ id: 'urgent', label: 'Urgent', color: 'red' },
						],
					}),
					makeColumn({ name: 'Due', type: 'date', width: 120 }),
				],
				4
			)
		case 'pr-list':
			return templateTable(
				[
					makeColumn({ name: 'PR', type: 'number', width: 64, align: 'right' }),
					makeColumn({ name: 'Title', type: 'text', width: 260 }),
					makeColumn({ name: 'Author', type: 'person', width: 130 }),
					makeColumn({
						name: 'Status',
						type: 'status',
						width: 130,
						options: [
							{ id: 'draft', label: 'Draft', color: 'grey' },
							{ id: 'open', label: 'Open', color: 'blue' },
							{ id: 'approved', label: 'Approved', color: 'green' },
							{ id: 'merged', label: 'Merged', color: 'violet' },
						],
					}),
					makeColumn({ name: 'Reviewer', type: 'person', width: 130 }),
					makeColumn({ name: 'Link', type: 'link', width: 140 }),
				],
				4
			)
		case 'checklist':
			return templateTable(
				[
					makeColumn({ name: 'Done', type: 'checkbox', width: 64, align: 'center' }),
					makeColumn({ name: 'Item', type: 'text', width: 280 }),
					makeColumn({ name: 'Owner', type: 'person', width: 130 }),
					makeColumn({ name: 'Notes', type: 'text', width: 220 }),
				],
				5
			)
		case 'comparison':
			return templateTable(
				[
					makeColumn({ name: 'Feature', type: 'text', width: 200 }),
					makeColumn({ name: 'A', type: 'text', width: 160, align: 'center' }),
					makeColumn({ name: 'B', type: 'text', width: 160, align: 'center' }),
					makeColumn({ name: 'C', type: 'text', width: 160, align: 'center' }),
				],
				4
			)
	}
}

// --- Parsing a raw paste into a grid of strings -----------------------------------------

/** Splits one delimited line, honouring double-quoted fields (RFC4180-ish), same rules
 * shared/tableOps.ts's parseDelimited uses, kept local so this module has no runtime import
 * into the DataPipe table stack. */
function splitDelimitedLine(line: string, sep: string): string[] {
	const out: string[] = []
	let cur = ''
	let inQuotes = false
	for (let i = 0; i < line.length; i++) {
		const ch = line[i]
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') {
					cur += '"'
					i++
				} else {
					inQuotes = false
				}
			} else {
				cur += ch
			}
		} else if (ch === '"') {
			inQuotes = true
		} else if (ch === sep) {
			out.push(cur)
			cur = ''
		} else {
			cur += ch
		}
	}
	out.push(cur)
	return out
}

function isMarkdownSeparatorRow(cells: string[]): boolean {
	return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.trim()))
}

/**
 * Parses clipboard text into a raw grid of string cells, no header semantics (the caller decides
 * where it lands). Detects TSV (a tab anywhere in the first line), a Markdown pipe table (first
 * non-blank line starts with `|`), else CSV.
 */
export function parseRawGrid(text: string): string[][] {
	const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
	const lines = raw.split('\n').filter((l, i, arr) => !(l === '' && (i === 0 || i === arr.length - 1)))
	if (lines.length === 0) return [['']]
	const firstLine = lines.find((l) => l.trim() !== '') ?? lines[0]
	if (firstLine.includes('\t')) {
		return lines.map((l) => l.split('\t'))
	}
	if (firstLine.trim().startsWith('|')) {
		const grid = lines
			.map((l) => {
				let t = l.trim()
				if (t.startsWith('|')) t = t.slice(1)
				if (t.endsWith('|')) t = t.slice(0, -1)
				return t.split('|').map((c) => c.trim())
			})
			.filter((cells) => !isMarkdownSeparatorRow(cells))
		return grid
	}
	return lines.map((l) => splitDelimitedLine(l, ','))
}

// --- Mutating ops, all pure (return a new TableData) ------------------------------------

export function tableFromGrid(grid: string[][], hasHeader: boolean): TableData {
	const width = Math.max(1, ...grid.map((r) => r.length))
	const names = hasHeader ? grid[0] : []
	const columns = Array.from({ length: width }, (_, i) =>
		makeColumn({ name: (names[i] || '').trim() || `Column ${i + 1}` })
	)
	const dataRows = hasHeader ? grid.slice(1) : grid
	const rows = dataRows.map((line) =>
		makeRow(
			columns,
			{ cells: Object.fromEntries(columns.map((c, i) => [c.id, line[i] ?? ''])) }
		)
	)
	return { columns, rows: rows.length ? rows : [makeRow(columns)], headerRow: true }
}

/** Pastes a raw grid into `table` starting at (rowIndex, colIndex), growing rows/columns as
 * needed. Never treats the pasted grid's first line as a header — it lands exactly on the cell
 * the user had selected. */
export function pasteIntoTable(table: TableData, rowIndex: number, colIndex: number, grid: string[][]): TableData {
	const neededCols = colIndex + Math.max(...grid.map((r) => r.length), 0)
	const neededRows = rowIndex + grid.length

	let columns = table.columns
	if (neededCols > columns.length) {
		const extra = Array.from({ length: neededCols - columns.length }, (_, i) =>
			makeColumn({ name: `Column ${columns.length + i + 1}` })
		)
		columns = [...columns, ...extra]
	}

	let rows = table.rows.map((r) => ({ ...r, cells: { ...r.cells } }))
	if (neededRows > rows.length) {
		const extra = Array.from({ length: neededRows - rows.length }, () => makeRow(columns))
		rows = [...rows, ...extra]
	}
	// Existing rows might be missing cells for newly-added columns.
	rows = rows.map((r) => {
		const cells = { ...r.cells }
		for (const col of columns) if (!(col.id in cells)) cells[col.id] = ''
		return { ...r, cells }
	})

	for (let r = 0; r < grid.length; r++) {
		for (let c = 0; c < grid[r].length; c++) {
			const col = columns[colIndex + c]
			rows[rowIndex + r] = { ...rows[rowIndex + r], cells: { ...rows[rowIndex + r].cells, [col.id]: grid[r][c] } }
		}
	}

	return { columns, rows, headerRow: table.headerRow }
}

export function insertRow(table: TableData, index: number, position: 'above' | 'below'): TableData {
	const at = position === 'above' ? index : index + 1
	const rows = table.rows.slice()
	rows.splice(at, 0, makeRow(table.columns))
	return { ...table, rows }
}

export function deleteRow(table: TableData, index: number): TableData {
	const rows = table.rows.slice()
	rows.splice(index, 1)
	return { ...table, rows: rows.length ? rows : [makeRow(table.columns)] }
}

export function duplicateRow(table: TableData, index: number): TableData {
	const rows = table.rows.slice()
	const source = rows[index]
	if (!source) return table
	rows.splice(index + 1, 0, { ...source, id: nextTableId('row'), cells: { ...source.cells } })
	return { ...table, rows }
}

export function reorderRow(table: TableData, from: number, to: number): TableData {
	if (from === to) return table
	const rows = table.rows.slice()
	const [moved] = rows.splice(from, 1)
	rows.splice(to, 0, moved)
	return { ...table, rows }
}

export function insertColumn(table: TableData, index: number, position: 'left' | 'right'): TableData {
	const at = position === 'left' ? index : index + 1
	const columns = table.columns.slice()
	const col = makeColumn({ name: `Column ${columns.length + 1}` })
	columns.splice(at, 0, col)
	const rows = table.rows.map((r) => ({ ...r, cells: { ...r.cells, [col.id]: '' } }))
	return { ...table, columns, rows }
}

export function deleteColumn(table: TableData, index: number): TableData {
	const removed = table.columns[index]
	const columns = table.columns.slice()
	columns.splice(index, 1)
	if (!columns.length) columns.push(makeColumn({ name: 'Column' }))
	const rows = table.rows.map((r) => {
		const cells = { ...r.cells }
		if (removed) delete cells[removed.id]
		for (const col of columns) if (!(col.id in cells)) cells[col.id] = ''
		return { ...r, cells }
	})
	return { ...table, columns, rows }
}

export function reorderColumn(table: TableData, from: number, to: number): TableData {
	if (from === to) return table
	const columns = table.columns.slice()
	const [moved] = columns.splice(from, 1)
	columns.splice(to, 0, moved)
	return { ...table, columns }
}

// --- Sort --------------------------------------------------------------------------------

function sortKey(table: TableData, col: TableColumn, row: TableRow): string | number {
	const raw = row.cells[col.id] ?? ''
	if (col.type === 'number') {
		const n = Number(raw.replace(/,/g, ''))
		return Number.isFinite(n) ? n : -Infinity
	}
	if (col.type === 'checkbox') return raw === 'true' ? 1 : 0
	if (col.type === 'status') {
		const idx = col.options?.findIndex((o) => o.id === raw) ?? -1
		return idx < 0 ? Infinity : idx
	}
	if (col.type === 'date') {
		const t = Date.parse(raw)
		return Number.isFinite(t) ? t : Infinity
	}
	return raw.toLowerCase()
}

export function sortByColumn(table: TableData, columnIndex: number, dir: 'asc' | 'desc'): TableData {
	const col = table.columns[columnIndex]
	if (!col) return table
	const rows = table.rows
		.map((row, i) => ({ row, i }))
		.sort((a, b) => {
			const ka = sortKey(table, col, a.row)
			const kb = sortKey(table, col, b.row)
			let cmp: number
			if (typeof ka === 'number' && typeof kb === 'number') cmp = ka - kb
			else cmp = String(ka).localeCompare(String(kb))
			if (cmp === 0) cmp = a.i - b.i
			return dir === 'asc' ? cmp : -cmp
		})
		.map((e) => e.row)
	return { ...table, rows }
}

// --- Column type conversion --------------------------------------------------------------

const TRUTHY = new Set(['true', '1', 'yes', 'y', 'x', '✓', 'done'])

export function convertCellValue(value: string, toType: TableColumnType, options?: TableStatusOption[]): string {
	const v = (value ?? '').trim()
	if (v === '') return ''
	switch (toType) {
		case 'checkbox':
			return TRUTHY.has(v.toLowerCase()) ? 'true' : ''
		case 'number': {
			const n = Number(v.replace(/,/g, ''))
			return Number.isFinite(n) ? String(n) : ''
		}
		case 'date': {
			const t = Date.parse(v)
			return Number.isFinite(t) ? v : ''
		}
		case 'status': {
			const match = options?.find((o) => o.label.toLowerCase() === v.toLowerCase())
			return match ? match.id : v
		}
		default:
			return v
	}
}

/** Changing a column's type keeps values where they convert (WP40). Status->anything else reads
 * back the option's label, not its id. A new status column auto-gains an option per distinct
 * existing value so nothing is silently dropped. */
export function setColumnType(table: TableData, columnIndex: number, toType: TableColumnType): TableData {
	const col = table.columns[columnIndex]
	if (!col || col.type === toType) return table
	const fromStatus = col.type === 'status' ? col.options : undefined

	let options = toType === 'status' ? (col.options ?? []).slice() : undefined
	const rows = table.rows.map((row) => {
		let raw = row.cells[col.id] ?? ''
		if (fromStatus) {
			const opt = fromStatus.find((o) => o.id === raw)
			raw = opt ? opt.label : ''
		}
		let next = convertCellValue(raw, toType, options)
		if (toType === 'status' && raw && !options!.some((o) => o.id === next)) {
			const opt: TableStatusOption = {
				id: nextTableId('opt'),
				label: raw,
				color: STATUS_COLOR_NAMES[options!.length % STATUS_COLOR_NAMES.length],
			}
			options = [...options!, opt]
			next = opt.id
		}
		return { ...row, cells: { ...row.cells, [col.id]: next } }
	})

	const columns = table.columns.slice()
	columns[columnIndex] = { ...col, type: toType, options, align: toType === 'number' ? 'right' : col.align }
	return { ...table, columns, rows }
}

// --- Export -------------------------------------------------------------------------------

function cellDisplayValue(col: TableColumn, raw: string): string {
	if (col.type === 'status') return col.options?.find((o) => o.id === raw)?.label ?? raw
	if (col.type === 'checkbox') return raw === 'true' ? 'x' : ''
	return raw
}

export function toCSV(table: TableData): string {
	const esc = (s: string) => (s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s)
	const lines = [table.columns.map((c) => esc(c.name)).join(',')]
	for (const row of table.rows) {
		lines.push(table.columns.map((c) => esc(cellDisplayValue(c, row.cells[c.id] ?? ''))).join(','))
	}
	return lines.join('\n')
}

export function toTSV(table: TableData): string {
	const lines = [table.columns.map((c) => c.name).join('\t')]
	for (const row of table.rows) {
		lines.push(table.columns.map((c) => cellDisplayValue(c, row.cells[c.id] ?? '')).join('\t'))
	}
	return lines.join('\n')
}

export function toMarkdown(table: TableData): string {
	const esc = (s: string) => s.replace(/\|/g, '\\|')
	const header = `| ${table.columns.map((c) => esc(c.name)).join(' | ')} |`
	const sep = `| ${table.columns.map(() => '---').join(' | ')} |`
	const body = table.rows.map(
		(row) => `| ${table.columns.map((c) => esc(cellDisplayValue(c, row.cells[c.id] ?? ''))).join(' | ')} |`
	)
	return [header, sep, ...body].join('\n')
}

// --- Autofit math (DOM-free; the caller measures text, this just picks the width/height) -----

export function computeAutoFitWidth(measuredTextWidths: number[], opts?: { padding?: number; min?: number; max?: number }): number {
	const padding = opts?.padding ?? 28
	const min = opts?.min ?? MIN_COLUMN_WIDTH
	const max = opts?.max ?? MAX_COLUMN_WIDTH
	const widest = measuredTextWidths.length ? Math.max(...measuredTextWidths) : 0
	return Math.max(min, Math.min(max, Math.ceil(widest + padding)))
}

export function computeAutoFitRowHeight(measuredContentHeights: number[], opts?: { padding?: number; min?: number; max?: number }): number {
	const padding = opts?.padding ?? 12
	const min = opts?.min ?? DEFAULT_ROW_HEIGHT
	const max = opts?.max ?? MAX_ROW_HEIGHT
	const tallest = measuredContentHeights.length ? Math.max(...measuredContentHeights) : 0
	return Math.max(min, Math.min(max, Math.ceil(tallest + padding)))
}

// --- Resize scaling -----------------------------------------------------------------------

export function scaleColumnWidths(columns: TableColumn[], scale: number): TableColumn[] {
	return columns.map((c) => ({ ...c, width: Math.max(MIN_COLUMN_WIDTH, Math.round(c.width * scale)) }))
}

export function scaleRowHeights(rows: TableRow[], scale: number, defaultHeight: number): TableRow[] {
	return rows.map((r) => ({
		...r,
		height: Math.max(MIN_ROW_HEIGHT, Math.round((r.height ?? defaultHeight) * scale)),
	}))
}

export function tableWidth(columns: TableColumn[]): number {
	return columns.reduce((sum, c) => sum + c.width, 0)
}

export function tableHeight(table: TableData, rowHeight = DEFAULT_ROW_HEIGHT): number {
	const header = table.headerRow ? HEADER_ROW_HEIGHT : 0
	return header + table.rows.reduce((sum, r) => sum + (r.height ?? rowHeight), 0)
}

// --- Migration defaults ---------------------------------------------------------------------

/** Fills a possibly-partial/old props.table (or a brand-new shape) with everything the current
 * shape needs. Used by getDefaultProps and by the props migration (old canvases). */
export function withTableDefaults(table: Partial<TableData> | undefined | null): TableData {
	if (!table || !Array.isArray(table.columns) || table.columns.length === 0) {
		return createEmptyTable(4, 3)
	}
	const columns = table.columns.map((c) =>
		makeColumn({ ...c, id: c.id ?? nextTableId('col'), width: c.width ?? DEFAULT_COLUMN_WIDTH, type: c.type ?? 'text' })
	)
	const rows = Array.isArray(table.rows) && table.rows.length
		? table.rows.map((r) => makeRow(columns, r))
		: [makeRow(columns)]
	return { columns, rows, headerRow: table.headerRow ?? true, rowNumbers: table.rowNumbers }
}
