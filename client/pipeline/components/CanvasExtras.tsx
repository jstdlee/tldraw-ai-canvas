import { useEffect, useState } from 'react'
import { useEditor, useValue } from 'tldraw'
import { catalogPrompt } from '../../../shared/nodeCatalog'
import { $aiNote, $assist, assistDraft, runCompose, runFill, setAssistDraft } from '../assist'
import { $searchBlink } from '../../shell/shellState'

/** Floating AI for one node or a selection, plus the search blink. */
export function CanvasExtras() {
	const editor = useEditor()
	const assist = useValue('assist', () => $assist.get(), [])
	const note = useValue('ai note', () => $aiNote.get(), [])

	return (
		<>
			<SearchBlink />
			{assist?.mode === 'fill' && <FillChatCard shapeId={assist.shapeId} onClose={() => $assist.set(null)} />}
			{assist?.mode === 'compose' && (
				<AssistDialog
					title="What should these nodes do?"
					hint="The agent reads each node's fields and wires, then fills them or adds the missing connection."
					onClose={() => $assist.set(null)}
					onSubmit={async (intent) => {
						const result = await runCompose(editor, assist.shapeIds, intent)
						if (!result.direction) {
							$assist.set(null)
							return
						}
						return result.changed ? `Applied. ${result.direction}` : result.direction
					}}
				/>
			)}
			{note != null && <NoteDialog text={note} onClose={() => $aiNote.set(null)} />}
		</>
	)
}

/** A dashed outline that blinks around the shape a search just jumped to. */
function SearchBlink() {
	const editor = useEditor()
	const blink = useValue('blink', () => $searchBlink.get(), [])
	// Clear the blink when its time is up so it does not linger.
	useEffect(() => {
		if (!blink) return
		const left = Math.max(0, blink.until - Date.now())
		const timer = setTimeout(() => $searchBlink.set(null), left)
		return () => clearTimeout(timer)
	}, [blink])
	const bounds = useValue('blink bounds', () => (blink ? editor.getShapePageBounds(blink.id) : undefined), [editor, blink])
	if (!blink || !bounds) return null
	const topLeft = editor.pageToViewport({ x: bounds.minX, y: bounds.minY })
	const zoom = editor.getZoomLevel()
	return (
		<div
			className="SearchBlink"
			style={{
				transform: `translate(${topLeft.x}px, ${topLeft.y}px)`,
				width: bounds.width * zoom,
				height: bounds.height * zoom,
			}}
		/>
	)
}

/**
 * The AI-star card: a small chat card anchored just below the node it was opened
 * from. Closing it keeps the typed text; reopening restores it.
 */
function FillChatCard({ shapeId, onClose }: { shapeId: import('tldraw').TLShapeId; onClose: () => void }) {
	const editor = useEditor()
	const [text, setText] = useState(() => assistDraft(shapeId))
	const [error, setError] = useState<string | null>(null)
	const [note, setNote] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	// Anchor to the node's bottom edge in viewport space; follow pan/zoom.
	const position = useValue(
		'fill card position',
		() => {
			const bounds = editor.getShapePageBounds(shapeId)
			if (!bounds) return null
			const bottom = editor.pageToViewport({ x: bounds.minX, y: bounds.maxY })
			return { x: bottom.x, y: bottom.y + 12 }
		},
		[editor, shapeId]
	)
	const close = () => {
		setAssistDraft(shapeId, text)
		onClose()
	}
	return (
		<div
			className="FillChatCard"
			role="dialog"
			aria-label="Fill this node with AI"
			style={position ? { transform: `translate(${position.x}px, ${position.y}px)` } : undefined}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<div className="AssistDialog-bar">
				<strong>✦ What should this node do?</strong>
				<button type="button" onClick={close} aria-label="Close">
					×
				</button>
			</div>
			<textarea
				value={text}
				autoFocus
				placeholder="Example: turn this into a short title"
				onChange={(event) => {
					setText(event.target.value)
					setAssistDraft(shapeId, event.target.value)
				}}
			/>
			{note && <p className="AssistDialog-note">{note}</p>}
			{error && <p className="AssistDialog-error">{error}</p>}
			<div className="AssistDialog-actions">
				<button type="button" onClick={close}>
					Close
				</button>
				<button
					type="button"
					disabled={busy || !text.trim()}
					onClick={async () => {
						setBusy(true)
						setError(null)
						try {
							const result = await runFill(editor, shapeId, text.trim())
							setAssistDraft(shapeId, '')
							if (result.direction) {
								setNote(result.changed ? `Applied. ${result.direction}` : result.direction)
								setBusy(false)
								return
							}
							onClose()
						} catch (cause) {
							setError((cause as Error).message)
							setBusy(false)
						}
					}}
				>
					{busy ? 'Working…' : 'Apply'}
				</button>
			</div>
		</div>
	)
}

function AssistDialog({
	title,
	hint,
	onClose,
	onSubmit,
}: {
	title: string
	hint: string
	onClose: () => void
	onSubmit: (intent: string) => Promise<string | void>
}) {
	const [text, setText] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [note, setNote] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const [abilities, setAbilities] = useState(false)
	return (
		<div className="AssistDialog-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
			<div className="AssistDialog" role="dialog" aria-label={title}>
				<div className="AssistDialog-bar">
					<strong>✦ {title}</strong>
					<button type="button" onClick={onClose} aria-label="Close">
						×
					</button>
				</div>
				<p>{hint} The model reads a static catalog of this version, plus the selection text. It does not call MCP.</p>
				<button type="button" onClick={() => setAbilities((open) => !open)}>
					{abilities ? 'Hide abilities' : 'Show abilities'}
				</button>
				{abilities && <pre className="AbilityList">{catalogPrompt()}</pre>}
				<textarea
					value={text}
					autoFocus
					placeholder="Example: turn this into a short title, then save it"
					onChange={(event) => setText(event.target.value)}
				/>
				{note && <p className="AssistDialog-note">{note}</p>}
				{error && <p className="AssistDialog-error">{error}</p>}
				<div className="AssistDialog-actions">
					<button type="button" onClick={onClose}>
						Cancel
					</button>
					<button
						type="button"
						disabled={busy || !text.trim()}
						onClick={async () => {
							setBusy(true)
							setError(null)
							try {
								const message = await onSubmit(text.trim())
								if (message) {
									setNote(message)
									setBusy(false)
									return
								}
								onClose()
							} catch (cause) {
								setError((cause as Error).message)
								setBusy(false)
							}
						}}
					>
						{busy ? 'Working…' : 'Apply'}
					</button>
				</div>
			</div>
		</div>
	)
}

function NoteDialog({ text, onClose }: { text: string; onClose: () => void }) {
	return (
		<div className="AssistDialog-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
			<div className="AssistDialog" role="dialog" aria-label="AI answer">
				<div className="AssistDialog-bar">
					<strong>✦ AI</strong>
					<button type="button" onClick={onClose} aria-label="Close">
						×
					</button>
				</div>
				<pre className="AbilityList">{text}</pre>
				<div className="AssistDialog-actions">
					<button type="button" onClick={onClose}>
						Close
					</button>
				</div>
			</div>
		</div>
	)
}
