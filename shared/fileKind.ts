/**
 * What "Read from" should do with an uploaded file: show its text, treat it as
 * an image, convert it with SheetJS, or just point at the stored bytes.
 */

export type FileKind = 'text' | 'image' | 'sheet' | 'binary'

const TEXT_EXT = /\.(txt|md|csv|tsv|json|jsonl|xml|ya?ml|html?|css|js|ts|jsx|tsx|py|sql|log|ini|toml|svg)$/i
const SHEET_EXT = /\.(xlsx?|ods)$/i
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif)$/i

/** Decide a file's kind from its name and MIME type (whichever is more specific wins). */
export function detectFileKind(name: string, mime: string): FileKind {
	const lower = name.toLowerCase()
	const type = (mime || '').toLowerCase()
	if (type.startsWith('image/') || (!type.startsWith('text/') && IMAGE_EXT.test(lower))) return 'image'
	if (SHEET_EXT.test(lower) || /spreadsheetml|ms-excel|opendocument\.spreadsheet/.test(type)) return 'sheet'
	if (TEXT_EXT.test(lower) || type.startsWith('text/') || /json|xml/.test(type)) return 'text'
	return 'binary'
}
