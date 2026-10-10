import { useRef, useState } from 'react'
import { formatCode, highlightCode } from '../../../shared/codeFormat'
import { UiButton, UiTextArea } from '../../ui'
import { editorLang, FieldMax, Gutter, LargeEditor } from './LargeEditor'

export { FieldMax, ImageZoom, LargeEditor } from './LargeEditor'

/** Multi-line text with a scrollbar and a button that opens a large editor. */
export function TextAreaField({
	value,
	onChange,
	placeholder,
	mono,
	height,
	lang = 'text',
	title = 'Edit text',
}: {
	value: string
	onChange: (value: string) => void
	placeholder?: string
	mono?: boolean
	height?: number
	lang?: string
	title?: string
}) {
	const [open, setOpen] = useState(false)
	return (
		<div className="TextAreaField" style={height ? { height } : undefined}>
			<UiTextArea
				className={'NodeField-textarea NodeScroll' + (mono ? ' is-mono' : '')}
				mono={mono}
				grow
				placeholder={placeholder}
				value={value}
				onChange={onChange}
			/>
			<FieldMax title="Open in a large editor" onClick={() => setOpen(true)} />
			{open && (
				<LargeEditor
					title={title}
					value={value}
					lang={lang}
					onClose={() => setOpen(false)}
					onChange={onChange}
				/>
			)}
		</div>
	)
}

/** Code editor: row numbers, colour, format, and a large modal. */
export function CodeArea({
	value,
	lang,
	onChange,
	height,
}: {
	value: string
	lang: string
	onChange: (value: string) => void
	/** Fixed height in px. Omit to fill the parent (wrap in .NodeGrow to grow on resize). */
	height?: number
}) {
	const inputRef = useRef<HTMLTextAreaElement>(null)
	const highlightRef = useRef<HTMLPreElement>(null)
	const gutterRef = useRef<HTMLDivElement>(null)
	const [open, setOpen] = useState(false)
	const highlightLang = editorLang(lang)

	const syncScroll = () => {
		const input = inputRef.current
		if (!input) return
		if (highlightRef.current) {
			highlightRef.current.scrollTop = input.scrollTop
			highlightRef.current.scrollLeft = input.scrollLeft
		}
		if (gutterRef.current) gutterRef.current.scrollTop = input.scrollTop
	}

	return (
		<div className="CodeArea NodeScroll" style={height ? { height } : undefined}>
			<Gutter text={value} ref={gutterRef} />
			<div className="CodeArea-main">
				<pre
					ref={highlightRef}
					className="CodeArea-highlight"
					aria-hidden
					dangerouslySetInnerHTML={{ __html: highlightCode(value, highlightLang) || ' ' }}
				/>
				<textarea
					ref={inputRef}
					className="CodeArea-input NodeScroll"
					spellCheck={false}
					value={value}
					onScroll={syncScroll}
					onPointerDown={(event) => event.stopPropagation()}
					onKeyDown={(event) => {
						event.stopPropagation()
						if (event.key === 'Tab') {
							event.preventDefault()
							const target = event.currentTarget
							const start = target.selectionStart
							const end = target.selectionEnd
							const next = value.slice(0, start) + '  ' + value.slice(end)
							onChange(next)
							requestAnimationFrame(() => target.setSelectionRange(start + 2, start + 2))
						}
					}}
					onChange={(event) => onChange(event.target.value)}
				/>
			</div>
			<div className="CodeArea-tools">
				<UiButton size="sm" variant="low" title="Format code" label="Format" onClick={() => onChange(formatCode(value, highlightLang))} />
				<FieldMax title="Open the code in a large editor" onClick={() => setOpen(true)} />
			</div>
			{open && (
				<LargeEditor
					title="Code"
					lang={highlightLang}
					value={value}
					onClose={() => setOpen(false)}
					onChange={onChange}
				/>
			)}
		</div>
	)
}
