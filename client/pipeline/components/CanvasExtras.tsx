import { useEffect, useState } from 'react'
import { useEditor, useValue } from 'tldraw'
import { NODE_SPECS } from '../../../shared/nodeSpecs'
import {
	IconClose,
	IconSparkle,
	UiButton,
	UiChip,
	UiIconButton,
	UiTextArea,
} from '../../ui'
import { $searchBlink } from '../../shell/shellState'
import { ModelSelect } from '../../ai/aiConfig'
import {
	$aiNote,
	$assist,
	applyNodeAssistChanges,
	assistDraft,
	NodeAssistResult,
	runNodeAssist,
	setAssistDraft,
} from '../assist'
import { openBuildPanel } from '../aiBuild'
import { BuildPanel } from './BuildPanel'

const MODEL_KEY = 'oh-my-tldraw:ai-node-model'

function loadModel(): string {
	try {
		return localStorage.getItem(MODEL_KEY) ?? ''
	} catch {
		return ''
	}
}

function saveModel(value: string) {
	try {
		localStorage.setItem(MODEL_KEY, value)
	} catch {
		// Private browsing or a full quota: the choice just does not persist.
	}
}

/** Floating AI for one node, the Build with AI panel, and the search blink. */
export function CanvasExtras() {
	const assist = useValue('assist', () => $assist.get(), [])
	const note = useValue('ai note', () => $aiNote.get(), [])

	return (
		<>
			<SearchBlink />
			{assist && <FillChatCard shapeId={assist.shapeId} onClose={() => $assist.set(null)} />}
			<BuildPanel />
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

function formatValue(value: unknown): string {
	if (value == null || value === '') return '—'
	if (typeof value === 'string') return value.length > 60 ? value.slice(0, 60) + '…' : value
	return String(value)
}

/**
 * The node's own AI specialist: a small chat card anchored just below the node
 * it was opened from. Closing it keeps the typed text; reopening restores it.
 */
function FillChatCard({ shapeId, onClose }: { shapeId: import('tldraw').TLShapeId; onClose: () => void }) {
	const editor = useEditor()
	const text = useValue('assist draft text', () => assistDraft(shapeId), [shapeId])
	const setText = (value: string) => setAssistDraft(shapeId, value)
	const [model, setModel] = useState(loadModel)
	const [error, setError] = useState<string | null>(null)
	const [result, setResult] = useState<NodeAssistResult | null>(null)
	const [busy, setBusy] = useState(false)

	const type = useValue(
		'assist node type',
		() => {
			const shape = editor.getShape(shapeId)
			return shape?.type === 'node' ? (shape.props as { node?: { type?: string } }).node?.type : undefined
		},
		[editor, shapeId]
	)
	const spec = type ? NODE_SPECS[type] : undefined

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

	const ask = async (request: string) => {
		if (!request.trim()) return
		setBusy(true)
		setError(null)
		try {
			const next = await runNodeAssist(editor, shapeId, request.trim(), { model: model || undefined })
			setResult(next)
		} catch (cause) {
			setError((cause as Error).message)
		} finally {
			setBusy(false)
		}
	}

	return (
		<div
			className="FillChatCard"
			role="dialog"
			aria-label="AI for this node"
			style={position ? { transform: `translate(${position.x}px, ${position.y}px)` } : undefined}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<div className="FillChatCard-bar">
				<strong>
					<IconSparkle /> AI{spec ? ` · ${spec.title}` : ''}
				</strong>
				<UiIconButton icon={<IconClose />} title="Close" onClick={onClose} />
			</div>
			<div className="FillChatCard-row">
				<ModelSelect
					capability="chat"
					value={model}
					onChange={(value) => {
						setModel(value)
						saveModel(value)
					}}
				/>
			</div>
			{spec && spec.assistant.chips.length > 0 && (
				<div className="FillChatCard-chips">
					{spec.assistant.chips.map((chip) => (
						<UiChip key={chip} label={chip} onClick={() => setText(chip)} />
					))}
				</div>
			)}
			<UiTextArea
				value={text}
				autoFocus
				placeholder="What should this node do?"
				rows={2}
				submitOn="enter"
				onChange={setText}
				onSubmit={() => void ask(text)}
			/>
			{error && <p className="FillChatCard-error">{error}</p>}
			{result && (
				<div className="FillChatCard-answer">
					{result.say && <p className="FillChatCard-say">{result.say}</p>}
					{result.changes.length > 0 && (
						<div className="FillChatCard-diff">
							{result.changes.map((change) => (
								<div key={change.key} className="FillChatCard-diffRow">
									<span className="FillChatCard-diffLabel">{change.label}</span>
									<span>
										{formatValue(change.before)} → {formatValue(change.after)}
									</span>
								</div>
							))}
						</div>
					)}
					{result.needs.map((need, index) => (
						<div key={index} className="FillChatCard-need">
							<span>
								Needs: a {NODE_SPECS[need.type]?.title ?? need.type} node{need.why ? ` — ${need.why}` : ''}
							</span>
							<UiButton
								size="sm"
								label="Build it"
								onClick={() => {
									editor.select(shapeId)
									onClose()
									openBuildPanel(`Add a ${NODE_SPECS[need.type]?.title ?? need.type} node: ${need.why}`)
								}}
							/>
						</div>
					))}
					{result.errors.map((err, index) => (
						<p key={index} className="FillChatCard-error">
							{err}
						</p>
					))}
				</div>
			)}
			<div className="FillChatCard-actions">
				{result?.changes.length ? (
					<>
						<UiButton
							label="Discard"
							onClick={() => {
								setResult(null)
							}}
						/>
						<UiButton
							variant="primary"
							label="Apply"
							onClick={() => {
								applyNodeAssistChanges(editor, shapeId, result.changes)
								setAssistDraft(shapeId, '')
								setResult(null)
								onClose()
							}}
						/>
					</>
				) : (
					<UiButton variant="primary" label={busy ? 'Working…' : 'Ask'} disabled={busy || !text.trim()} onClick={() => void ask(text)} />
				)}
			</div>
		</div>
	)
}

function NoteDialog({ text, onClose }: { text: string; onClose: () => void }) {
	return (
		<div className="AssistDialog-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
			<div className="AssistDialog" role="dialog" aria-label="AI answer">
				<div className="AssistDialog-bar">
					<strong>
						<IconSparkle /> AI
					</strong>
					<UiIconButton icon={<IconClose />} title="Close" onClick={onClose} />
				</div>
				<pre className="AbilityList">{text}</pre>
				<div className="AssistDialog-actions">
					<UiButton label="Close" onClick={onClose} />
				</div>
			</div>
		</div>
	)
}
