/**
 * WP44: what the agent panel's next task will work on, from a plain description of the
 * selected shapes. Pure so it can be unit-tested (tests/agentScope.test.ts).
 */

export type AgentScopeKind = 'canvas' | 'card' | 'cards' | 'text' | 'image' | 'mixed'

/** One selected shape, described without tldraw types. */
export interface AgentScopeShape {
	id: string
	/** card = a pipeline node; text = any shape with text (text, note, geo label, markdown…);
	 * image = an image shape; other = anything else (drawings, arrows, empty geo…). */
	kind: 'card' | 'text' | 'image' | 'other'
	/** For a card: its label or its node type's title, e.g. "DataPipe". */
	title?: string
}

export interface AgentScope {
	kind: AgentScopeKind
	ids: string[]
	label: string
}

function plural(count: number, one: string, many = one + 's'): string {
	return `${count} ${count === 1 ? one : many}`
}

export function getAgentScope(shapes: AgentScopeShape[]): AgentScope {
	const ids = shapes.map((s) => s.id)
	if (shapes.length === 0) return { kind: 'canvas', ids, label: 'Canvas' }

	const cards = shapes.filter((s) => s.kind === 'card')
	const texts = shapes.filter((s) => s.kind === 'text')
	const images = shapes.filter((s) => s.kind === 'image')
	const others = shapes.length - cards.length - texts.length - images.length

	if (cards.length === shapes.length) {
		if (cards.length === 1) return { kind: 'card', ids, label: `Card: ${cards[0].title || 'card'}` }
		return { kind: 'cards', ids, label: plural(cards.length, 'card') }
	}
	// Cards plus notes: Build with AI reads the notes as extra context for the cards.
	if (cards.length > 0 && texts.length > 0 && images.length === 0 && others === 0) {
		return { kind: 'cards', ids, label: `${plural(cards.length, 'card')} + ${plural(texts.length, 'text')}` }
	}
	if (texts.length === shapes.length) return { kind: 'text', ids, label: plural(texts.length, 'text') }
	if (images.length === shapes.length) {
		return { kind: 'image', ids, label: images.length === 1 ? 'Image' : plural(images.length, 'image') }
	}
	return { kind: 'mixed', ids, label: plural(shapes.length, 'item') }
}
