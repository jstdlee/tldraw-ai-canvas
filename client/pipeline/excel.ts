/** Read a spreadsheet file (xlsx/xls/ods/csv/tsv) in the browser. SheetJS is lazy-loaded. */

const TEXT_EXT = /\.(csv|tsv|txt)$/i

export interface SpreadsheetFile {
	sheets: string[]
	toCsv(sheet: string): string
}

/** CSV/TSV/plain text: decode as UTF-8, one sheet named "text". */
function readAsText(bytes: Uint8Array): SpreadsheetFile {
	const text = new TextDecoder('utf-8').decode(bytes)
	return { sheets: ['text'], toCsv: () => text }
}

export async function readSpreadsheet(bytes: Uint8Array, name: string): Promise<SpreadsheetFile> {
	if (TEXT_EXT.test(name)) return readAsText(bytes)
	const XLSX = await import('xlsx')
	const workbook = XLSX.read(bytes, { type: 'array' })
	const sheets = workbook.SheetNames
	if (!sheets.length) throw new Error('The workbook has no sheets')
	return {
		sheets,
		toCsv(sheet: string): string {
			const ws = workbook.Sheets[sheet] ?? workbook.Sheets[sheets[0]]
			if (!ws) throw new Error(`No sheet named ${sheet}`)
			return XLSX.utils.sheet_to_csv(ws, { blankrows: false })
		},
	}
}
