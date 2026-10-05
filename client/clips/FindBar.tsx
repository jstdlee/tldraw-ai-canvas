import { useEffect, useMemo, useRef, useState } from 'react'
import { atom, Editor, TLShape, TLShapeId, useValue } from 'tldraw'
import { assetOf, previewReplace, SearchQuery, searchHits } from '../../shared/searchOps'
import { NODE_CATEGORY } from '../../shared/nodeGroups'
import { $searchHits } from '../shell/shellState'
import { NodeShape } from '../pipeline/nodes/NodeShapeUtil'
import { shapeText } from './shapeText'

/** Whether the "Find on canvas" bar is open. */
export const $findOpen = atom('find open', false)

/** Find text anywhere on the current page and jump to each match. */
export function FindBar({ editor }: { editor: Editor | null }) {
	const open = useValue('find open', () => $findOpen.get(), [])
	if (!open || !editor) return null
	return <FindBarInner editor={editor} />
}

function shapeAsset(shape: TLShape): string {
	const nodeType = shape.type === 'node' ? (shape.props as { node?: { type?: string } }).node?.type : undefined
	return assetOf(shape.type, nodeType)
}

function shapeNodeType(shape: TLShape): string {
	return shape.type === 'node' ? ((shape.props as { node?: { type?: string } }).node?.type ?? '') : ''
}

function FindBarInner({ editor }: { editor: Editor }) {
	const [text, setText] = useState('')
	const [replacement, setReplacement] = useState('')
	const [regexp, setRegexp] = useState(false)
	const [caseSensitive, setCaseSensitive] = useState(false)
	const [component, setComponent] = useState('')
	const [asset, setAsset] = useState('')
	const [index, setIndex] = useState(0)
	const [preview, setPreview] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)
	const isDark = useValue('dark', () => editor.user.getIsDarkMode(), [editor])
	const query: SearchQuery = { text, regexp, caseSensitive, component, asset }

	useEffect(() => inputRef.current?.focus(), [])

	const matches = useMemo<TLShapeId[]>(() => {
		if (!text.trim()) return []
		try {
			return editor
				.getCurrentPageShapesSorted()
				.filter((shape) => {
					if (asset && shapeAsset(shape) !== asset) return false
					if (component && shapeNodeType(shape) !== component) return false
					return searchHits(shapeText(editor, shape), query).length > 0
				})
				.map((shape) => shape.id)
		} catch {
			return []
		}
	}, [editor, text, regexp, caseSensitive, component, asset])

	useEffect(() => {
		$searchHits.set(matches)
		return () => {
			$searchHits.set([])
		}
	}, [matches])

	const go = (i: number) => {
		if (!matches.length) return
		const next = (i + matches.length) % matches.length
		setIndex(next)
		const id = matches[next]
		editor.select(id)
		const bounds = editor.getShapePageBounds(id)
		if (bounds) editor.zoomToBounds(bounds.clone().expandBy(120), { animation: { duration: 200 }, targetZoom: 1 })
	}

	const dry = () => {
		let count = 0
		for (const id of matches) {
			const shape = editor.getShape(id)
			if (!shape) continue
			count += previewReplace(shapeText(editor, shape), query, replacement).count
		}
		setPreview(count ? `${count} replacements. Nothing written.` : 'No replacements.')
	}

	const apply = () => {
		editor.markHistoryStoppingPoint('replace on canvas')
		let count = 0
		editor.run(() => {
			for (const id of matches) {
				const shape = editor.getShape(id)
				if (!shape) continue
				count += writeReplace(editor, shape, query, replacement)
			}
		})
		setPreview(count ? `Replaced ${count}.` : 'No replacements.')
	}

	return (
		<div className={`find-bar find-bar-advanced ${isDark ? 'tl-theme__dark' : 'tl-theme__light'}`} onPointerDown={(e) => e.stopPropagation()}>
			<input
				ref={inputRef}
				placeholder="Find. Regexp is allowed."
				value={text}
				onChange={(e) => {
					setText(e.target.value)
					setIndex(0)
				}}
				onKeyDown={(e) => {
					e.stopPropagation()
					if (e.key === 'Enter') go(e.shiftKey ? index - 1 : index + 1)
					if (e.key === 'Escape') $findOpen.set(false)
				}}
			/>
			<input placeholder="Replace" value={replacement} onChange={(e) => setReplacement(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
			<label><input type="checkbox" checked={regexp} onChange={(e) => setRegexp(e.target.checked)} /> Regexp</label>
			<label><input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> Case</label>
			<select value={component} onChange={(e) => setComponent(e.target.value)} onPointerDown={(e) => e.stopPropagation()}>
				<option value="">Any node</option>
				{Object.keys(NODE_CATEGORY).map((type) => (
					<option key={type} value={type}>{type}</option>
				))}
			</select>
			<select value={asset} onChange={(e) => setAsset(e.target.value)} onPointerDown={(e) => e.stopPropagation()}>
				<option value="">Any asset</option>
				{['text', 'md', 'code', 'image', 'video', 'node'].map((kind) => (
					<option key={kind} value={kind}>{kind}</option>
				))}
			</select>
			<span className="find-bar__count">{text ? `${matches.length ? index + 1 : 0}/${matches.length}` : ''}</span>
			<button type="button" title="Previous" onClick={() => go(index - 1)}>↑</button>
			<button type="button" title="Next" onClick={() => go(index + 1)}>↓</button>
			<button type="button" title="Highlight matches" onClick={() => editor.select(...matches)}>Highlight</button>
			<button type="button" title="Dry run" onClick={dry}>Dry run</button>
			<button type="button" title="Replace" onClick={apply}>Replace</button>
			<button type="button" title="Close" onClick={() => $findOpen.set(false)}>✕</button>
			{preview && <span className="find-bar__count">{preview}</span>}
		</div>
	)
}

function writeReplace(editor: Editor, shape: TLShape, query: SearchQuery, replacement: string): number {
	if (shape.type === 'node') {
		const node = { ...(shape.props as { node: Record<string, unknown> }).node }
		let count = 0
		for (const [key, value] of Object.entries(node)) {
			if (typeof value !== 'string') continue
			const next = previewReplace(value, query, replacement)
			if (!next.count) continue
			node[key] = next.next
			count += next.count
		}
		if (count) {
			editor.updateShape<NodeShape>({
				id: shape.id,
				type: 'node',
				props: { node: node as NodeShape['props']['node'] },
			})
		}
		return count
	}
	const current = shapeText(editor, shape)
	const next = previewReplace(current, query, replacement)
	if (!next.count) return 0
	if (shape.type === 'markdown') editor.updateShape({ id: shape.id, type: 'markdown', props: { md: next.next } })
	else if (shape.type === 'mermaid') editor.updateShape({ id: shape.id, type: 'mermaid', props: { code: next.next } })
	else return 0
	return next.count
}
