import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEditor, useValue } from 'tldraw'
import { toggleTask } from '../../shared/clipText'
import { renderMermaid } from './ClipShapes'
import './clipfullscreen.css'

/**
 * Fullscreen viewer/editor for canvas clips (markdown + mermaid).
 * Opened from the ⤢ button on a clip card; rendered in a portal above the canvas.
 * Closes on Escape / backdrop click; unsaved edits are written back on close.
 */

export type ClipFullscreenKind = 'markdown' | 'mermaid'

const stop = (e: React.SyntheticEvent) => e.stopPropagation()

/** Mermaid source sometimes arrives fenced; strip the fence before rendering. */
export function stripMermaidFence(code: string): string {
	return code.replace(/^```mermaid\s*|```\s*$/g, '')
}

/** Rendered markdown, shared by the clip card and the fullscreen preview. */
export function MarkdownView({ md, onToggleTask }: { md: string; onToggleTask?(index: number): void }) {
	let taskIndex = -1
	return (
		<ReactMarkdown
			remarkPlugins={[remarkGfm]}
			components={{
				a: ({ href, children }) => (
					<a href={href} target="_blank" rel="noreferrer" onPointerDown={stop}>
						{children}
					</a>
				),
				input: ({ checked, type }) => {
					if (type !== 'checkbox') return <input type={type} />
					const index = ++taskIndex
					return (
						<input
							type="checkbox"
							checked={!!checked}
							onPointerDown={stop}
							onChange={() => onToggleTask?.(index)}
						/>
					)
				},
			}}
		>
			{md}
		</ReactMarkdown>
	)
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 8

export function ClipFullscreen({
	kind,
	title,
	source,
	onApply,
	onClose,
}: {
	kind: ClipFullscreenKind
	title: string
	/** Current saved source (shape props). */
	source: string
	onApply(value: string): void
	onClose(): void
}) {
	const editor = useEditor()
	const dark = useValue('dark', () => editor.user.getIsDarkMode(), [editor])
	const [mode, setMode] = useState<'edit' | 'preview'>('preview')
	const [draft, setDraft] = useState(source)
	const dirty = draft !== source

	/** Write a value back to the shape (when changed) and sync the local draft. */
	const apply = useCallback(
		(value: string) => {
			if (value !== source) onApply(value)
			setDraft(value)
		},
		[onApply, source]
	)

	const close = useCallback(() => {
		if (dirty) onApply(draft)
		onClose()
	}, [dirty, draft, onApply, onClose])

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') close()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [close])

	// --- Mermaid rendering (preview only) -------------------------------------
	const mermaidCode = kind === 'mermaid' ? stripMermaidFence(draft) : ''
	const [svg, setSvg] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (kind !== 'mermaid' || mode !== 'preview') return
		let cancelled = false
		renderMermaid(mermaidCode, dark)
			.then((s) => {
				if (cancelled) return
				setSvg(s)
				setError(null)
			})
			.catch((e) => {
				if (cancelled) return
				setSvg(null)
				setError(String(e?.message ?? e).split('\n').slice(0, 6).join('\n'))
			})
		return () => {
			cancelled = true
		}
	}, [kind, mode, mermaidCode, dark])

	// --- Zoom & pan (mermaid preview) ------------------------------------------
	const viewportRef = useRef<HTMLDivElement>(null)
	const contentRef = useRef<HTMLDivElement>(null)
	const [zoom, setZoom] = useState(1)
	const zoomRef = useRef(1)
	const [base, setBase] = useState<{ w: number; h: number } | null>(null)
	const lastFitSvg = useRef<string | null>(null)

	const setZoomClamped = useCallback((update: number | ((z: number) => number)) => {
		setZoom((prev) => {
			const next = typeof update === 'function' ? update(prev) : update
			const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
			zoomRef.current = clamped
			return clamped
		})
	}, [])

	/** Largest zoom ≤ 100% that shows the whole diagram in the viewport. */
	const fitToViewport = useCallback(
		(w: number, h: number) => {
			const vp = viewportRef.current
			if (!vp) return
			setZoomClamped(Math.min(1, (vp.clientWidth - 48) / w, (vp.clientHeight - 48) / h))
		},
		[setZoomClamped]
	)

	// Measure the rendered SVG at its natural size and pin it, so that
	// transform: scale(zoom) + an explicitly sized stage give exact scrollbars.
	useLayoutEffect(() => {
		if (kind !== 'mermaid' || mode !== 'preview' || !svg) return
		const el = contentRef.current
		const svgEl = el?.querySelector('svg') ?? null
		if (!el || !svgEl) return
		let w = 0
		let h = 0
		const vb = svgEl.getAttribute('viewBox')
		if (vb) {
			const parts = vb.split(/[\s,]+/).map(Number)
			if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2] > 0 && parts[3] > 0) {
				w = parts[2]
				h = parts[3]
			}
		}
		if (!w || !h) {
			const rect = svgEl.getBoundingClientRect()
			w = rect.width / zoomRef.current
			h = rect.height / zoomRef.current
		}
		if (!w || !h) return
		svgEl.style.maxWidth = 'none'
		svgEl.style.maxHeight = 'none'
		svgEl.style.width = `${w}px`
		svgEl.style.height = `${h}px`
		setBase({ w, h })
		// Fit once per newly rendered diagram; keep the user's zoom otherwise.
		if (lastFitSvg.current !== svg) {
			lastFitSvg.current = svg
			fitToViewport(w, h)
		}
	}, [kind, mode, svg, fitToViewport])

	// Ctrl/Cmd + wheel zoom. Native listener: React's delegated wheel is passive.
	useEffect(() => {
		if (kind !== 'mermaid' || mode !== 'preview' || !svg) return
		const vp = viewportRef.current
		if (!vp) return
		const onWheel = (event: WheelEvent) => {
			if (!event.ctrlKey && !event.metaKey) return
			event.preventDefault()
			setZoomClamped((z) => z * (event.deltaY < 0 ? 1.15 : 1 / 1.15))
		}
		vp.addEventListener('wheel', onWheel, { passive: false })
		return () => vp.removeEventListener('wheel', onWheel)
	}, [kind, mode, svg, setZoomClamped])

	// Drag to pan: adjust the scroll position of the viewport.
	const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
	const onPanStart = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0 && event.button !== 1) return
		const vp = viewportRef.current
		if (!vp) return
		event.preventDefault()
		vp.setPointerCapture(event.pointerId)
		pan.current = { x: event.clientX, y: event.clientY, left: vp.scrollLeft, top: vp.scrollTop }
	}
	const onPanMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const start = pan.current
		const vp = viewportRef.current
		if (!start || !vp) return
		vp.scrollLeft = start.left - (event.clientX - start.x)
		vp.scrollTop = start.top - (event.clientY - start.y)
	}
	const onPanEnd = () => {
		pan.current = null
	}

	const showPreview = () => {
		apply(draft)
		setMode('preview')
	}

	return createPortal(
		<div
			className={`clipfs-backdrop tl-container ${dark ? 'tl-theme__dark' : 'tl-theme__light'}`}
			onPointerDown={(event) => event.target === event.currentTarget && close()}
		>
			<div className="clipfs" role="dialog" aria-modal="true" aria-label={title}>
				<div className="clipfs-bar">
					<strong className="clipfs-title">{title}</strong>
					<div className="clipfs-toggle" role="group" aria-label="View mode">
						<button type="button" className={mode === 'edit' ? 'is-on' : ''} onClick={() => setMode('edit')}>
							Edit
						</button>
						<button type="button" className={mode === 'preview' ? 'is-on' : ''} onClick={showPreview}>
							Preview
						</button>
					</div>
					<div className="clipfs-spacer" />
					{kind === 'mermaid' && mode === 'preview' && (
						<div className="clipfs-zoom" role="group" aria-label="Zoom">
							<button type="button" title="Zoom out" onClick={() => setZoomClamped((z) => z / 1.25)}>
								−
							</button>
							<button
								type="button"
								className="clipfs-zoom-level"
								title="Reset to 100%"
								onClick={() => setZoomClamped(1)}
							>
								{Math.round(zoom * 100)}%
							</button>
							<button type="button" title="Zoom in" onClick={() => setZoomClamped((z) => z * 1.25)}>
								+
							</button>
							<button type="button" title="Fit to window" disabled={!base} onClick={() => base && fitToViewport(base.w, base.h)}>
								Fit
							</button>
						</div>
					)}
					{mode === 'edit' && (
						<button type="button" className="clipfs-apply" disabled={!dirty} onClick={showPreview}>
							Apply
						</button>
					)}
					<button type="button" className="clipfs-close" aria-label="Close" title="Close (Esc)" onClick={close}>
						×
					</button>
				</div>
				<div className="clipfs-body">
					{mode === 'edit' ? (
						<textarea
							className={'clipfs-textarea' + (kind === 'mermaid' ? ' is-mono' : '')}
							value={draft}
							spellCheck={false}
							autoFocus
							placeholder={kind === 'mermaid' ? 'flowchart LR\n  A --> B' : 'Markdown…'}
							onChange={(event) => setDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
									event.preventDefault()
									showPreview()
								}
							}}
						/>
					) : kind === 'markdown' ? (
						<div className="clipfs-md-preview clip-markdown">
							<MarkdownView md={draft} onToggleTask={(index) => apply(toggleTask(draft, index))} />
						</div>
					) : error ? (
						<pre className="clipfs-error">{error}</pre>
					) : svg ? (
						<div
							className="clipfs-viewport"
							ref={viewportRef}
							onPointerDown={onPanStart}
							onPointerMove={onPanMove}
							onPointerUp={onPanEnd}
							onPointerCancel={onPanEnd}
						>
							<div className="clipfs-stage" style={base ? { width: base.w * zoom, height: base.h * zoom } : undefined}>
								<div
									className="clipfs-mermaid"
									ref={contentRef}
									style={{ transform: `scale(${zoom})` }}
									dangerouslySetInnerHTML={{ __html: svg }}
								/>
							</div>
						</div>
					) : (
						<div className="clipfs-status">Rendering…</div>
					)}
				</div>
			</div>
		</div>,
		document.body
	)
}
