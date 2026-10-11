/**
 * Pure search-filter logic for the kit's long select menus (WP23 Part C): a menu with more
 * than 10 options gets a search box that filters by label, hint, and group text. No tldraw
 * import, so it is unit-testable in Node — see tests/selectFilter.test.ts.
 */

export interface SelectFilterOption {
	label: string
	hint?: string
	group?: string
}

/** Whether `option` matches `query` (case-insensitive substring over label, hint, group). An
 * empty/whitespace query matches everything. */
export function matchesSelectQuery(option: SelectFilterOption, query: string): boolean {
	const q = query.trim().toLowerCase()
	if (!q) return true
	if (option.label.toLowerCase().includes(q)) return true
	if (option.hint && option.hint.toLowerCase().includes(q)) return true
	if (option.group && option.group.toLowerCase().includes(q)) return true
	return false
}

/** Filter a list of options by `query`, keeping their relative order. */
export function filterSelectOptions<T extends SelectFilterOption>(options: T[], query: string): T[] {
	if (!query.trim()) return options
	return options.filter((option) => matchesSelectQuery(option, query))
}
