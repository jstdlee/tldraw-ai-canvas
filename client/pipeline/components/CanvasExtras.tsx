import { useEffect, useState } from 'react'
import { atom, useEditor, useValue } from 'tldraw'
import { EXAMPLES } from '../../../shared/examples'
import { catalogPrompt } from '../../../shared/nodeCatalog'
import { $assist, assistDraft, runCompose, runFill, setAssistDraft } from '../assist'
import { loadExample } from '../loadExample'
import { $searchBlink } from '../../shell/shellState'

export const $examplesOpen = atom('examples open', false)

/** Floating AI for the selection, the assist dialog, the examples dialog, and the search blink. */
export function CanvasExtras() {
	const editor = useEditor()
	const assist = useValue('assist', () => $assist.get(), [])
	const examplesOpen = useValue('examples', () => $examplesOpen.get(), [])
	const selected = useValue('selected nodes', () => editor.getSelectedShapes().filter((shape) => shape.type === 'node'), [editor])

	return (
		<>
			<SearchBlink />
			{selected.length > 0 && !assist && (
				<button
					className="SelectionAssist"
					title="Tell the agent what these nodes should do"
					onPointerDown={(event) => event.stopPropagation()}
					onClick={() => $assist.set({ mode: 'compose', shapeIds: selected.map((shape) => shape.id) })}
				>
					✦ Shape with AI
				</button>
			)}
			{assist?.mode === 'fill' && <FillChatCard shapeId={assist.shapeId} onClose={() => $assist.set(null)} />}
			{assist?.mode === 'compose' && (
				<AssistDialog
					title="What should these nodes do?"
					hint="The agent wires the selection, fills fields, and adds any node that is missing."
					onClose={() => $assist.set(null)}
					onSubmit={async (intent) => {
						await runCompose(editor, assist.shapeIds, intent)
						$assist.set(null)
					}}
				/>
			)}
			{examplesOpen && <ExamplesDialog onClose={() => $examplesOpen.set(false)} />}
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
							await runFill(editor, shapeId, text.trim())
							setAssistDraft(shapeId, '')
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
	onSubmit: (intent: string) => Promise<void>
}) {
	const [text, setText] = useState('')
	const [error, setError] = useState<string | null>(null)
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
								await onSubmit(text.trim())
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

function ExamplesDialog({ onClose }: { onClose: () => void }) {
	const editor = useEditor()
	return (
		<div className="AssistDialog-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
			<div className="AssistDialog ExamplesDialog" role="dialog" aria-label="Examples">
				<div className="AssistDialog-bar">
					<strong>Example workflows</strong>
					<button type="button" onClick={onClose} aria-label="Close">
						×
					</button>
				</div>
				<div className="ExamplesDialog-list">
					{EXAMPLES.map((example) => (
						<button
							key={example.id}
							type="button"
							className="ExamplesDialog-item"
							onClick={() => {
								const view = editor.getViewportPageBounds()
								loadExample(editor, example, { x: view.minX + 80, y: view.minY + 80 })
								onClose()
							}}
						>
							<span>{example.title}</span>
							<small>
								{example.nodes.length} nodes. {example.blurb}
							</small>
						</button>
					))}
				</div>
			</div>
		</div>
	)
}
