import { useState } from 'react'
import { atom, useEditor, useValue } from 'tldraw'
import { EXAMPLES } from '../../../shared/examples'
import { catalogPrompt } from '../../../shared/nodeCatalog'
import { $assist, runCompose, runFill } from '../assist'
import { loadExample } from '../loadExample'

export const $examplesOpen = atom('examples open', false)

/** Floating AI for the selection, the assist dialog, and the examples dialog. */
export function CanvasExtras() {
	const editor = useEditor()
	const assist = useValue('assist', () => $assist.get(), [])
	const examplesOpen = useValue('examples', () => $examplesOpen.get(), [])
	const selected = useValue('selected nodes', () => editor.getSelectedShapes().filter((shape) => shape.type === 'node'), [editor])

	return (
		<>
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
			{assist && (
				<AssistDialog
					title={assist.mode === 'fill' ? 'What should this node do?' : 'What should these nodes do?'}
					hint={
						assist.mode === 'fill'
							? 'The agent fills this node’s fields.'
							: 'The agent wires the selection, fills fields, and adds any node that is missing.'
					}
					onClose={() => $assist.set(null)}
					onSubmit={async (intent) => {
						if (assist.mode === 'fill') await runFill(editor, assist.shapeId, intent)
						else await runCompose(editor, assist.shapeIds, intent)
						$assist.set(null)
					}}
				/>
			)}
			{examplesOpen && <ExamplesDialog onClose={() => $examplesOpen.set(false)} />}
		</>
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
