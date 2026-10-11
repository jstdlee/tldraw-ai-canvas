/**
 * Leaf module: whether a port has a wire, read straight from the bindings. Split out of
 * `nodePorts.tsx` so `nodeTypes.tsx` (which `nodePorts.tsx` itself imports) can use it too,
 * without a circular import between the two.
 */
import { Editor, TLShapeId } from 'tldraw'

/**
 * Whether an input port has a wire, read straight from the bindings. Safe to call from a
 * definition's getPorts / getBodyHeightPx (unlike getNodeInputPortValues, which needs the ports).
 */
export function isInputWired(editor: Editor, shapeId: TLShapeId | undefined, portId: string): boolean {
	// Port previews (the wire-drop picker) ask about a card that does not exist yet: no wires.
	if (!shapeId || !editor.getShape(shapeId)) return false
	return editor.getBindingsToShape(shapeId, 'connection').some((binding) => {
		const props = binding.props as { terminal?: string; portId?: string }
		return props.terminal === 'end' && props.portId === portId
	})
}
