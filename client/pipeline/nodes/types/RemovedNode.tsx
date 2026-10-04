import { T } from 'tldraw'
import { NODE_HEADER_HEIGHT_PX, NODE_ROW_HEIGHT_PX, NODE_WIDTH_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { NodeShape } from '../NodeShapeUtil'
import {
	ExecutionResult,
	InfoValues,
	NodeDefinition,
	NodeDefinitionConstructor,
	NodeRow,
	STOP_EXECUTION,
} from './shared'

/**
 * Node types that were removed from the app (AI image generation, old preview
 * nodes). Canvases saved earlier may still contain them; this keeps those
 * canvases loading and shows a card the user can delete.
 */
export function removedNodeDefinition<Type extends string>(
	type: Type,
	oldTitle: string
): NodeDefinitionConstructor<{ type: Type }> & { readonly validator: T.ObjectValidator<{ type: Type }> } {
	type RemovedNode = { type: Type }
	const validator = T.object({ type: T.literal(type) }).allowUnknownProperties() as unknown as T.ObjectValidator<RemovedNode>

	return class RemovedNodeDefinition extends NodeDefinition<RemovedNode> {
		static type = type
		static validator = validator
		title = `${oldTitle} (removed)`
		heading = `${oldTitle} (removed)`
		icon = (
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
				<circle cx="8" cy="8" r="6" />
				<path d="M4 12 12 4" />
			</svg>
		)
		category = 'removed'
		override hidden = true
		getDefault(): RemovedNode {
			return { type } as RemovedNode
		}
		getBodyHeightPx() {
			return NODE_ROW_HEIGHT_PX
		}
		getPorts(): Record<string, ShapePort> {
			return {
				output: {
					id: 'output',
					x: NODE_WIDTH_PX,
					y: NODE_HEADER_HEIGHT_PX / 2,
					terminal: 'start',
					dataType: 'any',
				},
			}
		}
		async execute(): Promise<ExecutionResult> {
			return { output: STOP_EXECUTION }
		}
		getOutputInfo(shape: NodeShape): InfoValues {
			return { output: { value: STOP_EXECUTION, isOutOfDate: shape.props.isOutOfDate, dataType: 'any' } }
		}
		Component = () => (
			<NodeRow>
				<span className="NodeRow-disconnected">This node type was removed. Delete it.</span>
			</NodeRow>
		)
	}
}
