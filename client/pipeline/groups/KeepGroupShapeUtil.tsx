import { GroupShapeUtil, HTMLContainer, SVGContainer, TLGroupShape } from '@tldraw/editor'

/**
 * tldraw refuses a second shape util with type "group".
 * Patch the built-in util so the outline and the label stay,
 * and a group with one child stays a group.
 */
export function installKeepGroup() {
	GroupShapeUtil.prototype.component = function (this: GroupShapeUtil, shape: TLGroupShape) {
		const bounds = this.editor.getShapeGeometry(shape).bounds
		const label = typeof shape.meta?.label === 'string' && shape.meta.label ? shape.meta.label : 'Group'
		return (
			<>
				<SVGContainer>
					<rect className="GroupOutline" x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill="none" />
				</SVGContainer>
				<HTMLContainer>
					<div className="GroupEdgeLabel" style={{ left: bounds.x, top: bounds.y - 18 }}>
						{label}
					</div>
				</HTMLContainer>
			</>
		)
	}
	GroupShapeUtil.prototype.onDoubleClick = function (this: GroupShapeUtil, shape: TLGroupShape) {
		this.editor.setFocusedGroup(shape.id)
		const bounds = this.editor.getShapePageBounds(shape.id)
		if (bounds) this.editor.zoomToBounds(bounds.clone().expandBy(32), { animation: { duration: 180 } })
	}
	GroupShapeUtil.prototype.onChildrenChange = function (this: GroupShapeUtil, group: TLGroupShape) {
		const children = this.editor.getSortedChildIdsForParent(group.id)
		if (children.length > 0) return
		if (this.editor.getCurrentPageState().focusedGroupId === group.id) this.editor.popFocusedGroupId()
		this.editor.deleteShapes([group.id])
	}
}
