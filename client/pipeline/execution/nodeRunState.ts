import { Editor, TLShapeId } from 'tldraw'
import { EditorAtom } from '../utils'

export type NodeRunStatus = 'running' | 'ok' | 'error' | 'missing'

export interface NodeRunInfo {
	status: NodeRunStatus
	ms?: number
	message?: string
}

export const nodeRunState = new EditorAtom<Record<string, NodeRunInfo>>('node run', () => ({}))

export function setNodeRun(editor: Editor, id: TLShapeId, info: NodeRunInfo) {
	nodeRunState.update(editor, (state) => ({ ...state, [id]: info }))
}

export function clearNodeRun(editor: Editor, id: TLShapeId) {
	nodeRunState.update(editor, (state) => {
		const next = { ...state }
		delete next[id]
		return next
	})
}
