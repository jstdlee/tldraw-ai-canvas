import { forwardRef, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatCode, highlightCode } from '../../../shared/codeFormat'
import { stopEvent } from '../nodes/types/fields'

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
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose])
	const code = lang !== 'text'
	return createPortal(
		<div className="LargeEditor-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
			<div className="LargeEditor" role="dialog" aria-label={title}>
				<div className="LargeEditor-bar">
					<strong>{title}</strong>
					<div className="LargeEditor-actions">
						{!readOnly && (
							<button type="button" onClick={() => setDraft(formatCode(draft, lang))}>
								Format
							</button>
						)}
						{!readOnly && (
							<button
								type="button"
								onClick={() => {
									onChange(draft)
									onClose()
								}}
							>
								Apply
							</button>
						)}
						<button type="button" onClick={onClose} aria-label="Close">
							×
						</button>
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

export function FieldMax({ title, onClick }: { title: string; onClick: () => void }) {
	return (
		<button className="FieldMax" type="button" title={title} onPointerDown={stopEvent} onClick={onClick}>
			⛶
		</button>
	)
}

/** Large view for an image result or an image input. */
export function ImageZoom({ src, onClose }: { src: string; onClose: () => void }) {
	return createPortal(
		<div className="LargeEditor-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
			<div className="LargeEditor LargeEditor-image" role="dialog" aria-label="Image">
				<div className="LargeEditor-bar">
					<strong>Image</strong>
					<button type="button" onClick={onClose} aria-label="Close">
						×
					</button>
				</div>
				<img src={src} alt="" />
			</div>
		</div>,
		document.body
	)
}
