import { useState } from 'react'
import { Editor, useEditor, useToasts, useValue } from 'tldraw'
import { joinInstructions, REWRITE_PRESETS, RewritePreset, rewriteLabel } from '../../shared/rewrite'
import type { Notify } from './canvasFeatures'
import { ClipModal } from './ClipModal'
import { CompareModal } from './CompareDialog'
import { $presetsEditorOpen, $rewritePresets, $rewriteTargets, runRewrite, saveRewritePresets } from './rewrite'
import './rewrite.css'

const LAST_KEY = 'ai-canvas.rewrite.last'

function loadLast(): { presets: string[]; note: string } {
	try {
		return { presets: [], note: '', ...JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') }
	} catch {
		return { presets: [], note: '' }
	}
}

/** Pick presets and/or write a note, then make one variant per selected text. */
export function RewriteModal({ editor, notify }: { editor: Editor; notify: Notify }) {
	const targets = useValue('rewrite targets', () => $rewriteTargets.get(), [])
	// While the presets editor is open the Rewrite dialog waits behind it (its targets are kept).
	const editing = useValue('presets editor', () => $presetsEditorOpen.get(), [])
	if (!targets || editing) return null
	return <RewriteDialog editor={editor} notify={notify} targets={targets} onClose={() => $rewriteTargets.set(null)} />
}

function RewriteDialog({ editor, notify, targets, onClose }: { editor: Editor; notify: Notify; targets: Parameters<typeof runRewrite>[2]; onClose: () => void }) {
	const list = useValue('rewrite presets', () => $rewritePresets.get(), [])
	const [picked, setPicked] = useState<string[]>(() => loadLast().presets)
	const [note, setNote] = useState(() => loadLast().note)
	const instructions = joinInstructions(list, picked, note)
	const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
	const go = () => {
		if (!instructions) return
		try {
			localStorage.setItem(LAST_KEY, JSON.stringify({ presets: picked, note }))
		} catch {}
		onClose()
		void runRewrite(editor, notify, targets, instructions, rewriteLabel(list, picked, note))
	}
	return (
		<ClipModal editor={editor} className="rewrite-dialog" label={`Rewrite ${targets.length > 1 ? `${targets.length} texts` : 'text'}`} onClose={onClose}>
			<div className="ai-dialog__body rewrite-body">
				<div className="rewrite-chips">
					{list.map((p) => (
						<button key={p.id} className={'ai-chip' + (picked.includes(p.id) ? ' is-on' : '')} title={p.prompt} onClick={() => toggle(p.id)}>
							{p.label}
						</button>
					))}
				</div>
				<textarea
					className="rewrite-note"
					autoFocus
					rows={3}
					placeholder="Your own instruction (optional), e.g. keep product names, max 3 sentences"
					value={note}
					onChange={(e) => setNote(e.target.value)}
					onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && go()}
				/>
				<span className="ai-muted">Each run adds a new variant to the right. The original stays until you choose “Use this version”.</span>
			</div>
			<div className="ai-dialog__footer">
				<button className="rewrite-edit-link" onClick={() => $presetsEditorOpen.set(true)}>
					Edit presets…
				</button>
				<span className="ai-spacer" />
				<button className="ai-button" onClick={onClose}>
					Cancel
				</button>
				<button className="ai-button is-primary" disabled={!instructions} onClick={go} title="Ctrl+Enter">
					Rewrite
				</button>
			</div>
		</ClipModal>
	)
}

/** Add, edit, reorder and remove the Rewrite presets. Nothing changes until Save. */
export function PresetsEditorModal({ editor, notify }: { editor: Editor; notify: Notify }) {
	const open = useValue('presets editor', () => $presetsEditorOpen.get(), [])
	if (!open) return null
	return <PresetsEditor editor={editor} notify={notify} onClose={() => $presetsEditorOpen.set(false)} />
}

function PresetsEditor({ editor, notify, onClose }: { editor: Editor; notify: Notify; onClose: () => void }) {
	const [draft, setDraft] = useState<RewritePreset[]>(() => $rewritePresets.get().map((p) => ({ ...p })))
	const [isDefault, setIsDefault] = useState(false)
	const set = (i: number, patch: Partial<RewritePreset>) => {
		setIsDefault(false)
		setDraft((d) => d.map((p, k) => (k === i ? { ...p, ...patch } : p)))
	}
	const move = (i: number, by: number) =>
		setDraft((d) => {
			const j = i + by
			if (j < 0 || j >= d.length) return d
			const next = [...d]
			;[next[i], next[j]] = [next[j], next[i]]
			return next
		})
	const incomplete = draft.some((p) => !p.label.trim() || !p.prompt.trim())
	const save = () => {
		saveRewritePresets(isDefault ? null : draft.map((p) => ({ ...p, label: p.label.trim(), prompt: p.prompt.trim() })))
		notify(isDefault ? 'Rewrite presets reset to the defaults' : `Saved ${draft.length} rewrite presets`, 'success')
		onClose()
	}
	return (
		<ClipModal editor={editor} className="presets-dialog" label="Rewrite presets" onClose={onClose}>
			<div className="ai-dialog__body presets-body">
				<span className="ai-muted">The label is the chip name and the arrow label. The prompt is the instruction the AI gets.</span>
				{draft.map((p, i) => (
					<div key={p.id} className="presets-row">
						<input
							className={'presets-label' + (p.label.trim() ? '' : ' is-missing')}
							value={p.label}
							placeholder="Label"
							aria-label="Label"
							onChange={(e) => set(i, { label: e.target.value })}
						/>
						<textarea
							className={'presets-prompt' + (p.prompt.trim() ? '' : ' is-missing')}
							value={p.prompt}
							rows={2}
							placeholder="Instruction for the AI, e.g. Rewrite it as a short tweet."
							aria-label="Prompt"
							onChange={(e) => set(i, { prompt: e.target.value })}
						/>
						<div className="presets-tools">
							<button className="ai-icon-button" disabled={i === 0} onClick={() => move(i, -1)} title="Move up" aria-label="Move up">
								↑
							</button>
							<button className="ai-icon-button" disabled={i === draft.length - 1} onClick={() => move(i, 1)} title="Move down" aria-label="Move down">
								↓
							</button>
							<button className="ai-icon-button" onClick={() => setDraft((d) => d.filter((_, k) => k !== i))} title="Remove" aria-label="Remove">
								✕
							</button>
						</div>
					</div>
				))}
				<div className="presets-actions">
					<button className="ai-button" onClick={() => setDraft((d) => [...d, { id: `p${Date.now().toString(36)}`, label: '', prompt: '' }])}>
						+ Add preset
					</button>
					<button
						className="ai-button"
						onClick={() => {
							setDraft(REWRITE_PRESETS.map((p) => ({ ...p })))
							setIsDefault(true)
						}}
					>
						Reset to defaults
					</button>
				</div>
			</div>
			<div className="ai-dialog__footer">
				{incomplete && <span className="ai-status is-error">Fill in the label and the prompt of every preset.</span>}
				<span className="ai-spacer" />
				<button className="ai-button" onClick={onClose}>
					Cancel
				</button>
				<button className="ai-button is-primary" disabled={incomplete || !draft.length} onClick={save}>
					Save
				</button>
			</div>
		</ClipModal>
	)
}

/** Mount inside <Tldraw>: the Rewrite, presets and Compare dialogs, with toasts for progress. */
export function RewriteDialogs() {
	const editor = useEditor()
	const toasts = useToasts()
	const notify: Notify = (title, severity = 'info') => toasts.addToast({ title, severity, keepOpen: severity === 'error' })
	return (
		<>
			<RewriteModal editor={editor} notify={notify} />
			<PresetsEditorModal editor={editor} notify={notify} />
			<CompareModal editor={editor} notify={notify} />
		</>
	)
}
