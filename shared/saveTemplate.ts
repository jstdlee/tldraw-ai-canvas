/**
 * WP36 "O": the Save card's file name template. `{{date}}` already existed; `{{name}}` (the
 * card/result name) and `{{index}}` (which run/row this is) are new. Pure, no tldraw import,
 * testable in Node.
 */
export interface SaveTemplateVars {
	date: string
	name: string
	index: string
}

export function fillSaveFileName(template: string, vars: SaveTemplateVars): string {
	return template.replace(/\{\{\s*(date|name|index)\s*\}\}/g, (_, key: keyof SaveTemplateVars) => vars[key])
}

export type SaveMode = 'new' | 'overwrite' | 'append'
