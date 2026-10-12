import { ReactNode, useEffect } from 'react'
import { Editor, useValue } from 'tldraw'

/** A themed modal (Escape or a click outside closes it) for the canvas dialogs. */
export function ClipModal({
	editor,
	label,
	className = '',
	onClose,
	children,
}: {
	editor: Editor
	label: ReactNode
	className?: string
	onClose: () => void
	children: ReactNode
}) {
	const isDark = useValue('dark', () => editor.user.getIsDarkMode(), [editor])
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose])
	return (
		<div
			className={`ai-modal-backdrop tl-container ${isDark ? 'tl-theme__dark' : 'tl-theme__light'}`}
			onPointerDown={(e) => e.target === e.currentTarget && onClose()}
		>
			<div className={`ai-dialog ${className}`} role="dialog" aria-modal="true">
				<div className="ai-dialog__header">
					<strong>{label}</strong>
					<button className="ai-icon-button" onClick={onClose} aria-label="Close">
						✕
					</button>
				</div>
				{children}
			</div>
		</div>
	)
}
