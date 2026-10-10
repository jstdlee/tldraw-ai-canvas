import { ShapePort } from './Port'

/**
 * Can a value from an output of type `outputType` flow into an input of type
 * `inputType`? Mostly symmetric (same type, or either side 'any'), with two
 * one-way exceptions: a piece of text can be an image URL, so text → image is
 * allowed (image → text is not: an image isn't a piece of text); and a plain
 * model id is text, so text → model is allowed (model → text is not: a model
 * reference may be an ad-hoc provider, not just an id).
 */
export function arePortDataTypesCompatible(
	outputType: ShapePort['dataType'],
	inputType: ShapePort['dataType']
) {
	if (outputType === 'any' || inputType === 'any') return true
	if (outputType === inputType) return true
	if (outputType !== 'text') return false
	return inputType === 'image' || inputType === 'model'
}

export function findFirstCompatiblePort(
	ports: ShapePort[],
	terminal: ShapePort['terminal'],
	dataType: ShapePort['dataType']
) {
	// `terminal` is the port we are looking for on the new/other node; `dataType`
	// is the type at the far end of the wire already being dragged. When we're
	// looking for an 'end' (input) port, the wire's `dataType` is the source
	// (output) type; when looking for a 'start' (output) port, it's the target
	// (input) type. Either way, call arePortDataTypesCompatible(output, input).
	const candidates = ports.filter((port) => {
		if (port.terminal !== terminal) return false
		return terminal === 'end'
			? arePortDataTypesCompatible(dataType, port.dataType)
			: arePortDataTypesCompatible(port.dataType, dataType)
	})
	// Prefer an exact type match over an 'any' match so that e.g. a text
	// source connects to the 'prompt' port rather than a generic 'any' port.
	return (
		candidates.find((port) => port.dataType === dataType) ??
		candidates.find((port) => port.dataType === 'any' || dataType === 'any') ??
		candidates[0]
	)
}
