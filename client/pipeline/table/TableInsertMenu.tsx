import { useState } from 'react'
import { TldrawUiButton, TldrawUiButtonIcon, TldrawUiPopover, TldrawUiPopoverContent, TldrawUiPopoverTrigger, useEditor } from 'tldraw'
import { IconTable } from '../../ui'
import { TABLE_TEMPLATE_LABELS, type TableTemplateId } from '../../../shared/table/canvasTableOps'
import { insertBlankTable, insertTableTemplate } from './TableShapeUtil'

/** Toolbar "Table" button: a hover size-picker (up to 10x10) plus the four WP40 templates. */
export function TableInsertMenu() {
	const editor = useEditor()
	const [isOpen, setIsOpen] = useState(false)
	const [hover, setHover] = useState({ cols: 3, rows: 3 })

	return (
		<TldrawUiPopover id="table-insert-menu" open={isOpen} onOpenChange={setIsOpen}>
			<TldrawUiPopoverTrigger>
				<TldrawUiButton type="icon" title="Insert table">
					<TldrawUiButtonIcon icon={<IconTable />} />
				</TldrawUiButton>
			</TldrawUiPopoverTrigger>
			<TldrawUiPopoverContent side="bottom" align="start" sideOffset={8}>
				<div className="TableInsertMenu-popover">
					<div className="TableInsertMenu-size">
						{hover.cols} × {hover.rows}
					</div>
					<div className="TableInsertMenu-grid" onMouseLeave={() => setHover({ cols: 3, rows: 3 })}>
						{Array.from({ length: 100 }, (_, i) => {
							const row = Math.floor(i / 10) + 1
							const col = (i % 10) + 1
							const picked = col <= hover.cols && row <= hover.rows
							return (
								<div
									key={i}
									className={picked ? 'TableInsertMenu-cell picked' : 'TableInsertMenu-cell'}
									onMouseEnter={() => setHover({ cols: col, rows: row })}
									onClick={() => {
										insertBlankTable(editor, hover.cols, hover.rows)
										setIsOpen(false)
									}}
								/>
							)
						})}
					</div>
					<div className="TableInsertMenu-templates">
						{(Object.keys(TABLE_TEMPLATE_LABELS) as TableTemplateId[]).map((id) => (
							<button
								key={id}
								type="button"
								className="TableInsertMenu-templateBtn"
								onClick={() => {
									insertTableTemplate(editor, id)
									setIsOpen(false)
								}}
							>
								{TABLE_TEMPLATE_LABELS[id]}
							</button>
						))}
					</div>
				</div>
			</TldrawUiPopoverContent>
		</TldrawUiPopover>
	)
}
