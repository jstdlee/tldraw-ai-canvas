import { Editor, TLShapeId } from 'tldraw'
import { EditorAtom } from '../utils'
import { ExecutionGraph } from './ExecutionGraph'
import { staleUpstreamOrder } from './upstream'

export interface ExecutionState {
	runningGraph: ExecutionGraph | null
	/**
	 * Bumped on every Play and Stop. Loop bodies run in child graphs that are
	 * not the tracked runningGraph, so they watch this number to notice a Stop.
	 */
	generation: number
	/**
	 * Aborts every in-flight server call for the current run (WP19 Part 2): a card's
	 * `execute` reads `currentRunSignal` and hands it to its `fetch`/SDK call. Stop,
	 * or a new run replacing this one, aborts it.
	 */
	controller: AbortController | null
}

export const executionState = new EditorAtom<ExecutionState>('execution state', () => ({
	runningGraph: null,
	generation: 0,
	controller: null,
}))

/** The current execution generation; a loop snapshots it and stops when it changes. */
export function executionGeneration(editor: Editor): number {
	return executionState.get(editor).generation
}

/** The signal for the run in progress, or undefined when nothing is running. */
export function currentRunSignal(editor: Editor): AbortSignal | undefined {
	return executionState.get(editor).controller?.signal
}

export async function startExecution(
	editor: Editor,
	startingNodeIds: Set<TLShapeId>,
	options: { noCache?: boolean } = {}
) {
	// Run every out-of-date card upstream of what was pressed first, in dependency
	// order, so the pressed card (and anything downstream of it) sees fresh inputs.
	const stale = staleUpstreamOrder(editor, startingNodeIds)
	const allStartingIds = new Set([...stale, ...startingNodeIds])
	const graph = new ExecutionGraph(editor, allStartingIds, { noCache: options.noCache })
	const controller = new AbortController()
	executionState.update(editor, (state) => {
		state.runningGraph?.stop()
		state.controller?.abort()
		return {
			...state,
			runningGraph: graph,
			generation: state.generation + 1,
			controller,
		}
	})
	try {
		await graph.execute()
	} finally {
		executionState.update(editor, (state) => {
			if (state.runningGraph !== graph) return state
			return { ...state, runningGraph: null, controller: state.controller === controller ? null : state.controller }
		})
	}
}

export function stopExecution(editor: Editor) {
	executionState.update(editor, (state) => {
		if (!state.runningGraph) return state
		state.runningGraph.stop()
		state.controller?.abort()
		return { ...state, runningGraph: null, generation: state.generation + 1, controller: null }
	})
}
