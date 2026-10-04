import { AtomMap, Editor, TLShapeId } from 'tldraw'
import {
	getNodeOutputPortInfo,
	getNodePortConnections,
	getNodePorts,
	NodePortConnection,
} from '../nodes/nodePorts'
import { NodeShape } from '../nodes/NodeShapeUtil'
import { executeNode } from '../nodes/nodeTypes'
import { ExecutionResult, PipelineValue, STOP_EXECUTION } from '../nodes/types/shared'
import { getArrowInputs, writeArrowOutputs } from './arrows'

export interface ExecutionGraphOptions {
	/** Only these nodes may run (loop bodies, packed groups). */
	allowed?: Set<TLShapeId>
	/** Fixed input values, keyed `${nodeId}|${portId}` (loop item, packed-group inputs). */
	overrides?: Map<string, PipelineValue>
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

		this.nodesById.set(nodeId, {
			...node,
			state: 'executing',
		})

		this.editor.updateShape({
			id: nodeId,
			type: node.shape.type,
			props: { isOutOfDate: true },
		})
		const outputs = await executeNode(this.editor, node.shape, inputs)
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
