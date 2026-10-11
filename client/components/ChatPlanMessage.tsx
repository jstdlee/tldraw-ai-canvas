import { useState } from 'react'
import { Editor } from 'tldraw'
import { AiPlanRows } from '../pipeline/components/BuildPanel'
import { applyAiPlan, openBuildPanel } from '../pipeline/aiBuild'
import { IconSparkle, UiButton } from '../ui'
import { ChatPlanEntry } from './chatPlan'

/**
 * WP23 Part F: the agent chat's own rendering of a Build-with-AI plan, shown as a message in
 * the thread when the chat was sent with cards selected. Reuses the Build panel's plan rows;
 * Apply runs `applyAiPlan` (with arrange), "Open in Build panel" hands the goal to the full
 * panel, and Revise just focuses the chat input back — the revision is a normal next message.
 */
export function ChatPlanMessage({
	editor,
	entry,
	onRevise,
}: {
	editor: Editor
	entry: ChatPlanEntry
	onRevise: () => void
}) {
	const [applied, setApplied] = useState(false)
	const hasChanges = !!(entry.plan.add.length || entry.plan.update.length || entry.plan.wires.length || entry.plan.unwire.length)
	return (
		<div className="ChatPlanMessage">
			<div className="ChatPlanMessage-head">
				<IconSparkle size={14} />
				<span>Build with AI</span>
			</div>
			<div className="ChatPlanMessage-plan">
				<AiPlanRows editor={editor} plan={entry.plan} warnings={entry.warnings} />
			</div>
			<div className="ChatPlanMessage-actions">
				<UiButton
					size="sm"
					variant="primary"
					label={applied ? 'Applied' : 'Apply'}
					disabled={!hasChanges || applied}
					onClick={() => {
						applyAiPlan(editor, entry.plan, { selectedIds: entry.selectedIds })
						setApplied(true)
					}}
				/>
				<UiButton size="sm" label="Open in Build panel" onClick={() => openBuildPanel(entry.goal)} />
				<UiButton size="sm" variant="low" label="Revise" onClick={onRevise} />
			</div>
		</div>
	)
}
