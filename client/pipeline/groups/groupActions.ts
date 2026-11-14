import { Editor, TLGroupShape, TLShapeId } from 'tldraw'
import { concatMemberText } from '../../../shared/groupText'
import { shapeText } from '../../clips/shapeText'

export function groupSelection(editor: Editor): TLShapeId | null {
	const ids = editor.getSelectedShapeIds().filter((id) => editor.getShape(id)?.type !== 'group')
	if (ids.length < 2) return null
	editor.groupShapes(ids)
	const parent = editor.getShape(editor.getShape(ids[0])?.parentId ?? ids[0])
	if (!parent || parent.type !== 'group') return null
	editor.updateShape({ id: parent.id, type: 'group', meta: { label: 'Group' } })
	return parent.id
}

/**
 * The groups "Ungroup" acts on: the selected groups, or, inside a group (dived into),
 * the focused group when no group is selected.
 */
function ungroupTargets(editor: Editor): TLGroupShape[] {
	const selected = editor
		.getSelectedShapes()
		.filter((s): s is TLGroupShape => s.type === 'group' && !editor.isShapeOrAncestorLocked(s))
	if (selected.length) return selected
	const focused = editor.getFocusedGroup()
	if (focused?.type === 'group' && !editor.isShapeOrAncestorLocked(focused)) return [focused as TLGroupShape]
	return []
}

export function canUngroup(editor: Editor) {
	return ungroupTargets(editor).length > 0
}

/**
 * Ungroup (Ctrl+Shift+G, menu). Works on a selected group, on the group you dived into,
 * and on an open box group: its hidden box is deleted, so the cards just stay on the page.
 */
export function ungroupSelection(editor: Editor): boolean {
	const groups = ungroupTargets(editor)
	if (!groups.length) return false
	editor.run(() => {
		editor.markHistoryStoppingPoint('ungroup')
		const focusedId = editor.getFocusedGroupId()
		const leaving = groups.find((g) => focusedId === g.id || editor.hasAncestor(focusedId as TLShapeId, g.id))
		if (leaving) editor.setFocusedGroup(editor.getShape(leaving.parentId)?.type === 'group' ? (leaving.parentId as TLShapeId) : null)
		const boxIds = groups
			.map((g) => (typeof g.meta?.boxOf === 'string' ? (g.meta.boxOf as TLShapeId) : null))
			.filter((id): id is TLShapeId => !!id && !!editor.getShape(id))
		if (boxIds.length) editor.deleteShapes(boxIds)
		editor.ungroupShapes(groups.map((g) => g.id))
	})
	return true
}

export function diveGroup(editor: Editor) {
	const shape = editor.getOnlySelectedShape()
	if (!shape || shape.type !== 'group') return false
	editor.setFocusedGroup(shape.id)
	const bounds = editor.getShapePageBounds(shape.id)
	if (bounds) editor.zoomToBounds(bounds.clone().expandBy(32), { animation: { duration: 180 } })
	return true
}

export function leaveGroup(editor: Editor) {
	const group = editor.getFocusedGroup()
	if (!group || group.type !== 'group') return false
	editor.popFocusedGroupId()
	const bounds = editor.getShapePageBounds(group.id)
	if (bounds) editor.zoomToBounds(bounds.clone().expandBy(80), { animation: { duration: 180 } })
	return true
}

export function renameSelection(editor: Editor, name: string) {
	const shape = editor.getOnlySelectedShape()
	if (!shape || !name.trim()) return false
	if (shape.type === 'group') {
		editor.updateShape<TLGroupShape>({ id: shape.id, type: 'group', meta: { ...shape.meta, label: name.trim() } })
		return true
	}
	if (shape.type === 'node') {
		editor.updateShape({ id: shape.id, type: 'node', props: { label: name.trim() } })
		return true
	}
	return false
}

export function groupPlainText(editor: Editor, groupId: TLShapeId): string {
	const ids = editor.getSortedChildIdsForParent(groupId)
	return concatMemberText(ids.map((id) => shapeText(editor, editor.getShape(id)!)).filter((text) => text.length > 0))
}
