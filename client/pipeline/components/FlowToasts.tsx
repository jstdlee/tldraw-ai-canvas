import { useEffect, useRef } from 'react'
import { TldrawUiMenuItem, TLShapeId, useEditor, useToasts, useValue } from 'tldraw'
import { previewValue } from '../../../shared/flowSafety'
import { IconClose, IconTrash, UiEmpty, UiIconButton } from '../../ui'
import { $flowToasts, $variablesOpen, deleteCanvasVariable, getCanvasVariables, goToCard } from '../flowSafety'

/**
 * WP49: shows the toasts that flow cards (Ask user, Notify) queue from their `execute()`
 * (client/pipeline/flowSafety.ts). Mounted inside <Tldraw> (CanvasExtras), where `useToasts`
 * works.
 */
export function FlowToasts() {
	const editor = useEditor()
	const toasts = useToasts()
	const state = useValue('flow toasts', () => $flowToasts.get(editor), [editor])
	const shown = useRef(new Map<string, string>())

	useEffect(() => {
		if (!state.queue.length && !state.dismissed.length) return
		for (const toast of state.queue) {
			const id = toasts.addToast({
				title: toast.title,
				description: toast.description,
				severity: toast.severity ?? 'info',
				keepOpen: toast.keepOpen,
				actions: toast.shapeId
					? [{ type: 'primary', label: 'Go to card', onClick: () => goToCard(editor, toast.shapeId as TLShapeId) }]
					: undefined,
			})
			shown.current.set(toast.key, id)
		}
		for (const key of state.dismissed) {
			const id = shown.current.get(key)
			if (id) toasts.removeToast(id)
			shown.current.delete(key)
		}
		$flowToasts.set(editor, { queue: [], dismissed: [] })
	}, [state, toasts, editor])

	return <VariablesDialog />
}

/** Main menu → "Variables…": every canvas variable and its current value. */
export function VariablesMenuItem() {
	return <TldrawUiMenuItem id="canvas-variables" label="Variables…" readonlyOk onSelect={() => void $variablesOpen.set(true)} />
}

function VariablesDialog() {
	const editor = useEditor()
	const open = useValue('variables open', () => $variablesOpen.get(), [])
	const variables = useValue('canvas variables', () => getCanvasVariables(editor), [editor])
	if (!open) return null
	const names = Object.keys(variables).sort((a, b) => a.localeCompare(b))
	return (
		<div className="VariablesDialog" role="dialog" aria-label="Variables" onPointerDown={(e) => e.stopPropagation()}>
			<div className="VariablesDialog-header">
				<span className="VariablesDialog-title">Variables</span>
				<UiIconButton icon={<IconClose />} title="Close" onClick={() => $variablesOpen.set(false)} />
			</div>
			{names.length === 0 ? (
				<UiEmpty text="No variables yet. A Set variable card makes one when it runs." />
			) : (
				<ul className="VariablesDialog-list">
					{names.map((name) => (
						<li key={name} className="VariablesDialog-row">
							<span className="VariablesDialog-name">{name}</span>
							<span className="VariablesDialog-value" title={variables[name]}>
								{previewValue(variables[name]) || <em>empty</em>}
							</span>
							<UiIconButton icon={<IconTrash />} title={`Delete ${name}`} onClick={() => deleteCanvasVariable(editor, name)} />
						</li>
					))}
				</ul>
			)}
			<div className="VariablesDialog-hint">Saved with the canvas. Scope: the whole canvas.</div>
		</div>
	)
}
