import { TLShapeId } from 'tldraw'
import { AiPlan } from '../../shared/aiPlan'

/**
 * WP23 Part F: when the chat is sent with cards selected, it runs Build with AI instead of
 * the drawing agent, and shows the result as a plan message in the chat thread (ChatPanel)
 * instead of opening the Build panel. `selectedIds` is the scope the plan was built for —
 * Apply uses it the same way the Build panel does ("arrange: tidy" moves these cards too).
 */
export interface ChatPlanEntry {
	id: string
	goal: string
	plan: AiPlan
	warnings: string[]
	selectedIds: TLShapeId[]
}
