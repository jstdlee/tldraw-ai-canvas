import { Box, createShapeId, Editor, TLGroupShape, TLShape, TLShapeId } from 'tldraw'
import { computeGroupPorts, GroupPort, InnerPort, InnerWire } from '../../shared/groupPorts'
import { findFreeSpot, placeLeftOf, placeRightOf } from '../../shared/placement'
import { createOrUpdateConnectionBinding, getConnectionBindings } from './connection/ConnectionBindingUtil'
import { getNodePortConnections, getNodePorts } from './nodes/nodePorts'
import { getNodeDefinition } from './nodes/definitionStore'
import type { NodeShape } from './nodes/NodeShapeUtil'
import type { SubgraphNode, SubgraphPort } from './nodes/types/SubgraphNode'
import { PortDataType } from './constants'
import { storeBlob } from './imageOps'

/**
 * A group as a box (feedback #3/#4): "Box" = a packed node (`node.type === 'subgraph'`).
 * "Members" = the shapes inside it (`node.innerIds`, hidden with `meta.packedIn = boxId`).
 * "Open group" = members visible on the canvas, wrapped in a native tldraw `group` shape
 * that remembers its box (`group.meta.boxOf = boxId`); the box itself is hidden
 * (`meta.boxOpen = groupId`) while open.
 */

export function isPacked(shape: TLShape) {
	return typeof shape.meta?.packedIn === 'string'
}

/** True for a box that is currently open (hidden in favour of its member group). */
export function isBoxOpen(shape: TLShape) {
	return typeof shape.meta?.boxOpen === 'string'
}

/**
 * Show shapes whose packed node no longer exists (e.g. it was deleted), and boxes
 * whose open group no longer exists, so nothing stays invisible by accident.
 */
export function releaseOrphanedPackedShapes(editor: Editor) {
	const shapes = editor.getCurrentPageShapes()
	const orphanMembers = shapes.filter((s) => isPacked(s) && !editor.getShape(s.meta.packedIn as TLShapeId))
	if (orphanMembers.length) {
		editor.updateShapes(orphanMembers.map((s) => ({ id: s.id, type: s.type, meta: { ...s.meta, packedIn: null } })))
	}
	const orphanBoxes = shapes.filter((s) => isBoxOpen(s) && !editor.getShape(s.meta.boxOpen as TLShapeId))
	if (orphanBoxes.length) {
		editor.updateShapes(orphanBoxes.map((s) => ({ id: s.id, type: s.type, meta: { ...s.meta, boxOpen: null } })))
	}
}

/** Keep that true while editing: deleting a box or its open group releases/restores shapes. */
export function watchPackedNodes(editor: Editor) {
	releaseOrphanedPackedShapes(editor)
	return editor.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
		const isBox = shape.type === 'node' && (shape.props as { node?: { type?: string } }).node?.type === 'subgraph'
		if (isBox || shape.type === 'group') {
			queueMicrotask(() => releaseOrphanedPackedShapes(editor))
		}
	})
}

// ---------------------------------------------------------------------------
// Shared helpers: port model, wiring, thumbnail, sorting
// ---------------------------------------------------------------------------

function nodeLabelOf(editor: Editor, node: NodeShape): string {
	const custom = node.props.label
	if (typeof custom === 'string' && custom.trim()) return custom.trim()
	const def = getNodeDefinition(editor, node.props.node)
	return def.heading ?? def.title
}

function toInnerPorts(editor: Editor, nodeId: TLShapeId): InnerPort[] {
	const shape = editor.getShape<NodeShape>(nodeId)
	if (!shape) return []
	const nodeLabel = nodeLabelOf(editor, shape)
	return Object.values(getNodePorts(editor, shape)).map((p) => ({
		nodeId,
		nodeLabel,
		portId: p.id,
		terminal: p.terminal,
		dataType: p.dataType,
	}))
}

/** Every wire touching a member, on either end (the other end may be outside the group). */
function collectInnerWires(editor: Editor, members: TLShapeId[]): InnerWire[] {
	const wires: InnerWire[] = []
	for (const id of members) {
		for (const c of getNodePortConnections(editor, id)) {
			if (c.terminal === 'start') {
				wires.push({ fromNode: id, fromPort: c.ownPortId, toNode: c.connectedShapeId, toPort: c.connectedPortId })
			} else {
				wires.push({ fromNode: c.connectedShapeId, fromPort: c.connectedPortId, toNode: id, toPort: c.ownPortId })
			}
		}
	}
	return wires
}

/** Connection shapes with both ends inside `members` (for the thumbnail and grouping). */
function internalConnectionIds(editor: Editor, members: TLShapeId[]): TLShapeId[] {
	const memberSet = new Set(members)
	const ids = new Set<TLShapeId>()
	for (const id of members) {
		for (const c of getNodePortConnections(editor, id)) {
			if (memberSet.has(c.connectedShapeId)) ids.add(c.connectionId)
		}
	}
	return [...ids]
}

/** Top-to-bottom, then left-to-right, by page position. */
function sortedMembers(editor: Editor, members: TLShapeId[]): TLShapeId[] {
	return [...members].sort((a, b) => {
		const pa = editor.getShapePageBounds(a)
		const pb = editor.getShapePageBounds(b)
		if (!pa || !pb) return 0
		return pa.y - pb.y || pa.x - pb.x
	})
}

function toSubgraphPort(p: GroupPort): SubgraphPort {
	return { id: p.id, label: p.label, dataType: p.dataType as PortDataType, nodeId: p.nodeId, portId: p.portId }
}

function unionPageBounds(editor: Editor, ids: TLShapeId[]): Box | null {
	let result: Box | null = null
	for (const id of ids) {
		const b = editor.getShapePageBounds(id)
		if (!b) continue
		result = result ? result.union(b) : b.clone()
	}
	return result
}

/** Page bounds of every visible shape that is not excluded and not a wire. */
function takenBoxesExcluding(editor: Editor, excludeIds: Set<TLShapeId>) {
	const boxes: { x: number; y: number; w: number; h: number }[] = []
	for (const shape of editor.getCurrentPageShapes()) {
		if (excludeIds.has(shape.id)) continue
		if (shape.type === 'connection') continue
		if (isPacked(shape) || isBoxOpen(shape)) continue
		const bounds = editor.getShapePageBounds(shape.id)
		if (!bounds) continue
		boxes.push({ x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height })
	}
	return boxes
}

/**
 * Move a box to a free spot near `want` (its members' own bounds), so it never lands on
 * top of a shape left outside it. When it has to move, prefer a spot to the right of its
 * upstream sources, then to the left of its downstream targets, so wires keep flowing
 * forward instead of running backwards; otherwise fall back to the generic free-spot search.
 */
function placeBoxFreely(editor: Editor, boxId: TLShapeId, memberIds: TLShapeId[], want: { x: number; y: number }) {
	const bounds = editor.getShapePageBounds(boxId)
	if (!bounds) return
	const exclude = new Set<TLShapeId>([boxId, ...memberIds])
	const taken = takenBoxesExcluding(editor, exclude)
	const size = { w: bounds.width, h: bounds.height }
	let spot = findFreeSpot(want, size, taken)
	if (spot.x !== want.x || spot.y !== want.y) {
		const connections = getNodePortConnections(editor, boxId)
		const upstream = unionPageBounds(
			editor,
			connections.filter((c) => c.terminal === 'end').map((c) => c.connectedShapeId)
		)
		const downstream = unionPageBounds(
			editor,
			connections.filter((c) => c.terminal === 'start').map((c) => c.connectedShapeId)
		)
		if (upstream) {
			spot = placeRightOf({ x: upstream.x, y: upstream.y, w: upstream.width, h: upstream.height }, size, taken)
		} else if (downstream) {
			spot = placeLeftOf({ x: downstream.x, y: downstream.y, w: downstream.width, h: downstream.height }, size, taken)
		}
	}
	if (spot.x !== bounds.x || spot.y !== bounds.y) {
		editor.updateShape({ id: boxId, type: 'node', x: spot.x, y: spot.y })
	}
}

/**
 * Rebind every boundary wire (one end a member, the other outside) onto the box's
 * matching port. A boundary wire whose port the new port model no longer exposes
 * (should only happen for an edge case like a feedback/multi port) is removed
 * instead, and counted so the caller can tell the user.
 */
function rewireBoundary(
	editor: Editor,
	boxId: TLShapeId,
	members: TLShapeId[],
	inputs: SubgraphPort[],
	outputs: SubgraphPort[]
): number {
	const memberSet = new Set(members)
	const byKey = new Map<string, SubgraphPort>()
	for (const p of inputs) byKey.set(`end:${p.nodeId}:${p.portId}`, p)
	for (const p of outputs) byKey.set(`start:${p.nodeId}:${p.portId}`, p)

	// Read every boundary connection before changing anything, so later lookups in this
	// loop are never based on a binding this same pass already rebound.
	const toRebind: { connectionId: TLShapeId; terminal: 'start' | 'end'; port: SubgraphPort }[] = []
	const toDelete: TLShapeId[] = []
	for (const id of members) {
		for (const c of getNodePortConnections(editor, id)) {
			if (memberSet.has(c.connectedShapeId)) continue // internal: stays wired directly, no box port
			const port = byKey.get(`${c.terminal}:${id}:${c.ownPortId}`)
			if (!port) toDelete.push(c.connectionId)
			else toRebind.push({ connectionId: c.connectionId, terminal: c.terminal, port })
		}
	}

	for (const { connectionId, terminal, port } of toRebind) {
		const binding = getConnectionBindings(editor, connectionId)[terminal]
		createOrUpdateConnectionBinding(editor, connectionId, boxId, {
			portId: port.id,
			terminal,
			order: binding?.props.order,
		})
	}
	if (toDelete.length) editor.deleteShapes(toDelete)
	return toDelete.length
}

interface PreparedCollapse {
	members: TLShapeId[]
	inputs: SubgraphPort[]
	outputs: SubgraphPort[]
	thumbnail: string | null
	/** Connection shapes fully inside the group: hidden with the members. */
	connectionIds: TLShapeId[]
	/** Non-card shapes collapsed with the cards (no ports): hidden with the members. */
	extraIds: TLShapeId[]
}

/** Compute the new port model and a fresh thumbnail. Does not mutate the document. */
async function prepareCollapse(
	editor: Editor,
	memberIds: TLShapeId[],
	extraIds: TLShapeId[] = []
): Promise<PreparedCollapse> {
	const members = sortedMembers(editor, memberIds)
	const ports = members.flatMap((id) => toInnerPorts(editor, id))
	const wires = collectInnerWires(editor, members)
	const { inputs: gInputs, outputs: gOutputs } = computeGroupPorts(members, ports, wires)
	const inputs = gInputs.map(toSubgraphPort)
	const outputs = gOutputs.map(toSubgraphPort)

	const connectionIds = internalConnectionIds(editor, members)
	let thumbnail: string | null = null
	try {
		const { blob } = await editor.toImage([...topLevelIds(editor, [...members, ...extraIds]), ...connectionIds], {
			format: 'png',
			background: true,
			scale: 0.5,
			padding: 8,
		})
		thumbnail = await storeBlob(blob)
	} catch {
		// A box without a picture still works.
	}

	return { members, inputs, outputs, thumbnail, connectionIds, extraIds }
}

/**
 * Apply a prepared collapse: rewire boundary wires, hide members (and the internal wires
 * between them, so no loose wire is left drawn on the canvas), update the box, and place it
 * in a free spot so it never lands on top of a shape that stayed outside it. Synchronous.
 */
function applyCollapse(editor: Editor, boxId: TLShapeId, prepared: PreparedCollapse): number {
	const { members, inputs, outputs, thumbnail, connectionIds, extraIds } = prepared
	const removedWires = rewireBoundary(editor, boxId, members, inputs, outputs)

	editor.updateShapes(
		[...members, ...connectionIds, ...extraIds].map((id) => {
			const shape = editor.getShape(id)!
			return { id, type: shape.type, meta: { ...shape.meta, packedIn: boxId } }
		})
	)

	const box = editor.getShape<NodeShape>(boxId)!
	const node = box.props.node as SubgraphNode
	const bounds = unionPageBounds(editor, [...members, ...extraIds])
	const want = bounds ? { x: bounds.x, y: bounds.y } : { x: box.x, y: box.y }
	editor.updateShape<NodeShape>({
		id: boxId,
		type: 'node',
		x: want.x,
		y: want.y,
		meta: { ...box.meta, boxOpen: null },
		props: {
			node: {
				...node,
				innerIds: members,
				inputs,
				outputs,
				thumbnail,
				connectionIds,
				extraIds,
				lastOutputs: null,
				error: null,
			},
			isOutOfDate: true,
		},
	})
	placeBoxFreely(editor, boxId, [...members, ...extraIds], want)
	// Remember where the box landed: Expand puts the members back at the same offset from it,
	// so Collapse → Expand restores every position exactly, and moving the box moves them too.
	const placed = editor.getShape<NodeShape>(boxId)!
	editor.updateShape<NodeShape>({ id: boxId, type: 'node', meta: { ...placed.meta, boxAt: { x: placed.x, y: placed.y } } })
	return removedWires
}

/** Of `ids`, the ones not inside another shape of `ids` (e.g. a card inside a collapsed nested group). */
function topLevelIds(editor: Editor, ids: TLShapeId[]): TLShapeId[] {
	const set = new Set(ids)
	return ids.filter((id) => {
		let parent = editor.getShape(id)?.parentId
		while (parent) {
			if (set.has(parent as TLShapeId)) return false
			parent = editor.getShape(parent as TLShapeId)?.parentId
		}
		return true
	})
}

/** Group `ids` (one shape is fine too: tldraw's groupShapes needs two). */
function groupAll(editor: Editor, ids: TLShapeId[], groupId: TLShapeId) {
	if (ids.length >= 2) {
		editor.groupShapes(ids, { groupId, select: false })
		return
	}
	const bounds = unionPageBounds(editor, ids)
	if (!bounds) return
	editor.createShape<TLGroupShape>({ id: groupId, type: 'group', parentId: editor.getCurrentPageId(), x: bounds.x, y: bounds.y })
	editor.reparentShapes(ids, groupId)
}

/** Leave the group you dived into when it (or a group around it) is about to go away. */
function leaveFocusOf(editor: Editor, groupId: TLShapeId) {
	const focused = editor.getFocusedGroupId()
	if (focused === groupId || editor.hasAncestor(focused as TLShapeId, groupId)) {
		const group = editor.getShape(groupId)
		editor.setFocusedGroup(group && editor.getShape(group.parentId)?.type === 'group' ? (group.parentId as TLShapeId) : null)
	}
}

/**
 * What a selection collapses into: cards (members: they get ports and run) and other
 * shapes (extras: hidden and restored with them, no ports). Cards inside a selected
 * nested group or frame are members too; wires are never picked, they follow their cards.
 */
function splitMembers(editor: Editor, ids: TLShapeId[]) {
	const members: TLShapeId[] = []
	const extras: TLShapeId[] = []
	for (const id of ids) {
		const shape = editor.getShape(id)
		if (!shape || isPacked(shape) || shape.type === 'connection') continue
		if (shape.type === 'node') {
			members.push(id)
			continue
		}
		extras.push(id)
		for (const d of editor.getShapeAndDescendantIds([id])) {
			if (d !== id && editor.getShape(d)?.type === 'node') members.push(d)
		}
	}
	return { members, extras }
}

// ---------------------------------------------------------------------------
// Pack / open / close
// ---------------------------------------------------------------------------

/** Turn a selection of nodes into one box. */
export async function packSelection(editor: Editor): Promise<TLShapeId | null> {
	const { members: memberIds, extras } = splitMembers(editor, editor.getSelectedShapeIds())
	if (memberIds.length < 1) return null

	const bounds = editor.getSelectionPageBounds()!
	const prepared = await prepareCollapse(editor, memberIds, extras)

	const proxyId = createShapeId()
	editor.run(() => {
		editor.markHistoryStoppingPoint('group as box')
		const node: SubgraphNode = {
			type: 'subgraph',
			title: `Group (${memberIds.length} card${memberIds.length === 1 ? '' : 's'})`,
			innerIds: [],
			inputs: [],
			outputs: [],
			thumbnail: null,
			lastOutputs: null,
			error: null,
		}
		editor.createShape({
			id: proxyId,
			type: 'node',
			parentId: editor.getCurrentPageId(),
			x: bounds.minX,
			y: bounds.minY,
			props: { node, isOutOfDate: true },
		})
		applyCollapse(editor, proxyId, prepared)
		editor.select(proxyId)
	})
	// Re-assert the selection one frame later: a slow toImage() export, or the context menu
	// closing, can otherwise leave the old (now hidden) member selection in place.
	editor.timers.requestAnimationFrame(() => {
		if (editor.getShape(proxyId)) editor.select(proxyId)
	})
	return proxyId
}

/** Ungroup a box: members stay visible where the box was, the box is deleted. */
export function unpack(editor: Editor, proxyId: TLShapeId) {
	const proxy = editor.getShape<NodeShape>(proxyId)
	if (!proxy || proxy.props.node.type !== 'subgraph') return
	const node = proxy.props.node as SubgraphNode
	const byPort = new Map([...node.inputs, ...node.outputs].map((p) => [p.id, p]))
	editor.run(() => {
		editor.markHistoryStoppingPoint('ungroup box')
		// Unhide first so wires can bind to the inner nodes again.
		const ids = node.innerIds.filter((id) => editor.getShape(id as TLShapeId)) as TLShapeId[]
		const connectionIds = (node.connectionIds ?? []).filter((id) => editor.getShape(id as TLShapeId)) as TLShapeId[]
		const extraIds = (node.extraIds ?? []).filter((id) => editor.getShape(id as TLShapeId)) as TLShapeId[]
		editor.updateShapes(
			[...ids, ...connectionIds, ...extraIds].map((id) => {
				const shape = editor.getShape(id)!
				// meta updates merge, so the key must be set to null (not left out).
				return { id, type: shape.type, meta: { ...shape.meta, packedIn: null } }
			})
		)
		for (const c of getNodePortConnections(editor, proxyId)) {
			const target = byPort.get(c.ownPortId)
			if (!target || !editor.getShape(target.nodeId as TLShapeId)) continue
			const binding = getConnectionBindings(editor, c.connectionId)[c.terminal]
			createOrUpdateConnectionBinding(editor, c.connectionId, target.nodeId as TLShapeId, {
				portId: target.portId,
				terminal: c.terminal,
				order: binding?.props.order,
			})
		}
		editor.deleteShape(proxyId)
		editor.select(...ids)
	})
}

/**
 * Expand a box in place: its cards (and the other shapes collapsed with them) come back
 * inside a group with the box's label, at the same offset from the box as when it was
 * collapsed. The box stays hidden, remembered by the group (`meta.boxOf`), so Collapse
 * puts the cards back into the same box.
 */
export function openGroup(editor: Editor, boxId: TLShapeId): TLShapeId | null {
	const box = editor.getShape<NodeShape>(boxId)
	if (!box || box.props.node.type !== 'subgraph') return null
	const node = box.props.node as SubgraphNode
	const exists = (id: string) => !!editor.getShape(id as TLShapeId)
	const members = node.innerIds.filter(exists) as TLShapeId[]
	const extraIds = (node.extraIds ?? []).filter(exists) as TLShapeId[]
	if (!members.length && !extraIds.length) return null
	const connectionIds = (node.connectionIds ?? []).filter(exists) as TLShapeId[]
	const byPort = new Map([...node.inputs, ...node.outputs].map((p) => [p.id, p]))
	// Shapes that sit directly on the page (cards inside a collapsed nested group move with it).
	const top = topLevelIds(editor, [...members, ...extraIds])

	let groupId: TLShapeId | null = null
	editor.run(() => {
		editor.markHistoryStoppingPoint('open group')

		// 1-2: put the shapes back as one block (keep their relative layout). Same offset from the
		// box as when it was collapsed; if the box was moved, never on top of a shape outside it.
		const oldBounds = unionPageBounds(editor, top)
		if (oldBounds) {
			const at = box.meta?.boxAt as { x?: unknown; y?: unknown } | undefined
			const hasAt = typeof at?.x === 'number' && typeof at?.y === 'number'
			const boxMoved = !hasAt || at!.x !== box.x || at!.y !== box.y
			const want = hasAt
				? { x: oldBounds.x + box.x - (at!.x as number), y: oldBounds.y + box.y - (at!.y as number) }
				: { x: box.x, y: box.y }
			let spot = want
			if (boxMoved) {
				const exclude = new Set<TLShapeId>([boxId, ...members, ...extraIds, ...connectionIds])
				const taken = takenBoxesExcluding(editor, exclude)
				spot = findFreeSpot(want, { w: oldBounds.width, h: oldBounds.height }, taken)
			}
			const dx = spot.x - oldBounds.x
			const dy = spot.y - oldBounds.y
			if (dx || dy) {
				editor.updateShapes(
					top.map((id) => {
						const s = editor.getShape(id)!
						return { id, type: s.type, x: s.x + dx, y: s.y + dy }
					})
				)
			}
		}

		// 3: unhide members, extras and the wires between them (connections aren't moved: their
		// bound endpoints already follow the members we just translated).
		editor.updateShapes(
			[...members, ...extraIds, ...connectionIds].map((id) => {
				const s = editor.getShape(id)!
				return { id, type: s.type, meta: { ...s.meta, packedIn: null } }
			})
		)

		// 4: rebind every wire on the box's ports to its inner target.
		for (const c of getNodePortConnections(editor, boxId)) {
			const target = byPort.get(c.ownPortId)
			if (!target || !editor.getShape(target.nodeId as TLShapeId)) continue
			const binding = getConnectionBindings(editor, c.connectionId)[c.terminal]
			createOrUpdateConnectionBinding(editor, c.connectionId, target.nodeId as TLShapeId, {
				portId: target.portId,
				terminal: c.terminal,
				order: binding?.props.order,
			})
		}

		// 5: group them and remember the box. Wires with both ends inside follow into the
		// group on their own (ConnectionBindingUtil); wires to outside cards stay on the page.
		const newGroupId = createShapeId()
		groupAll(editor, top, newGroupId)
		const label = box.props.label || node.title
		editor.updateShape<TLGroupShape>({ id: newGroupId, type: 'group', meta: { label, boxOf: boxId } })
		groupId = newGroupId

		// 6: hide the box.
		editor.updateShape<NodeShape>({ id: boxId, type: 'node', meta: { ...box.meta, boxOpen: newGroupId } })

		// 7: select, and zoom to it if it is mostly off screen.
		editor.select(newGroupId)
		const bounds = editor.getShapePageBounds(newGroupId)
		if (bounds && !editor.getViewportPageBounds().contains(bounds)) {
			editor.zoomToBounds(bounds.clone().expandBy(60), { animation: { duration: 200 } })
		}
	})
	// Re-assert one frame later, same reason as packSelection.
	editor.timers.requestAnimationFrame(() => {
		if (groupId && editor.getShape(groupId)) editor.select(groupId)
	})
	return groupId
}

/**
 * Collapse a group to one card (WP47). Its cards become the card's members (ports, run),
 * its other shapes are hidden with them, and the group's label becomes the card's title.
 * An expanded box's group goes back into that same box; any other group gets a new box.
 * Returns the box and the number of wires that had to be removed (bound to a port the
 * new port model no longer exposes), or null when there was nothing to collapse.
 */
export async function collapseGroup(
	editor: Editor,
	groupId: TLShapeId
): Promise<{ boxId: TLShapeId; removedWires: number } | null> {
	const group = editor.getShape<TLGroupShape>(groupId)
	if (!group || group.type !== 'group') return null
	const label = typeof group.meta?.label === 'string' && group.meta.label.trim() ? group.meta.label.trim() : null
	const oldBoxId = typeof group.meta?.boxOf === 'string' ? (group.meta.boxOf as TLShapeId) : null
	const oldBox = oldBoxId ? editor.getShape<NodeShape>(oldBoxId) : null
	const reuseBox = !!oldBox && oldBox.props.node.type === 'subgraph'

	// Members = the group's current cards (the user may have added or removed some while it
	// was open), extras = its other direct children. Wires are never members: they follow.
	const { members, extras } = splitMembers(editor, editor.getSortedChildIdsForParent(groupId))
	if (!members.length && !extras.length) return null

	editor.markHistoryStoppingPoint('collapse group')
	leaveFocusOf(editor, groupId)
	editor.ungroupShapes([groupId], { select: false })

	const prepared = await prepareCollapse(editor, members, extras)
	let boxId: TLShapeId
	let removedWires = 0
	editor.run(() => {
		if (reuseBox) {
			boxId = oldBoxId!
			const box = editor.getShape<NodeShape>(boxId)!
			const node = box.props.node as SubgraphNode
			// A renamed group renames its card (the default label is the card's own title).
			if (label && label !== node.title && label !== box.props.label) {
				editor.updateShape<NodeShape>({ id: boxId, type: 'node', props: { label } })
			}
		} else {
			boxId = createShapeId()
			const count = members.length
			const node: SubgraphNode = {
				type: 'subgraph',
				title: `Group (${count} card${count === 1 ? '' : 's'})`,
				innerIds: [],
				inputs: [],
				outputs: [],
				thumbnail: null,
				lastOutputs: null,
				error: null,
			}
			editor.createShape<NodeShape>({
				id: boxId,
				type: 'node',
				parentId: editor.getCurrentPageId(),
				x: 0,
				y: 0,
				props: { node, isOutOfDate: true, ...(label && label !== 'Group' ? { label } : {}) },
			})
		}
		removedWires = applyCollapse(editor, boxId, prepared)
		editor.select(boxId)
	})
	// Re-assert one frame later, same reason as packSelection.
	editor.timers.requestAnimationFrame(() => {
		if (editor.getShape(boxId)) editor.select(boxId)
	})
	return { boxId: boxId!, removedWires }
}

/** Close an expanded box's group back into its box. Returns the removed-wire count, or null. */
export async function closeGroup(editor: Editor, groupId: TLShapeId): Promise<number | null> {
	const result = await collapseGroup(editor, groupId)
	return result ? result.removedWires : null
}
