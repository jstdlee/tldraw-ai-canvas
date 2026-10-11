import { atom, Atom, Editor, WeakCache } from 'tldraw'

/**
 * EditorAtom is an atom (tldraw's reactive signal) that is scoped to a specific editor. It's useful
 * for storing and reacting to state that's shared between several components.
 */
export class EditorAtom<T> {
	private states = new WeakCache<Editor, Atom<T>>()
	constructor(
		private name: string,
		private getInitialState: (editor: Editor) => T
	) {}

	getAtom(editor: Editor) {
		return this.states.get(editor, () => atom(this.name, this.getInitialState(editor)))
	}

	get(editor: Editor) {
		return this.getAtom(editor).get()
	}

	update(editor: Editor, update: (state: T) => T) {
		return this.getAtom(editor).update(update)
	}

	set(editor: Editor, state: T) {
		return this.getAtom(editor).set(state)
	}
}

/**
 * EditorAtomMap holds one atom *per key* (e.g. per shape id), scoped to an editor. Reading or
 * writing one key only tracks/invalidates that key's atom, unlike a single `EditorAtom<Record<...>>`
 * shared by every shape, where any shape's write invalidates every reader (WP25: this was the
 * top cause of all-cards-re-render-on-one-card-change lag with many cards on the canvas).
 */
export class EditorAtomMap<T> {
	private maps = new WeakCache<Editor, Map<string, Atom<T | undefined>>>()
	constructor(private name: string) {}

	private mapFor(editor: Editor) {
		return this.maps.get(editor, () => new Map())
	}

	private atomFor(editor: Editor, key: string) {
		const map = this.mapFor(editor)
		let a = map.get(key)
		if (!a) {
			a = atom<T | undefined>(`${this.name}:${key}`, undefined)
			map.set(key, a)
		}
		return a
	}

	get(editor: Editor, key: string): T | undefined {
		return this.atomFor(editor, key).get()
	}

	set(editor: Editor, key: string, value: T) {
		this.atomFor(editor, key).set(value)
	}

	update(editor: Editor, key: string, update: (state: T | undefined) => T) {
		this.atomFor(editor, key).update(update)
	}

	/** Drop a key entirely (e.g. the shape was deleted), so the map doesn't grow forever. */
	delete(editor: Editor, key: string) {
		this.mapFor(editor).delete(key)
	}

	/** Non-reactive snapshot of every key currently holding a value. Only for imperative code
	 * (not render/useValue) — reading every atom here would re-create the all-keys dependency
	 * this class exists to avoid. */
	entries(editor: Editor): [string, T][] {
		const out: [string, T][] = []
		for (const [key, a] of this.mapFor(editor)) {
			const value = a.__unsafe__getWithoutCapture()
			if (value !== undefined) out.push([key, value])
		}
		return out
	}
}
