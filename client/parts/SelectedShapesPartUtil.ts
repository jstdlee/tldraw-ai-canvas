import { structuredClone, TLShapeId } from 'tldraw'
import { convertTldrawIdToSimpleId } from '../../shared/format/convertTldrawShapeToFocusedShape'
import { NODE_SPECS } from '../../shared/nodeSpecs'
import { SelectedCardInfo, SelectedShapesPart } from '../../shared/schema/PromptPartDefinitions'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { describeCanvasNode } from '../pipeline/aiContext'
import { getNodePortConnections } from '../pipeline/nodes/nodePorts'
import type { NodeShape } from '../pipeline/nodes/NodeShapeUtil'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

export const SelectedShapesPartUtil = registerPromptPartUtil(
	class SelectedShapesPartUtil extends PromptPartUtil<SelectedShapesPart> {
		static override type = 'selectedShapes' as const

		override getPart(_request: AgentRequest): SelectedShapesPart {
			const { editor } = this

			const userSelectedShapes = editor.getSelectedShapes().map((v) => structuredClone(v)) ?? []

			// WP48: a selected card is described in full, so the one agent can choose fill-card
			// (this card's fields) or build-workflow (new cards, wires) instead of drawing shapes.
			const cards: SelectedCardInfo[] = []
			for (const shape of userSelectedShapes) {
				if (shape.type !== 'node' || cards.length >= 8) continue
				try {
					const ctx = describeCanvasNode(editor, shape as NodeShape)
					const simple = (id: TLShapeId) => convertTldrawIdToSimpleId(id)
					const wires = getNodePortConnections(editor, shape.id).map((c) =>
						c.terminal === 'end'
							? `${c.ownPortId} <- ${simple(c.connectedShapeId)}.${c.connectedPortId}`
							: `${c.ownPortId} -> ${simple(c.connectedShapeId)}.${c.connectedPortId}`
					)
					cards.push({
						id: simple(shape.id),
						type: ctx.type,
						title: NODE_SPECS[ctx.type]?.title ?? ctx.type,
						...(ctx.label && ctx.label !== ctx.type ? { label: ctx.label } : {}),
						fields: ctx.props,
						inputs: ctx.inputs,
						outputs: ctx.outputs,
						wires,
						...(ctx.error ? { error: ctx.error } : {}),
					})
				} catch {
					// A card that cannot be described is still listed by id above.
				}
			}

			return {
				type: 'selectedShapes',
				shapeIds: userSelectedShapes.map((shape) => convertTldrawIdToSimpleId(shape.id)),
				...(cards.length ? { cards } : {}),
			}
		}
	}
)
