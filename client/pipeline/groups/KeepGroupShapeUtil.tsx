import { GroupShapeUtil, HTMLContainer, SVGContainer, TLGroupShape } from '@tldraw/editor'
import { IconCollapse, IconGroup, UiIconButton } from '../../ui'
import { collapseGroup } from '../subgraph'

/**
 * tldraw refuses a second shape util with type "group".
 * Patch the built-in util so the outline and the label stay,
 * and a group with one child stays a group.
 */
export function installKeepGroup() {
	GroupShapeUtil.prototype.component = function (this: GroupShapeUtil, shape: TLGroupShape) {
		const editor = this.editor
		const bounds = editor.getShapeGeometry(shape).bounds
		const boxId = typeof shape.meta?.boxOf === 'string' ? shape.meta.boxOf : null
		const label = typeof shape.meta?.label === 'string' && shape.meta.label ? shape.meta.label : 'Group'
		return (
			<>
				<SVGContainer>
					<rect
						className={boxId ? 'GroupOutline GroupOutline_box' : 'GroupOutline'}
						x={bounds.x}
						y={bounds.y}
						width={bounds.width}
						height={bounds.height}
						fill="none"
					/>
				</SVGContainer>
				<HTMLContainer>
					<div
						className={boxId ? 'GroupEdgeLabel GroupEdgeLabel_box' : 'GroupEdgeLabel GroupEdgeLabel_tools'}
						style={{ left: bounds.x, top: bounds.y - (boxId ? 24 : 22) }}
						onPointerDown={(e) => e.stopPropagation()}
					>
						{boxId && <IconGroup size={13} />}
						<span className="GroupEdgeLabel-text">{label}</span>
						{/* WP47: every group folds into one card (an expanded box folds back into its box). */}
						<UiIconButton
							className="GroupEdgeLabel-collapse"
							icon={<IconCollapse size={13} />}
							title="Collapse to one card (Alt+Shift+C)"
							onClick={() => void collapseGroup(editor, shape.id)}
						/>
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
