import { useEditor, useToasts } from 'tldraw'
import type { Notify } from './canvasFeatures'
import { CompareModal } from './CompareDialog'

/**
 * Mount inside <Tldraw>: the Compare dialog, with toasts for its messages. WP44: Rewrite and
 * the Rewrite presets editor are sheets in the agent panel now (client/components/AgentSheets.tsx).
 */
export function RewriteDialogs() {
	const editor = useEditor()
	const toasts = useToasts()
	const notify: Notify = (title, severity = 'info') => toasts.addToast({ title, severity, keepOpen: severity === 'error' })
	return <CompareModal editor={editor} notify={notify} />
}
