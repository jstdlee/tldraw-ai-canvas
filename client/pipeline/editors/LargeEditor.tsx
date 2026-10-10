import { forwardRef, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatCode, highlightCode } from '../../../shared/codeFormat'
import { IconClose, IconExpand, UiButton, UiIconButton } from '../../ui'
import { placeImageOnCanvas } from '../placeOnCanvas'
import { NodeShape } from '../nodes/NodeShapeUtil'
import type { Editor } from 'tldraw'

export function editorLang(lang: string): string {
	if (lang === 'py' || lang === 'js' || lang === 'sql' || lang === 'json' || lang === 'text') return lang
	return 'ts'
}

export function LargeEditor({
	title,
	value,
	lang,
	onChange,
	onClose,
	readOnly,
}: {
	title: string
	value: string
	lang: string
	onChange: (value: string) => void
	onClose: () => void
	readOnly?: boolean
}) {
	const [draft, setDraft] = useState(value)
	const [copied, setCopied] = useState(false)
	const changed = !readOnly && draft !== value

	const apply = () => {
		onChange(draft)
		onClose()
	}
	const requestClose = () => {
		if (changed && !window.confirm('Discard changes?')) return
		onClose()
	}

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') requestClose()
			if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !readOnly) {
				event.preventDefault()
				apply()
			}
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	})
	const code = lang !== 'text'
	return createPortal(
		<div className="LargeEditor-backdrop" onPointerDown={(event) => event.target === event.currentTarget && requestClose()}>
			<div className="LargeEditor" role="dialog" aria-label={title}>
				<div className="LargeEditor-bar">
					<strong>{title}</strong>
					<div className="LargeEditor-actions">
						{!readOnly && code && (
							<UiButton size="sm" variant="low" label="Format" onClick={() => setDraft(formatCode(draft, lang))} />
						)}
						<UiButton
							size="sm"
							variant="low"
							label={copied ? 'Copied' : 'Copy'}
							onClick={() => {
								void navigator.clipboard.writeText(draft)
								setCopied(true)
								window.setTimeout(() => setCopied(false), 900)
							}}
						/>
						{!readOnly && <UiButton size="sm" variant="primary" label="Apply" onClick={apply} />}
						<UiIconButton icon={<IconClose />} title="Close" onClick={requestClose} />
					</div>
				</div>
				<div className="LargeEditor-body">
					{code && <Gutter text={draft} />}
					<div className="CodeArea-main">
						{code && (
							<pre className="CodeArea-highlight" aria-hidden dangerouslySetInnerHTML={{ __html: highlightCode(draft, lang) }} />
						)}
						<textarea
							className={code ? 'CodeArea-input' : 'LargeEditor-text'}
							spellCheck={false}
							value={draft}
							readOnly={readOnly}
							autoFocus
							onChange={(event) => setDraft(event.target.value)}
						/>
					</div>
				</div>
				{!readOnly && <div className="LargeEditor-footer">Ctrl+Enter apply · Esc close</div>}
			</div>
		</div>,
		document.body
	)
}

export const Gutter = forwardRef<HTMLDivElement, { text: string }>(function Gutter({ text }, ref) {
	const count = Math.max(1, text.split('\n').length)
	return (
		<div className="CodeArea-gutter" ref={ref} aria-hidden>
			{Array.from({ length: count }, (_, index) => (
				<span key={index}>{index + 1}</span>
			))}
		</div>
	)
})

/** Small button in the corner of a field that opens its large editor; fades in on hover/focus. */
export function FieldMax({ title, onClick }: { title: string; onClick: () => void }) {
	return (
		<UiIconButton className="FieldMax" icon={<IconExpand size={13} />} title={title} onClick={onClick} />
	)
}

/** Large view for an image result or an image input. */
export function ImageZoom({
	src,
	onClose,
	editor,
	nextTo,
}: {
	src: string
	onClose: () => void
	/** When given with `nextTo`, shows "Place on canvas". */
	editor?: Editor
	nextTo?: NodeShape | null
}) {
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose])
	return createPortal(
		<div className="LargeEditor-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
			<div className="LargeEditor LargeEditor-image" role="dialog" aria-label="Image">
				<div className="LargeEditor-bar">
					<strong>Image</strong>
					<div className="LargeEditor-actions">
						{editor && (
							<UiButton
								size="sm"
								variant="low"
								label="Place on canvas"
								onClick={() => void placeImageOnCanvas(editor, nextTo ?? null, src)}
							/>
						)}
						<UiIconButton icon={<IconClose />} title="Close" onClick={onClose} />
					</div>
				</div>
				<div className="LargeEditor-image-body">
					<img src={src} alt="" />
				</div>
			</div>
		</div>,
		document.body
	)
}
