import { useEffect, useMemo, useRef, useState } from 'react'
import { atom, Editor, TLShapeId, useValue } from 'tldraw'
import { shapeText } from './canvasFeatures'

/** Whether the "Find on canvas" bar is open. */
export const $findOpen = atom('find open', false)

/** Find text anywhere on the current page and jump to each match. */
export function FindBar({ editor }: { editor: Editor | null }) {
	const open = useValue('find open', () => $findOpen.get(), [])
	if (!open || !editor) return null
	return <FindBarInner editor={editor} />
}

function FindBarInner({ editor }: { editor: Editor }) {
	const [query, setQuery] = useState('')
	const [index, setIndex] = useState(0)
	const inputRef = useRef<HTMLInputElement>(null)
	const isDark = useValue('dark', () => editor.user.getIsDarkMode(), [editor])

	useEffect(() => inputRef.current?.focus(), [])

	const matches = useMemo<TLShapeId[]>(() => {
		const q = query.trim().toLowerCase()
		if (!q) return []
		return editor
			.getCurrentPageShapesSorted()
			.filter((s) => shapeText(editor, s).toLowerCase().includes(q))
			.map((s) => s.id)
	}, [editor, query])

	const go = (i: number) => {
		if (!matches.length) return
		const next = (i + matches.length) % matches.length
		setIndex(next)
		const id = matches[next]
		editor.select(id)
		const bounds = editor.getShapePageBounds(id)
		if (bounds) editor.zoomToBounds(bounds.clone().expandBy(120), { animation: { duration: 200 }, targetZoom: 1 })
	}

	const close = () => $findOpen.set(false)

	return (
		<div className={`find-bar ${isDark ? 'tl-theme__dark' : 'tl-theme__light'}`} onPointerDown={(e) => e.stopPropagation()}>
			<input
				ref={inputRef}
				placeholder="Find on canvas…"
				value={query}
				onChange={(e) => {
					setQuery(e.target.value)
					setIndex(0)
				}}
				onKeyDown={(e) => {
					e.stopPropagation()
					if (e.key === 'Enter') go(e.shiftKey ? index - 1 : matches.length && query ? index + (editor.getSelectedShapeIds()[0] === matches[index] ? 1 : 0) : 0)
					if (e.key === 'Escape') close()
				}}
			/>
			<span className="find-bar__count">{query ? `${matches.length ? index + 1 : 0}/${matches.length}` : ''}</span>
			<button className="ai-icon-button" title="Previous (Shift+Enter)" onClick={() => go(index - 1)}>
				↑
			</button>
			<button className="ai-icon-button" title="Next (Enter)" onClick={() => go(index + 1)}>
				↓
			</button>
			<button className="ai-icon-button" title="Close (Esc)" onClick={close}>
				✕
			</button>
		</div>
	)
}
