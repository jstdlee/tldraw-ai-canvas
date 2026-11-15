import { useMemo } from 'react'
import { squashRecordDiffs } from 'tldraw'
import { AgentIcon, AgentIconType } from '../../../shared/icons/AgentIcon'
import { useAgent } from '../../agent/TldrawAgentAppProvider'
import { ChatHistoryGroup } from './ChatHistoryGroup'
import { getActionInfo } from './getActionInfo'
import { TldrawDiffViewer } from './TldrawDiffViewer'

/**
 * The agent's steps that changed the canvas, with a picture of the change. WP48: there is no
 * Accept / Reject here any more: the whole turn is one preview with Apply / Adjust / Discard
 * (the "Canvas changes" task below the steps).
 */
export function ChatHistoryGroupWithDiff({ group }: { group: ChatHistoryGroup }) {
	const agent = useAgent()
	const { items } = group
	const diff = useMemo(() => squashRecordDiffs(items.map((item) => item.diff)), [items])

	const steps = useMemo(() => items.map((item) => getActionInfo(item.action, agent)), [items, agent])

	return (
		<div className="chat-history-change">
			<DiffSteps steps={steps} />
			<TldrawDiffViewer diff={diff} />
		</div>
	)
}

interface DiffStep {
	icon: AgentIconType | null
	description: string | null
}

function DiffSteps({ steps }: { steps: DiffStep[] }) {
	let previousDescription = ''
	return (
		<div className="agent-changes">
			{steps.map((step, i) => {
				if (!step.description) return null

				if (step.description === previousDescription) return null
				previousDescription = step.description
				return (
					<div className="agent-change" key={'intent-' + i}>
						{step.icon && (
							<span className="agent-change-icon">
								<AgentIcon type={step.icon} />
							</span>
						)}
						{step.description}
					</div>
				)
			})}
		</div>
	)
}
