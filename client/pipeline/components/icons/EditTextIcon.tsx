/** UI-09: "AI text" (edits/transforms text you already have) used the same sparkle-writing
 * glyph as "Generate text" (writes new text from a prompt) — the two cards were visually
 * indistinguishable in the library/search picker and on the canvas. This pairs the same two
 * text lines with a pencil tip instead of a sparkle, reading as "edit this" rather than "write
 * this from scratch". */
export function EditTextIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path d="M2.5 4.5H9.5M2.5 8H7" stroke="currentColor" strokeWidth="1.33" strokeLinecap="round" strokeLinejoin="round" />
			<path
				d="M13.4 6.1L9.7 9.8L9 12L11.2 11.3L14.9 7.6C15.2 7.3 15.2 6.8 14.9 6.5L14.4 6C14.1 5.7 13.7 5.7 13.4 6.1Z"
				stroke="currentColor"
				strokeWidth="1"
				strokeLinejoin="round"
			/>
		</svg>
	)
}
