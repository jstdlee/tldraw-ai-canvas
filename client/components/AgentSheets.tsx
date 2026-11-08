import { useState } from 'react'
import { useValue } from 'tldraw'
import { joinInstructions, REWRITE_PRESETS, RewritePreset, rewriteLabel } from '../../shared/rewrite'
import { $rewritePresets, saveRewritePresets } from '../clips/rewrite'
import {
	IconChevronDown,
	IconChevronUp,
	IconPlus,
	IconTrash,
	UiButton,
	UiChip,
	UiIconButton,
	UiTextArea,
	UiTextInput,
} from '../ui'

const LAST_KEY = 'ai-canvas.rewrite.last'

function loadLast(): { presets: string[]; note: string } {
	try {
		return { presets: [], note: '', ...JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') }
	} catch {
		return { presets: [], note: '' }
	}
}

/**
 * WP44: Rewrite as a sheet above the agent panel's input (was the Rewrite dialog). Pick presets
 * and/or write a note; Rewrite makes one variant per selected text, as a task in the thread.
 */
export function RewriteSheet({
	scopeLabel,
	onRun,
	onEditPresets,
	onClose,
}: {
	scopeLabel: string
	onRun: (instructions: string, label: string) => void
	onEditPresets: () => void
	onClose: () => void
}) {
	const list = useValue('rewrite presets', () => $rewritePresets.get(), [])
	const [picked, setPicked] = useState<string[]>(() => loadLast().presets)
	const [note, setNote] = useState(() => loadLast().note)
	const instructions = joinInstructions(list, picked, note)
	const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
	const go = () => {
		if (!instructions) return
		try {
			localStorage.setItem(LAST_KEY, JSON.stringify({ presets: picked, note }))
		} catch {
			// Private mode: the last choice just is not remembered.
		}
		onRun(instructions, rewriteLabel(list, picked, note))
	}
	return (
		<div className="agent-sheet agent-sheet-rewrite" role="group" aria-label="Rewrite" onKeyDownCapture={(e) => e.key === 'Escape' && onClose()}>
			<div className="agent-sheet-head">
				<strong>Rewrite {scopeLabel.toLowerCase()}</strong>
				<button type="button" className="agent-sheet-link" onClick={onEditPresets}>
					Edit presets…
				</button>
			</div>
			<div className="agent-sheet-chips">
				{list.map((p) => (
					<UiChip key={p.id} label={p.label} active={picked.includes(p.id)} onClick={() => toggle(p.id)} />
				))}
			</div>
			<UiTextArea
				className="agent-sheet-note"
				autoFocus
				rows={2}
				placeholder="Your own instruction (optional), e.g. keep product names, max 3 sentences"
				value={note}
				onChange={setNote}
				submitOn="mod-enter"
				onSubmit={go}
			/>
			<span className="agent-sheet-hint">Each run adds a new variant to the right. The original stays until you choose “Use this version”.</span>
			<div className="agent-sheet-actions">
				<UiButton label="Cancel" onClick={onClose} />
				<UiButton variant="primary" label="Rewrite" title="Rewrite (Ctrl+Enter)" disabled={!instructions} onClick={go} />
			</div>
		</div>
	)
}

/** WP44: the Rewrite presets editor as a sheet (was a dialog). Nothing changes until Save. */
export function PresetsSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
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
		onSaved(isDefault ? 'Rewrite presets reset to the defaults' : `Saved ${draft.length} rewrite presets`)
		onClose()
	}
	return (
		<div className="agent-sheet agent-sheet-presets" role="group" aria-label="Rewrite presets" onKeyDownCapture={(e) => e.key === 'Escape' && onClose()}>
			<div className="agent-sheet-head">
				<strong>Rewrite presets</strong>
			</div>
			<span className="agent-sheet-hint">The label is the chip name and the arrow label. The prompt is the instruction the AI gets.</span>
			<div className="agent-presets-list">
				{draft.map((p, i) => (
					<div key={p.id} className="agent-presets-row">
						<div className="agent-presets-top">
							<UiTextInput value={p.label} placeholder="Label" onChange={(value) => set(i, { label: value })} />
							<UiIconButton icon={<IconChevronUp />} title="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
							<UiIconButton icon={<IconChevronDown />} title="Move down" disabled={i === draft.length - 1} onClick={() => move(i, 1)} />
							<UiIconButton icon={<IconTrash />} title="Remove" onClick={() => setDraft((d) => d.filter((_, k) => k !== i))} />
						</div>
						<UiTextArea
							rows={2}
							value={p.prompt}
							placeholder="Instruction for the AI, e.g. Rewrite it as a short tweet."
							onChange={(value) => set(i, { prompt: value })}
						/>
					</div>
				))}
			</div>
			<div className="agent-sheet-actions agent-sheet-actions-start">
				<UiButton
					icon={<IconPlus />}
					label="Add preset"
					onClick={() => setDraft((d) => [...d, { id: `p${Date.now().toString(36)}`, label: '', prompt: '' }])}
				/>
				<UiButton
					label="Reset to defaults"
					onClick={() => {
						setDraft(REWRITE_PRESETS.map((p) => ({ ...p })))
						setIsDefault(true)
					}}
				/>
			</div>
			{incomplete && <span className="agent-sheet-error">Fill in the label and the prompt of every preset.</span>}
			<div className="agent-sheet-actions">
				<UiButton label="Cancel" onClick={onClose} />
				<UiButton variant="primary" label="Save" disabled={incomplete || !draft.length} onClick={save} />
			</div>
		</div>
	)
}
