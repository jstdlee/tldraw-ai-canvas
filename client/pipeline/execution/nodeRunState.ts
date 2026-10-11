import { Editor, TLShapeId } from 'tldraw'
import { EditorAtomMap } from '../utils'

export type NodeRunStatus = 'running' | 'ok' | 'error' | 'missing' | 'stopped'

export interface NodeRunInfo {
	status: NodeRunStatus
	ms?: number
	message?: string
}

// WP25: one atom per shape id, not one shared atom for every card's run state — a status
// change on one card must not invalidate (and re-render) every other card that reads its own
// run state.
const nodeRunStateMap = new EditorAtomMap<NodeRunInfo>('node run')

/** A single card's run state. Use this (not `nodeRunState.get(editor)[id]`) in render/`useValue`
 * so the read only tracks this one card's atom. */
export function getNodeRun(editor: Editor, id: TLShapeId): NodeRunInfo | undefined {
	return nodeRunStateMap.get(editor, id)
}

export function setNodeRun(editor: Editor, id: TLShapeId, info: NodeRunInfo) {
	nodeRunStateMap.set(editor, id, info)
}

export function clearNodeRun(editor: Editor, id: TLShapeId) {
	nodeRunStateMap.delete(editor, id)
}

/** Back-compat for imperative (non-render) code that wants every card's run state at once
 * (e.g. scanning a loop body's cards for the first error). Never read this inside `useValue` —
 * it touches every card's atom, which is exactly what per-shape atoms exist to avoid. */
export const nodeRunState = {
	get(editor: Editor): Record<string, NodeRunInfo> {
		return Object.fromEntries(nodeRunStateMap.entries(editor))
	},
}
