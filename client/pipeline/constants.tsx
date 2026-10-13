export const CONNECTION_CENTER_HANDLE_SIZE_PX = 16
export const CONNECTION_CENTER_HANDLE_HOVER_SIZE_PX = 24

export const NODE_WIDTH_PX = 320
export const NODE_HEADER_HEIGHT_PX = 40
export const NODE_ROW_HEADER_GAP_PX = 8
export const NODE_ROW_BOTTOM_PADDING_PX = 8
export const NODE_FOOTER_HEIGHT_PX = 40
/** Row height at the default (20px) card font. Used only where no shape's own font size is in
 * scope yet (e.g. positioning a connection before the node it will land on exists). Everywhere
 * a shape is available, use `getNodeRowHeightPx(shape.props.fontSize)` instead (WP16), so the
 * row height — and the ports placed on it — scale with the card's own font (the A-/A+ setting). */
export const NODE_ROW_HEIGHT_PX = 44
/** Cards without a stored `fontSize` (old canvases) render at this size. */
export const DEFAULT_NODE_FONT_PX = 20
/** New cards are created at this size (WP16 Part A, supersedes WP15 item F2). */
export const NEW_NODE_FONT_PX = 16
/** Row px per 1px of card font (WP16): `rowPx = round(fontPx * NODE_ROW_SCALE)`. */
export const NODE_ROW_SCALE = 2.25

/** The row height, in px, for a card at `fontPx` (or the default size if the card has none stored). */
export function getNodeRowHeightPx(fontPx: number | undefined): number {
	return Math.round((fontPx ?? DEFAULT_NODE_FONT_PX) * NODE_ROW_SCALE)
}

export const NODE_IMAGE_PREVIEW_HEIGHT_PX = 160 + 8

/** WP27 Part B: extra body height to reserve for a `WireField`/`WireFieldHeader` field that
 * uses `UiGrowingInput` (a wrapping, growing single-line field) in place of its usual one-row
 * height — enough room for the control's own max-rows cap (default 6 lines), beyond the one
 * row height already budgeted for that field's row. A node's `getBodyHeightPx` adds this once
 * per such field it has. */
export const GROW_FIELD_EXTRA_PX = 70

export const PORT_RADIUS_PX = 6

export const DEFAULT_NODE_SPACING_PX = 60

/**
 * Port data types define the kind of data that flows between nodes. Each type
 * has a CSS color used to tint ports and connections so users can see at a
 * glance which outputs are compatible with which inputs.
 */
export type PortDataType = 'image' | 'text' | 'model' | 'number' | 'latent' | 'any'

export const PORT_TYPE_COLORS: Record<PortDataType, string> = {
	image: '#c060e0',
	text: '#4caf50',
	model: '#2196f3',
	number: '#9e9e9e',
	latent: '#ff9800',
	any: '#c08520',
}
