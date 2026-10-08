import { Editor, TLShapeId } from 'tldraw'
import { EditorAtom } from '../utils'
import { ExecutionGraph } from './ExecutionGraph'

export interface ExecutionState {
	runningGraph: ExecutionGraph | null
	/**
	 * Bumped on every Play and Stop. Loop bodies run in child graphs that are
	 * not the tracked runningGraph, so they watch this number to notice a Stop.
	 */
	generation: number
}

export const executionState = new EditorAtom<ExecutionState>('execution state', () => ({
	runningGraph: null,
	generation: 0,
}))

/** The current execution generation; a loop snapshots it and stops when it changes. */
export function executionGeneration(editor: Editor): number {
	return executionState.get(editor).generation
}

export async function startExecution(editor: Editor, startingNodeIds: Set<TLShapeId>) {
	const graph = new ExecutionGraph(editor, startingNodeIds)
	executionState.update(editor, (state) => {
		state.runningGraph?.stop()
		return {
			...state,
			runningGraph: graph,
			generation: state.generation + 1,
		}
	})
	try {
		await graph.execute()
	} finally {
		executionState.update(editor, (state) => {
			if (state.runningGraph !== graph) return state
			return { ...state, runningGraph: null }
		})
	}
}

export function stopExecution(editor: Editor) {
	executionState.update(editor, (state) => {
		if (!state.runningGraph) return state
		state.runningGraph.stop()
		return { ...state, runningGraph: null, generation: state.generation + 1 }
	})
}
