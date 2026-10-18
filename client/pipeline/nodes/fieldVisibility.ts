/**
 * WP17 follow-up: which input ports (dedicated and field) are not part of a node's *current*
 * render — a conditional field (crop's x/y/w/h only for a custom box, DataPipe's "extra" only
 * for a two-table op, …). `getNodeTypePorts` drops these unless a wire is already connected
 * (see `shared/fieldPortLayout.ts`'s `layoutPorts`). Pure in spirit, but lives client-side
 * because a couple of cases need client-only metadata (`IMAGE_TOOLS`).
 */
import { opSpec, TABLE_OPS } from '../../../shared/tableOps'
import { TEXT_AI_OPERATIONS } from '../../../shared/textAiOps'
import { IMAGE_TOOLS } from '../imageOps'
import type { NodeType } from './nodeTypes'

/** Every op param field DataPipe can store (the union across all ops) — used to hide whichever
 * of them the *current* op doesn't actually use (DATA-09). */
const ALL_TABLE_OP_FIELDS = new Set(TABLE_OPS.flatMap((spec) => spec.params.map((p) => p.field)))

/** Wiring facts `hiddenFieldKeys` can't read from `node` alone (a dedicated port's wired state
 * lives on the shape's bindings, not in `node`'s own props) — passed in by whichever caller has
 * an `editor`/`shapeId` to check (DATA-09 / GAPS-12). Omitted entirely by callers that only need
 * the node-only cases (e.g. Chart's own `kind`-based hiding). */
export interface HiddenFieldCtx {
	/** Whether the dedicated "data" port is wired (profile / table_view). */
	dataWired?: boolean
	/** Whether the dedicated "rows" port is wired (database). */
	rowsWired?: boolean
}

/** Field keys (bare, not `field:`-prefixed) not shown in the node's current state. */
export function hiddenFieldKeys(node: NodeType, ctx: HiddenFieldCtx = {}): Set<string> {
	switch (node.type) {
		case 'crop':
			return node.aspect === 'Custom' ? new Set() : new Set(['x', 'y', 'w', 'h'])
		case 'image_resize':
			return node.mode === 'fit' || node.mode === 'exact' ? new Set() : new Set(['value2'])
		case 'image_tool': {
			const tool = IMAGE_TOOLS.find((t) => t.id === node.tool)
			return node.tool === 'look' || !tool || !('b' in tool) ? new Set(['b']) : new Set()
		}
		case 'for_each': {
			// Range mode (From / To / Step) replaces the Separator row.
			const hidden = node.split === 'range' ? new Set(['separator']) : new Set(['rangeFrom', 'rangeTo', 'rangeStep'])
			// WP35 Part C: "Result column" only means anything for collect: "table" (add the
			// per-row result as a new column) — every other collect mode has no column to name.
			if (node.collect !== 'table') hidden.add('resultColumn')
			return hidden
		}
		case 'jev':
			return node.kind === 'noul' ? new Set(['options']) : new Set()
		// WP35 Part B: "Language" only means anything for find: "fence" (restrict to one
		// fenced language) — every other find mode has no language to pick.
		case 'extract':
			return node.find === 'fence' ? new Set() : new Set(['lang'])
		case 'text_ai': {
			const hidden = new Set<string>()
			if (!node.showSettings) hidden.add('promptOverride')
			const op = TEXT_AI_OPERATIONS.find((o) => o.id === node.operation) ?? TEXT_AI_OPERATIONS[0]
			if (op.id === 'custom' || !op.option) hidden.add('option')
			return hidden
		}
		case 'file_in': {
			const hidden = new Set<string>()
			const source = node.source ?? 'upload'
			// Nothing in the body renders at all for the legacy "path" mode.
			if (node.mode === 'path') return new Set(['source', 'action', 'asText'])
			if (source !== 'upload') hidden.add('action')
			if (source !== 'url') hidden.add('asText')
			return hidden
		}
		case 'database': {
			// WP34 (GAPS-12): "Load rows into" (the targetTable header + the rows port) now
			// applies to every source, not just the external ones — its header row always
			// renders. But the load-mode select and the upsert key field are still nested inside
			// the card's own "rows is wired" branch (DatabaseNode.tsx), so they have no row/anchor
			// until then; the key column also only matters in "upsert on key" mode.
			if (!ctx.rowsWired) return new Set(['loadMode', 'upsertKey'])
			return (node as { loadMode?: string }).loadMode === 'upsert' ? new Set() : new Set(['upsertKey'])
		}
		case 'chart': {
			const hidden = new Set<string>()
			const kind = node.kind
			// "Split by" makes a long-format table into several series; meaningless for a
			// single-slice pie/donut, a raw point cloud, or an already-binned histogram.
			if (kind === 'pie' || kind === 'donut' || kind === 'scatter' || kind === 'histogram') hidden.add('series')
			// A scatter plots raw points and a histogram bins them: neither combines rows.
			if (kind === 'scatter' || kind === 'histogram') hidden.add('aggregate')
			// Stacking only makes sense for bar/hbar/area series sharing a category axis.
			if (kind !== 'bar' && kind !== 'hbar' && kind !== 'area') hidden.add('stack')
			// Sort/top-N/Other rank categories; a scatter/histogram/heatmap has none to rank.
			if (kind === 'scatter' || kind === 'histogram' || kind === 'heatmap') {
				hidden.add('sort')
				hidden.add('top')
				hidden.add('otherRow')
			}
			if (kind !== 'histogram') hidden.add('bins')
			if (kind !== 'bar' && kind !== 'line' && kind !== 'area' && kind !== 'hbar') hidden.add('dualScale')
			// Pie/donut have no axes to label; every other kind (including histogram and
			// heatmap) has a real x and y axis.
			if (kind === 'pie' || kind === 'donut') {
				hidden.add('xLabel')
				hidden.add('yLabel')
			}
			if (kind !== 'line' && kind !== 'area') hidden.add('smooth')
			return hidden
		}
		// DATA-09/UI-14: Profile and Table view's own "text" field is only a fallback for when
		// the dedicated "data" port isn't wired — their component never renders that field's row
		// once "data" is wired, so the port-anchor invariant check must stop expecting one too.
		case 'profile':
		case 'table_view':
			return ctx.dataWired ? new Set(['text']) : new Set()
		// DataPipe: every op-specific param field not used by the *current* op's own
		// OpSpec.params list has no row at all (ParamField only renders the current op's own
		// params) — same invariant-check gap as above, one level more dynamic.
		case 'table': {
			const used = new Set((opSpec(node.op)?.params ?? []).map((p) => p.field))
			return new Set([...ALL_TABLE_OP_FIELDS].filter((field) => !used.has(field)))
		}
		default:
			return new Set()
	}
}

/** Dedicated port ids not shown in the node's current state (distinct from the fields above:
 * these are ports a `getPorts()` method defines, not `field:<key>` ones). */
export function hiddenDedicatedPortIds(node: NodeType): Set<string> {
	if (node.type === 'table') {
		return opSpec(node.op)?.second ? new Set() : new Set(['extra'])
	}
	// Read from: the URL input only applies in URL mode.
	if (node.type === 'file_in') {
		const source = (node as { source?: string }).source ?? 'upload'
		return source === 'url' ? new Set() : new Set(['url'])
	}
	// Database's "rows" port used to be hidden for sqlite/pglite; WP34/GAPS-12 made "load rows
	// into a table" apply to every source, so it's never hidden here any more — falls through
	// to the same `new Set()` every other node type gets.
	return new Set()
}
