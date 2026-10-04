/** Pure text helpers for canvas clips (Markdown, Mermaid). */

/** Toggle the n-th "- [ ]" task in Markdown source. */
export function toggleTask(md: string, index: number): string {
	let i = -1
	return md.replace(/^(\s*[-*+]\s+\[)( |x|X)(\])/gm, (m, a, mark, b) => {
		i++
		return i === index ? `${a}${mark === ' ' ? 'x' : ' '}${b}` : m
	})
}

/** Does this text look like a Mermaid diagram? */
export function isMermaid(text: string) {
	return /^\s*(graph\s+(TD|TB|BT|RL|LR)|flowchart\s|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|pie(\s|$)|journey|mindmap|timeline|gitGraph|quadrantChart|xychart-beta|sankey-beta|block-beta)/m.test(
		text.replace(/^```mermaid\s*/, '')
	)
}

/** Does pasted text look like Markdown (so it should become a Markdown clip)? */
export function looksLikeMarkdown(text: string) {
	const lines = text.split('\n')
	if (lines.length < 2) return false
	const marks = lines.filter((l) =>
		/^(#{1,6}\s|\s*[-*+]\s|\s*\d+\.\s|>\s|```|\|.*\|)|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/.test(l)
	).length
	return marks >= 2 || /^#{1,6}\s/.test(lines[0])
}
