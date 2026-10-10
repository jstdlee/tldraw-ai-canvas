/** Shorten a table cell. The full value stays in the cell title. */
export function clipCell(value: string, max = 48): string {
	const flat = value.replace(/\s+/g, ' ')
	if (flat.length <= max) return flat
	if (max <= 1) return '…'
	return flat.slice(0, max - 1) + '…'
}

/** True when the cell is a plain number, so the table can align it. */
export function isNumericCell(value: string): boolean {
	const text = value.trim()
	if (!text) return false
	return /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(text)
}

/** How many rows to draw, and how many the footer should mention. */
export function tableWindow(rowCount: number, maxRows?: number): { count: number; more: number } {
	if (maxRows == null || maxRows < 0 || rowCount <= maxRows) return { count: rowCount, more: 0 }
	return { count: maxRows, more: rowCount - maxRows }
}
