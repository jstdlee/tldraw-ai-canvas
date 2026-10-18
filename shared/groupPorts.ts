/**
 * Pure port-model logic for "groups as boxes" (WP4): given the shapes inside a
 * group (its members) and the ports/wires that touch them, work out which
 * ports the box around them should expose. No tldraw import, so it is
 * testable in Node.
 */

export interface InnerPort {
	nodeId: string
	nodeLabel: string
	portId: string
	terminal: 'start' | 'end'
	dataType: string
}

export interface InnerWire {
	fromNode: string
	fromPort: string
	toNode: string
	toPort: string
}

export interface GroupPort {
	id: string
	label: string
	dataType: string
	nodeId: string
	portId: string
}

/** The part of a shape id after "shape:", used to build stable port ids. */
function idSuffix(nodeId: string): string {
	const i = nodeId.indexOf(':')
	return i >= 0 ? nodeId.slice(i + 1) : nodeId
}

/** `<node label or type title> · <port label>`, or just the node label when it has one port of that kind. */
function portLabel(nodeLabel: string, portId: string, portsOfThatKindOnNode: number): string {
	return portsOfThatKindOnNode <= 1 ? nodeLabel : `${nodeLabel} · ${portId}`
}

/** A wirable-field port (WP17), as opposed to a card's own dedicated port. */
function isFieldPort(portId: string): boolean {
	return portId.startsWith('field:')
}

/**
 * Members: node ids inside the group, sorted top-to-bottom then left-to-right
 * (the caller sorts; this function only preserves order). Ports: every port of
 * every member node. Wires: every wire that touches a member, on either end
 * (the other end may be outside the group).
 */
export function computeGroupPorts(
	members: string[],
	ports: InnerPort[],
	wires: InnerWire[]
): { inputs: GroupPort[]; outputs: GroupPort[] } {
	const memberSet = new Set(members)

	const portsByMember = new Map<string, InnerPort[]>()
	for (const port of ports) {
		if (!memberSet.has(port.nodeId)) continue
		const list = portsByMember.get(port.nodeId)
		if (list) list.push(port)
		else portsByMember.set(port.nodeId, [port])
	}

	const inputs: GroupPort[] = []
	const outputs: GroupPort[] = []

	for (const nodeId of members) {
		const nodePorts = portsByMember.get(nodeId) ?? []
		const nodeInputs = nodePorts.filter((p) => p.terminal === 'end')
		const nodeOutputs = nodePorts.filter((p) => p.terminal === 'start')

		for (const port of nodeInputs) {
			// Rule 1: hidden only when fed by another member.
			const fedByMember = wires.some(
				(w) => w.toNode === nodeId && w.toPort === port.portId && memberSet.has(w.fromNode)
			)
			if (fedByMember) continue
			// FLOW-05: a field port (a card's own wirable *setting*, not its main data port)
			// only joins the box's interface when something outside the group is already wired
			// into it — otherwise every member's every unconnected setting (DataPipe's "Tool",
			// Text tools' "Param A"/"Param B", …) floods a packed box with noise. A dedicated
			// port stays exposed either way, wired or not (that's still "the one or two ports
			// that matter" at the boundary).
			if (isFieldPort(port.portId)) {
				const wiredFromOutside = wires.some(
					(w) => w.toNode === nodeId && w.toPort === port.portId && !memberSet.has(w.fromNode)
				)
				if (!wiredFromOutside) continue
			}
			inputs.push({
				id: `i:${idSuffix(nodeId)}:${port.portId}`,
				label: portLabel(port.nodeLabel, port.portId, nodeInputs.length),
				dataType: port.dataType,
				nodeId,
				portId: port.portId,
			})
		}

		for (const port of nodeOutputs) {
			// Rule 2: hidden only when every wire from this output feeds another member.
			const outWires = wires.filter((w) => w.fromNode === nodeId && w.fromPort === port.portId)
			const onlyFeedsMembers = outWires.length > 0 && outWires.every((w) => memberSet.has(w.toNode))
			if (onlyFeedsMembers) continue
			outputs.push({
				id: `o:${idSuffix(nodeId)}:${port.portId}`,
				label: portLabel(port.nodeLabel, port.portId, nodeOutputs.length),
				dataType: port.dataType,
				nodeId,
				portId: port.portId,
			})
		}
	}

	return { inputs, outputs }
}
