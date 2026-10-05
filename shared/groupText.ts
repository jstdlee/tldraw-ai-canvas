/** Text of a group: each member, in order, with a new line between members. */

export function concatMemberText(parts: string[]): string {
	return parts
		.map((part) => part.replace(/\s+$/g, ''))
		.filter((part) => part.length > 0)
		.join('\n')
}
