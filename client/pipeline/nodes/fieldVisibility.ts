/**
 * WP17 follow-up: which input ports (dedicated and field) are not part of a node's *current*
 * render — a conditional field (crop's x/y/w/h only for a custom box, DataPipe's "extra" only
 * for a two-table op, …). `getNodeTypePorts` drops these unless a wire is already connected
 * (see `shared/fieldPortLayout.ts`'s `layoutPorts`). Pure in spirit, but lives client-side
 * because a couple of cases need client-only metadata (`IMAGE_TOOLS`).
 */
import { opSpec } from '../../../shared/tableOps'
import { TEXT_AI_OPERATIONS } from '../../../shared/textAiOps'
import { IMAGE_TOOLS } from '../imageOps'
import type { NodeType } from './nodeTypes'

/** Field keys (bare, not `field:`-prefixed) not shown in the node's current state. */
export function hiddenFieldKeys(node: NodeType): Set<string> {
	switch (node.type) {
		case 'crop':
			return node.aspect === 'Custom' ? new Set() : new Set(['x', 'y', 'w', 'h'])
		case 'image_resize':
			return node.mode === 'fit' || node.mode === 'exact' ? new Set() : new Set(['value2'])
		case 'image_tool': {
			const tool = IMAGE_TOOLS.find((t) => t.id === node.tool)
			return node.tool === 'look' || !tool || !('b' in tool) ? new Set(['b']) : new Set()
		}
		case 'jev':
			return node.kind === 'noul' ? new Set(['options']) : new Set()
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
	return new Set()
}
