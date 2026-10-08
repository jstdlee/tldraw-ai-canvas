/**
 * Code-node port naming. Ports have stable ids (in1…inN, output, out2…outN) so
 * renaming never breaks a wire; the names are a separate label/variable layer.
 * Pure and shared so the node card and tests agree.
 */

/** Ports cap at 20 in and 20 out. */
export const MAX_CODE_PORTS = 20

/** Stable port id for an input slot (rename-safe). */
export const codeInputId = (i: number): string => `in${i + 1}`

/** Stable port id for an output slot. First output keeps the legacy id "output". */
export const codeOutputId = (i: number): string => (i === 0 ? 'output' : `out${i + 1}`)

/** Default input variable name: a, b, c … */
export const defaultInputName = (i: number): string => String.fromCharCode(97 + (i % 26))

/** Default output variable name matches its port id. */
export const defaultOutputName = (i: number): string => codeOutputId(i)

/** Clamp a requested port count to 1–20. */
export function clampCodeCount(n: number): number {
	return Math.max(1, Math.min(MAX_CODE_PORTS, Math.round(n) || 1))
}

/** True when the text is a usable JS/Python identifier. */
export function isIdentifier(name: string): boolean {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
}

/** A usable JS/Python identifier, or null when the text is not one. */
export function cleanCodeName(name: string | undefined | null): string | null {
	if (!name) return null
	const trimmed = name.trim()
	return isIdentifier(trimmed) ? trimmed : null
}

/** Variable name for each input slot: the custom name when valid, else the default. */
export function codeInputNames(inputCount: number, inputNames?: (string | undefined)[]): string[] {
	return Array.from({ length: clampCodeCount(inputCount) }, (_, i) => cleanCodeName(inputNames?.[i]) ?? defaultInputName(i))
}

/** Output key for each slot: the custom name when valid, else the default. */
export function codeOutputNames(outputCount: number, outputNames?: (string | undefined)[]): string[] {
	return Array.from({ length: clampCodeCount(outputCount) }, (_, i) => cleanCodeName(outputNames?.[i]) ?? defaultOutputName(i))
}
