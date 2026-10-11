import { AtomMap, Editor, TLShapeId } from 'tldraw'
import {
	getNodeOutputPortInfo,
	getNodePortConnections,
	getNodePorts,
	NodePortConnection,
} from '../nodes/nodePorts'
import { NodeShape } from '../nodes/NodeShapeUtil'
import { executeNode, getNodeDefinition } from '../nodes/nodeTypes'
import {
	ExecutionResult,
	InfoValues,
	isMultiInfoValue,
	PipelineValue,
	STOP_EXECUTION,
} from '../nodes/types/shared'
import { missingRunInput } from '../../../shared/runIssue'
import { spillUnconnectedOutput } from '../autoSpill'
import { runErrorMessage } from '../../../shared/runError'
import { isRunCacheable } from '../../../shared/runCache'
import { runHash } from '../../../shared/runHash'
import { setNodeRun } from './nodeRunState'
import { getArrowInputs, writeArrowOutputs } from './arrows'

export interface ExecutionGraphOptions {
	/** Only these nodes may run (loop bodies, packed groups). */
	allowed?: Set<TLShapeId>
	/** Fixed input values, keyed `${nodeId}|${portId}` (loop item, packed-group inputs). */
	overrides?: Map<string, PipelineValue>
	/** "Run without cache": ignore `lastRunHash`, always execute. */
	noCache?: boolean
}

/** An output port's InfoValues, reduced to the plain values `ExecutionResult` wants. */
function toExecutionResult(info: InfoValues): ExecutionResult {
	const result: ExecutionResult = {}
	for (const [portId, value] of Object.entries(info)) {
		result[portId] = isMultiInfoValue(value) ? value.value[0] ?? null : value.value
	}
	return result
}

/** True when the connection ends on a loop-back (feedback) port. */
function isFeedbackEnd(editor: Editor, nodeId: TLShapeId, portId: string) {
	return !!getNodePorts(editor, nodeId)[portId]?.feedback
}

interface PendingExecutionGraphNode {
	readonly state: 'waiting' | 'executing'
	readonly shape: NodeShape
	readonly connections: NodePortConnection[]
}
interface ExecutedExecutionGraphNode {
	readonly state: 'executed'
	readonly shape: NodeShape
	readonly connections: NodePortConnection[]
	readonly outputs: ExecutionResult
}

type ExecutionGraphNode = PendingExecutionGraphNode | ExecutedExecutionGraphNode

export class ExecutionGraph {
	private readonly nodesById = new AtomMap<TLShapeId, ExecutionGraphNode>('node by id')

	constructor(
		private readonly editor: Editor,
		private readonly startingNodeIds: Set<TLShapeId>,
		private readonly options: ExecutionGraphOptions = {}
	) {
		const toVisit = Array.from(startingNodeIds)

		while (toVisit.length > 0) {
			const nodeId = toVisit.pop()!
			if (this.nodesById.has(nodeId)) continue
			if (options.allowed && !options.allowed.has(nodeId)) continue

			const node = this.editor.getShape(nodeId)
			if (!node || !this.editor.isShapeOfType(node, 'node')) continue

			const connections = getNodePortConnections(this.editor, node)

			this.nodesById.set(nodeId, {
				state: 'waiting',
				shape: node,
				connections,
			})

			for (const connection of Object.values(connections)) {
				if (!connection || connection.terminal !== 'start') continue
				// Don't follow wires into loop-back ports: that would close the loop.
				if (isFeedbackEnd(editor, connection.connectedShapeId, connection.connectedPortId)) continue
				toVisit.push(connection.connectedShapeId)
			}
		}
	}

	/** Outputs of a node that ran in this graph. */
	getOutputs(nodeId: TLShapeId): ExecutionResult | undefined {
		const node = this.nodesById.get(nodeId)
		return node?.state === 'executed' ? node.outputs : undefined
	}

	/** How many cards this run touches in total (for the "Running N cards…" footer text). */
	get size(): number {
		return this.nodesById.size
	}

	private state: 'waiting' | 'executing' | 'stopped' = 'waiting'

	async execute() {
		if (this.state !== 'waiting') {
			throw new Error('ExecutionGraph can only be executed once')
		}

		this.state = 'executing'
		try {
			const promises = []
			for (const nodeId of this.startingNodeIds) {
				promises.push(this.executeNodeIfReady(nodeId))
			}
			await Promise.all(promises)
		} finally {
			this.state = 'stopped'
		}
	}

	stop() {
		this.state = 'stopped'
	}

	private async executeNodeIfReady(nodeId: TLShapeId) {
		if (this.state !== 'executing') return

		const node = this.nodesById.get(nodeId)
		if (!node || node.state !== 'waiting') return

		const inputs: Record<string, PipelineValue | PipelineValue[]> = {}
		const ports = getNodePorts(this.editor, nodeId)
		const sortedConnections = [...node.connections].sort((a, b) => a.order - b.order)

		const overrides = this.options.overrides
		for (const connection of sortedConnections) {
			if (!connection || connection.terminal !== 'end') continue
			if (ports[connection.ownPortId]?.feedback) continue
			if (overrides?.has(`${nodeId}|${connection.ownPortId}`)) continue

			const dependency = this.nodesById.get(connection.connectedShapeId)
			let value: PipelineValue | STOP_EXECUTION
			if (dependency) {
				if (dependency.state !== 'executed') {
					return
				}

				const output = dependency.outputs[connection.connectedPortId]
				if (output === STOP_EXECUTION) {
					return
				}

				value = output as PipelineValue
			} else {
				const outputs = getNodeOutputPortInfo(this.editor, connection.connectedShapeId)
				const output = outputs[connection.connectedPortId]

				if (!output || output.value === STOP_EXECUTION) {
					return
				}

				value = output.value as PipelineValue
			}

			const port = ports[connection.ownPortId]
			if (port?.multi) {
				const existing = inputs[connection.ownPortId]
				if (Array.isArray(existing)) {
					existing.push(value)
				} else {
					inputs[connection.ownPortId] = [value]
				}
			} else {
				inputs[connection.ownPortId] = value
			}
		}

		if (overrides) {
			for (const [key, value] of overrides) {
				const [id, portId] = key.split('|')
				if (id === nodeId) inputs[portId] = value
			}
		}

		// Values from tldraw arrows (shape → node), for ports without a wire.
		for (const [portId, value] of Object.entries(await getArrowInputs(this.editor, nodeId))) {
			if (!(portId in inputs)) inputs[portId] = value
		}
		if (this.state !== 'executing') return
		if (this.nodesById.get(nodeId)?.state !== 'waiting') return

		const issue = missingRunInput(node.shape.props.node as { type: string }, inputs)
		if (issue) {
			setNodeRun(this.editor, nodeId, { status: 'missing', message: issue, ms: 0 })
			const stopped = Object.fromEntries(
				Object.values(getNodePorts(this.editor, nodeId))
					.filter((port) => port.terminal === 'start')
					.map((port) => [port.id, STOP_EXECUTION])
			) as ExecutionResult
			this.nodesById.set(nodeId, { ...node, state: 'executed', outputs: stopped })
			return
		}

		// Input-hash cache (WP14 Part B): skip the card when nothing that matters
		// changed since its last run and it still has outputs to show.
		const nodeValue = node.shape.props.node as { type: string } & Record<string, unknown>
		let hash: string | undefined
		if (isRunCacheable(nodeValue)) {
			const definition = getNodeDefinition(this.editor, node.shape.props.node)
			const resultKeys = new Set(definition.resultKeys ?? [])
			hash = cacheHashFor(this.editor, node.shape, inputs)

			if (!this.options.noCache && node.shape.props.lastRunHash === hash) {
				const defaults = definition.getDefault() as unknown as Record<string, unknown>
				// Error fields are empty after a good run, so they say nothing about stored output.
				const outputKeys = [...resultKeys].filter((key) => key !== 'error' && key !== 'lastUsage')
				const hasOutput =
					outputKeys.length === 0 || outputKeys.some((key) => nodeValue[key] !== defaults[key])
				if (hasOutput) {
					const cachedOutputs = toExecutionResult(getNodeOutputPortInfo(this.editor, nodeId))
					this.nodesById.set(nodeId, { ...node, state: 'executed', outputs: cachedOutputs })
					setNodeRun(this.editor, nodeId, { status: 'ok', message: 'cached' })
					const dependents = []
					for (const connection of Object.values(node.connections)) {
						if (!connection || connection.terminal !== 'start') continue
						if (isFeedbackEnd(this.editor, connection.connectedShapeId, connection.connectedPortId)) continue
						dependents.push(this.executeNodeIfReady(connection.connectedShapeId))
					}
					await Promise.all(dependents)
					return
				}
			}
		}

		this.nodesById.set(nodeId, {
			...node,
			state: 'executing',
		})
		setNodeRun(this.editor, nodeId, { status: 'running' })
		const started = performance.now()

		this.editor.updateShape({
			id: nodeId,
			type: node.shape.type,
			props: { isOutOfDate: true },
		})
		let outputs: ExecutionResult
		let caught = false
		try {
			outputs = await executeNode(this.editor, node.shape, inputs)
		} catch (error) {
			caught = true
			outputs = { output: STOP_EXECUTION }
			setNodeRun(this.editor, nodeId, {
				status: 'error',
				message: runErrorMessage(error),
				ms: Math.round(performance.now() - started),
			})
		}
		this.editor.updateShape({
			id: nodeId,
			type: node.shape.type,
			props: { isOutOfDate: false },
		})

		this.nodesById.set(nodeId, {
			...node,
			state: 'executed',
			outputs,
		})

		const fresh = this.editor.getShape(nodeId)
		const storedError =
			fresh && this.editor.isShapeOfType(fresh, 'node')
				? (fresh.props.node as { error?: unknown }).error
				: undefined
		const nodeError = typeof storedError === 'string' && storedError.trim() ? storedError : ''
		const failed =
			!!nodeError ||
			(Object.keys(outputs).length > 0 && Object.values(outputs).every((value) => value === STOP_EXECUTION))
		const ms = Math.round(performance.now() - started)
		if (!caught) {
			setNodeRun(this.editor, nodeId, {
				status: failed ? 'error' : 'ok',
				message: nodeError || undefined,
				ms,
			})
			if (hash !== undefined && !failed) {
				// Hash the settings as they are after the run: some cards copy their input into a
				// field (Chart keeps the table text), so the pre-run hash would never match again.
				const after = this.editor.getShape<NodeShape>(nodeId)
				const settledHash = after ? cacheHashFor(this.editor, after, inputs) : hash
				this.editor.updateShape({ id: nodeId, type: node.shape.type, props: { lastRunHash: settledHash } })
			}
		}

		if (!failed) {
			const shapeNow = this.editor.getShape(nodeId)
			if (shapeNow && this.editor.isShapeOfType(shapeNow, 'node')) {
				await spillUnconnectedOutput(this.editor, shapeNow, outputs).catch((error) =>
					console.warn('Placing the node output failed:', error)
				)
			}
		}

		// Results to the canvas through tldraw arrows (node → shape).
		await writeArrowOutputs(this.editor, nodeId, outputs).catch((e) =>
			console.warn('Writing node output to canvas failed:', e)
		)

		const executingDependentPromises = []
		for (const connection of Object.values(node.connections)) {
			if (!connection || connection.terminal !== 'start') continue
			if (isFeedbackEnd(this.editor, connection.connectedShapeId, connection.connectedPortId)) continue

			executingDependentPromises.push(this.executeNodeIfReady(connection.connectedShapeId))
		}

		await Promise.all(executingDependentPromises)
	}

	getNodeStatus(nodeId: TLShapeId) {
		return this.nodesById.get(nodeId)?.state
	}
}

/** The run-cache key of a card: its settings (all node fields except results) and its inputs. */
function cacheHashFor(editor: Editor, shape: NodeShape, inputs: unknown): string {
	const nodeValue = shape.props.node as unknown as Record<string, unknown>
	const resultKeys = new Set(getNodeDefinition(editor, shape.props.node).resultKeys ?? [])
	const settings: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(nodeValue)) {
		if (!resultKeys.has(key)) settings[key] = value
	}
	return runHash({ settings, inputs })
}
