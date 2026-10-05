/** Colour looks for the Filter node and the Image tools "Look" preset. */

export interface ImageFilter {
	brightness: number
	contrast: number
	saturate: number
	hue: number
	grayscale: number
	sepia: number
	invert: number
	blur: number
	rotate: number
	flipX: boolean
	flipY: boolean
}

export const NO_FILTER: ImageFilter = {
	brightness: 100,
	contrast: 100,
	saturate: 100,
	hue: 0,
	grayscale: 0,
	sepia: 0,
	invert: 0,
	blur: 0,
	rotate: 0,
	flipX: false,
	flipY: false,
}

const COLOUR_KEYS = [
	'brightness',
	'contrast',
	'saturate',
	'hue',
	'grayscale',
	'sepia',
	'invert',
	'blur',
] as const

export const FILTER_PRESETS: Record<string, Partial<ImageFilter>> = {
	None: {},
	'B & W': { grayscale: 100, contrast: 115 },
	Vivid: { saturate: 160, contrast: 110 },
	Warm: { sepia: 35, saturate: 120 },
	Cool: { hue: 190, saturate: 80 },
	Faded: { contrast: 80, brightness: 110, saturate: 70 },
	Sketch: { grayscale: 100, contrast: 180, brightness: 120 },
	Negative: { invert: 100 },
	Soft: { blur: 2, brightness: 105 },
	'JP 90s': { contrast: 118, saturate: 78, sepia: 22, brightness: 108, hue: 8 },
	'Kodak Gold': { sepia: 28, saturate: 130, contrast: 108, brightness: 104, hue: 6 },
	'Fuji 400': { saturate: 115, contrast: 105, hue: 200, brightness: 102 },
	'Teal & orange': { contrast: 120, saturate: 140, hue: 12, sepia: 15 },
	Noir: { grayscale: 100, contrast: 150, brightness: 90 },
	Polaroid: { sepia: 25, contrast: 90, brightness: 112, saturate: 85 },
	'Bleach bypass': { saturate: 40, contrast: 140, brightness: 105 },
	Night: { brightness: 70, contrast: 130, saturate: 80, hue: 210 },
	Cyber: { saturate: 180, hue: 280, contrast: 125 },
	'Fade film': { contrast: 85, brightness: 115, saturate: 75, sepia: 12 },
}

export function applyPreset(name: string, keep?: Pick<ImageFilter, 'rotate' | 'flipX' | 'flipY'>): ImageFilter {
	const extra = FILTER_PRESETS[name] ?? {}
	return {
		...NO_FILTER,
		...(keep ?? {}),
		...extra,
	}
}

/** The preset name that matches these sliders, or "Custom". */
export function matchPreset(filter: Partial<ImageFilter>): string {
	for (const [name, partial] of Object.entries(FILTER_PRESETS)) {
		const full = { ...NO_FILTER, ...partial }
		const same = COLOUR_KEYS.every((key) => full[key] === (filter[key] ?? NO_FILTER[key]))
		if (same) return name
	}
	return 'Custom'
}
