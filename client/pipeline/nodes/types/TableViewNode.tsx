import { useMemo, useState } from 'react'
import { categoryOf } from '../../../../shared/nodeGroups'
import { filterTableRows, parseTableText, sortTableRows, toCsv } from '../../../../shared/tableText'
import { T, useEditor, useValue } from 'tldraw'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { getNodeInputPortValues, isInputWired } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import { UiButton, UiEmpty, UiIconButton, UiTextArea } from '../../../ui'
import { IconCopy, IconExpand, IconTable } from '../../../ui/icons'
import { SortFilterTable, TableZoom } from '../../editors/LargeEditor'
import { OutputPortRow, PortRow, stopEvent, useInputConnected, WireFieldHeader } from './fields'
import {
	areAnyInputsOutOfDate,
	ExecutionResult,
	getInputText,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	updateNode,
} from './shared'

// ---------------------------------------------------------------------------
// Table view (WP26): a sortable, filterable grid card — usually the last step after a
// DataPipe/Database/Chart chain, to look at a table, sort/filter it, and copy it as CSV.
// ---------------------------------------------------------------------------

export type TableViewNode = T.TypeOf<typeof TableViewNode>
export const TableViewNode = T.object({
	type: T.literal('table_view'),
	/** Literal input table, used when the data port is not wired. */
	text: T.string,
	/** The filter box and the current sort, persisted so `execute()` (outside React, run by the
	 * generic Run button) reproduces exactly what the grid shows — the `output`/`json` ports
	 * always agree with what is on screen. */
	filterText: T.string,
	/** The sorted column's name ('' = unsorted); a name (not an index) survives column reordering. */
	sortColumn: T.string,
	sortDir: T.string,
	error: T.string.nullable(),
	lastOutput: T.string.nullable(),
	lastJson: T.string.nullable(),
	lastInfo: T.string,
})

const GRID_AREA_PX = 320
/** Hard cap on rendered rows (per the WP26 guide); `SortFilterTable`'s own "+N more" footer says
 * when a filter/sort result is bigger than this. */
const TABLE_VIEW_MAX_ROWS = 2000

export class TableViewNodeDefinition extends NodeDefinition<TableViewNode> {
	static type = 'table_view'
	static validator = TableViewNode
	title = 'Table view'
	heading = 'Table view'
	icon = <IconTable />
	category = categoryOf('table_view')
	resultKeys = ['error', 'lastOutput', 'lastJson', 'lastInfo'] as const
	override showsOutput = true
	override defaultWidthPx = 480
	getDefault(): TableViewNode {
		return {
			type: 'table_view',
			text: 'name,city,score\nAda,Paris,3\nLin,Oslo,5',
			filterText: '',
			sortColumn: '',
			sortDir: 'asc',
			error: null,
			lastOutput: null,
			lastJson: null,
			lastInfo: '',
		}
	}
	getBodyHeightPx(shape: NodeShape) {
		const dataWired = isInputWired(this.editor, shape.id, 'data')
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		// Data port row + (unwired: the "text" field's own label row) + the "json" output row,
		// then the grid itself.
		return rowPx * (dataWired ? 2 : 3) + GRID_AREA_PX
	}
	getPorts(shape: NodeShape, node: TableViewNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const width = this.getWidthPx(shape, node)
		return {
			data: { id: 'data', x: 0, y: NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX + rowPx * 0.5, terminal: 'end', dataType: 'text' },
			output: { id: 'output', x: width, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
			json: { id: 'json', x: width, y: NODE_HEADER_HEIGHT_PX / 2 + rowPx, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: TableViewNode, inputs: InputValues): Promise<ExecutionResult> {
		const text = getInputText(inputs, 'data') || node.text
		try {
			const table = parseTableText(text)
			const columnIndex = node.sortColumn ? table.headers.indexOf(node.sortColumn) : -1
			const filtered = filterTableRows(table.rows, node.filterText)
			const sorted = sortTableRows(filtered, columnIndex >= 0 ? columnIndex : null, (node.sortDir as 'asc' | 'desc') || 'asc')
			const output = toCsv(table.headers, sorted)
			const json = JSON.stringify(sorted.map((row) => Object.fromEntries(table.headers.map((h, i) => [h, row[i] ?? '']))))
			const info = `${sorted.length.toLocaleString()} of ${table.rows.length.toLocaleString()} row${table.rows.length === 1 ? '' : 's'}`
			updateNode<TableViewNode>(this.editor, shape, (n) => ({ ...n, error: null, lastOutput: output, lastJson: json, lastInfo: info }), false)
			return { output, json }
		} catch (error) {
			updateNode<TableViewNode>(this.editor, shape, (n) => ({ ...n, error: (error as Error).message }), false)
			throw error
		}
	}
	getOutputInfo(shape: NodeShape, node: TableViewNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		return {
			output: { value: node.lastOutput ?? null, isOutOfDate, dataType: 'text' },
			json: { value: node.lastJson ?? null, isOutOfDate, dataType: 'text' },
		}
	}
	Component = TableViewComponent
}

function TableViewComponent({ shape, node }: NodeComponentProps<TableViewNode>) {
	const editor = useEditor()
	const dataWired = useInputConnected(shape.id, 'data')
	const [zoomOpen, setZoomOpen] = useState(false)
	const [copied, setCopied] = useState(false)
	const [visibleRows, setVisibleRows] = useState<string[][]>([])
	const set = (patch: Partial<TableViewNode>) => updateNode<TableViewNode>(editor, shape, (n) => ({ ...n, ...patch }), false)

	// WP26: same pattern as DataPipe/Chart/Profile's own live preview — the wired input's current
	// value (via `getNodeInputPortValues`, which reads the upstream node's own last-run output),
	// falling back to the literal Text field.
	const effectiveText = useValue(
		'table_view input text',
		() => {
			const wired = getNodeInputPortValues(editor, shape.id).data?.value
			if (typeof wired === 'string' && wired.trim()) return wired
			return node.text
		},
		[editor, shape.id, node.text]
	)
	const table = useMemo(() => {
		try {
			return parseTableText(effectiveText)
		} catch {
			return null
		}
	}, [effectiveText])
	const sortColumnIndex = table && node.sortColumn ? table.headers.indexOf(node.sortColumn) : -1

	const copyCsv = () => {
		if (!table) return
		void navigator.clipboard.writeText(toCsv(table.headers, visibleRows))
		setCopied(true)
		window.setTimeout(() => setCopied(false), 900)
	}

	return (
		<>
			{/* "data" is a dedicated port, separate from the wirable "text" field below — its own
			    row/anchor must always render, not just while wired (see Profile's identical note). */}
			<PortRow shapeId={shape.id} portId="data" label="Table" dataType="text" />
			{!dataWired && (
				<>
					<WireFieldHeader shapeId={shape.id} fieldKey="text" label="Text" />
					<UiTextArea className="NodeField-textarea" mono rows={4} value={node.text} onChange={(text) => set({ text })} />
				</>
			)}
			{table ? (
				<>
					<SortFilterTable
						columns={table.headers}
						rows={table.rows}
						maxRows={TABLE_VIEW_MAX_ROWS}
						onVisibleRows={setVisibleRows}
						controlled={{
							filter: node.filterText,
							onFilterChange: (filterText) => set({ filterText }),
							sortColumn: sortColumnIndex >= 0 ? sortColumnIndex : null,
							sortDir: (node.sortDir as 'asc' | 'desc') || 'asc',
							onSortChange: (index, sortDir) => set({ sortColumn: index == null ? '' : (table.headers[index] ?? ''), sortDir }),
						}}
						toolbarExtra={
							<div className="TableViewNode-toolbarButtons" onPointerDown={stopEvent}>
								<UiButton size="sm" variant="low" icon={<IconCopy />} label={copied ? 'Copied' : 'Copy as CSV'} onClick={copyCsv} />
								<UiIconButton icon={<IconExpand size={13} />} title="Open full-size viewer" onClick={() => setZoomOpen(true)} />
							</div>
						}
					/>
					{zoomOpen && <TableZoom title="Table view" columns={table.headers} rows={table.rows} onClose={() => setZoomOpen(false)} />}
				</>
			) : (
				<UiEmpty text="Give this card a table to view" />
			)}
			<OutputPortRow shapeId={shape.id} portId="json" label="JSON" dataType="text" />
		</>
	)
}
