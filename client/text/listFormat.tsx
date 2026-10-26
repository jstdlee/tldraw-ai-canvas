/**
 * List formats for every rich-text shape (text, note, geo label, arrow label):
 * bullets and numbers (tldraw's StarterKit has them) plus checklists (TipTap TaskList/TaskItem).
 *
 * - canvasTipTapExtensions: tldraw's default extensions + checklists. Pass as options.text.tipTapConfig.
 * - ListsRichTextToolbar: tldraw's selection toolbar with Numbered list and Checklist buttons added.
 * - registerChecklistClicks: tick a checkbox on the canvas without entering text edit mode.
 *
 * Typing shortcuts while editing: "- " bullets, "1. " numbers, "[ ] " checklist;
 * Ctrl+Shift+8 / 7 / 9 toggle them; Tab / Shift+Tab nest.
 */
import { getMarkRange, type Editor as TextEditor } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { StarterKit } from '@tiptap/starter-kit'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	Box,
	debounce,
	Editor,
	openWindow,
	preventDefault,
	TLShapeId,
	TldrawUiButton,
	TldrawUiButtonIcon,
	TldrawUiContextualToolbar,
	TldrawUiInput,
	TldrawUiToolbarButton,
	TLRichText,
	TLUiIconJsx,
	tipTapDefaultExtensions,
	track,
	useEditor,
	useTranslation,
	useValue,
} from 'tldraw'
import { setListKind, toggleTaskAt, type ListKind, type RichDoc } from '../../shared/richTextLists'

export const canvasTipTapExtensions = [
	// Same StarterKit settings as tldraw, plus: no empty paragraph forced after a checklist.
	StarterKit.configure({
		blockquote: false,
		codeBlock: false,
		horizontalRule: false,
		link: { openOnClick: false, autolink: true },
		trailingNode: { notAfter: ['paragraph', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem'] },
	}),
	...tipTapDefaultExtensions.filter((e) => e.name !== 'starterKit'),
	TaskList,
	// The edit-mode node view only copies HTMLAttributes, so name the type here for the CSS.
	TaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }),
]

const svg = (body: React.ReactNode): TLUiIconJsx => (
	<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
		{body}
	</svg>
)

export const NumberedListIcon = svg(
	<>
		<path d="M7.5 4.5h8M7.5 9h8M7.5 13.5h8" strokeLinecap="round" />
		<path d="M2.6 3.4 3.6 3v3.2M2.4 8.3c.3-.5 1.8-.6 1.8.3 0 .7-1.8 1.4-1.8 2h1.9" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.1" />
		<path d="M2.4 12.4c.4-.4 1.8-.4 1.8.4 0 .4-.4.6-.9.6.5 0 1 .2 1 .7 0 .8-1.5.9-1.9.4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.1" />
	</>
)

export const ChecklistIcon = svg(
	<>
		<rect x="1.8" y="2.3" width="4.2" height="4.2" rx="1" />
		<path d="m2.7 11.6 1 1 1.8-2.1" strokeLinecap="round" strokeLinejoin="round" />
		<rect x="1.8" y="9.3" width="4.2" height="4.2" rx="1" />
		<path d="M8.5 4.4h7M8.5 11.4h7" strokeLinecap="round" />
	</>
)

export const BulletListIcon = svg(
	<>
		<circle cx="3.2" cy="4.5" r="1.1" fill="currentColor" stroke="none" />
		<circle cx="3.2" cy="9" r="1.1" fill="currentColor" stroke="none" />
		<circle cx="3.2" cy="13.5" r="1.1" fill="currentColor" stroke="none" />
		<path d="M7 4.5h8.5M7 9h8.5M7 13.5h8.5" strokeLinecap="round" />
	</>
)

// ---------------------------------------------------------------------------------------------
// Selection toolbar. tldraw's own toolbar has a fixed button list (no list kinds besides bullets)
// and does not export its link editor, so this is a copy of DefaultRichTextToolbar with more buttons.

export const ListsRichTextToolbar = track(function ListsRichTextToolbar() {
	const editor = useEditor()
	const textEditor = useValue('textEditor', () => editor.getRichTextEditor(), [editor])
	if (editor.getInstanceState().isCoarsePointer || !textEditor) return null
	return <ToolbarInner textEditor={textEditor} />
})

function rectToBox(r: DOMRect) {
	return new Box(r.x, r.y, r.width, r.height)
}

function ToolbarInner({ textEditor }: { textEditor: TextEditor }) {
	const editor = useEditor()
	const msg = useTranslation()
	const [isEditingLink, setIsEditingLink] = useState(false)
	const [selection, setSelection] = useState<unknown>(null)
	const lastBounds = useRef<Box | undefined>(undefined)
	const isMousingDown = useIsMousingDown(textEditor)

	useEffect(() => {
		const onSel = () => setSelection(textEditor.state.selection)
		textEditor.on('selectionUpdate', onSel)
		onSel()
		const onClick = () => setIsEditingLink(textEditor.isActive('link'))
		textEditor.view.dom.addEventListener('click', onClick)
		return () => {
			textEditor.off('selectionUpdate', onSel)
			if (textEditor.isInitialized) textEditor.view.dom.removeEventListener('click', onClick)
		}
	}, [textEditor])

	// Opening the link editor on a collapsed caret selects the whole link first.
	useEffect(() => {
		if (!textEditor.isActive('link')) return
		try {
			const { from, to } = getMarkRange(
				textEditor.state.doc.resolve(textEditor.state.selection.from),
				textEditor.schema.marks.link
			)!
			if (textEditor.state.selection.empty) textEditor.commands.setTextSelection({ from, to })
		} catch {
			// no link range under the caret
		}
	}, [textEditor, isEditingLink])

	const getSelectionBounds = useCallback(() => {
		if (isEditingLink) return lastBounds.current
		const sel = (editor.getContainer().ownerDocument.defaultView ?? window).getSelection()
		if (!selection || !sel || sel.rangeCount === 0 || sel.isCollapsed) return
		const boxes: Box[] = []
		for (let i = 0; i < sel.rangeCount; i++) boxes.push(rectToBox(sel.getRangeAt(i).getBoundingClientRect()))
		lastBounds.current = Box.Common(boxes)
		return lastBounds.current
	}, [editor, selection, isEditingLink])

	const closeLink = useCallback(() => {
		setIsEditingLink(false)
		const from = textEditor.state.selection.from
		textEditor.commands.setTextSelection({ from, to: from })
	}, [textEditor])

	return (
		<TldrawUiContextualToolbar
			className="tlui-rich-text__toolbar"
			getSelectionBounds={getSelectionBounds}
			isMousingDown={isMousingDown}
			changeOnlyWhenYChanges
			label={msg('tool.rich-text-toolbar-title')}
		>
			{isEditingLink ? (
				<LinkEditor
					textEditor={textEditor}
					value={textEditor.isActive('link') ? textEditor.getAttributes('link').href : ''}
					onClose={closeLink}
				/>
			) : (
				<ToolbarButtons textEditor={textEditor} onEditLinkStart={() => setIsEditingLink(true)} />
			)}
		</TldrawUiContextualToolbar>
	)
}

type ButtonDef = { name: string; title: string; icon: string | TLUiIconJsx; onSelect(): void }

function ToolbarButtons({ textEditor, onEditLinkStart }: { textEditor: TextEditor; onEditLinkStart(): void }) {
	const editor = useEditor()
	const msg = useTranslation()
	const [, rerender] = useState(0)
	useEffect(() => {
		const bump = () => rerender((t) => t + 1)
		textEditor.on('update', bump)
		textEditor.on('selectionUpdate', bump)
		return () => {
			textEditor.off('update', bump)
			textEditor.off('selectionUpdate', bump)
		}
	}, [textEditor])
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
				e.preventDefault()
				onEditLinkStart()
			}
		}
		const doc = editor.getContainer().ownerDocument
		doc.addEventListener('keydown', onKey)
		return () => doc.removeEventListener('keydown', onKey)
	}, [editor, onEditLinkStart])

	const buttons = useMemo<ButtonDef[]>(() => {
		const run = (cmd: string) => () => {
			if (!textEditor.view) return
			;(textEditor.chain().focus() as any)[cmd]().run()
		}
		return [
			{ name: 'bold', title: msg('tool.rich-text-bold'), icon: 'bold', onSelect: run('toggleBold') },
			{ name: 'italic', title: msg('tool.rich-text-italic'), icon: 'italic', onSelect: run('toggleItalic') },
			{ name: 'code', title: msg('tool.rich-text-code'), icon: 'code', onSelect: run('toggleCode') },
			{ name: 'link', title: msg('tool.rich-text-link'), icon: 'link', onSelect: onEditLinkStart },
			{ name: 'bulletList', title: 'Bulleted list (Ctrl+Shift+8)', icon: BulletListIcon, onSelect: run('toggleBulletList') },
			{ name: 'orderedList', title: 'Numbered list (Ctrl+Shift+7)', icon: NumberedListIcon, onSelect: run('toggleOrderedList') },
			{ name: 'taskList', title: 'Checklist (Ctrl+Shift+9)', icon: ChecklistIcon, onSelect: run('toggleTaskList') },
			{ name: 'highlight', title: msg('tool.rich-text-highlight'), icon: 'highlight', onSelect: run('toggleHighlight') },
		]
	}, [textEditor, msg, onEditLinkStart])

	return (
		<>
			{buttons.map(({ name, title, icon, onSelect }) => {
				const isActive = textEditor.view ? textEditor.isActive(name) : false
				return (
					<TldrawUiToolbarButton
						key={name}
						title={title}
						data-testid={`rich-text.${name}`}
						type="icon"
						isActive={isActive}
						onPointerDown={preventDefault}
						onClick={onSelect}
						role="option"
						aria-pressed={isActive}
					>
						<TldrawUiButtonIcon small icon={icon} />
					</TldrawUiToolbarButton>
				)
			})}
		</>
	)
}

function LinkEditor({ textEditor, value: initial, onClose }: { textEditor: TextEditor; value: string; onClose(): void }) {
	const editor = useEditor()
	const msg = useTranslation()
	const [value, setValue] = useState(initial)
	const ref = useRef<HTMLInputElement>(null)

	const complete = useCallback(
		(link: string) => {
			if (!/^https?:\/\//.test(link)) link = `https://${link}`
			textEditor.chain().setLink({ href: link }).run()
			if (editor.getInstanceState().isCoarsePointer) textEditor.commands.blur()
			else textEditor.commands.focus()
			onClose()
		},
		[textEditor, editor, onClose]
	)
	const remove = useCallback(() => {
		textEditor.chain().unsetLink().focus().run()
		onClose()
	}, [textEditor, onClose])

	useEffect(() => {
		const doc = editor.getContainer().ownerDocument
		const onDown = (e: PointerEvent) => {
			if (doc.querySelector('.tlui-rich-text__toolbar')?.contains(e.target as Node)) return
			if (value) complete(value)
			else remove()
		}
		doc.addEventListener('pointerdown', onDown, { capture: true })
		return () => doc.removeEventListener('pointerdown', onDown, { capture: true })
	}, [editor, complete, remove, value])
	useEffect(() => ref.current?.focus(), [value])
	useEffect(() => setValue(initial), [initial])

	return (
		<>
			<TldrawUiInput
				ref={ref}
				data-testid="rich-text.link-input"
				className="tlui-rich-text__toolbar-link-input"
				value={value}
				onValueChange={setValue}
				onComplete={complete}
				onCancel={onClose}
				placeholder="example.com"
				aria-label="example.com"
			/>
			<TldrawUiButton
				className="tlui-rich-text__toolbar-link-visit"
				title={msg('tool.rich-text-link-visit')}
				type="icon"
				onPointerDown={preventDefault}
				onClick={() => {
					openWindow(value.startsWith('http') ? value : `https://${value}`, '_blank')
					onClose()
				}}
				disabled={!value}
			>
				<TldrawUiButtonIcon small icon="external-link" />
			</TldrawUiButton>
			<TldrawUiButton
				className="tlui-rich-text__toolbar-link-remove"
				title={msg('tool.rich-text-link-remove')}
				data-testid="rich-text.link-remove"
				type="icon"
				onPointerDown={preventDefault}
				onClick={remove}
			>
				<TldrawUiButtonIcon small icon="trash" />
			</TldrawUiButton>
		</>
	)
}

function useIsMousingDown(textEditor: TextEditor) {
	const [down, setDown] = useState(false)
	useEffect(() => {
		const set = debounce((v: boolean) => setDown(v), 16)
		const onDown = () => set(true)
		const onUp = () => set(false)
		const downs = ['touchstart', 'pointerdown', 'mousedown']
		const ups = ['touchend', 'pointerup', 'mouseup']
		const body = textEditor.view.dom.ownerDocument.body
		downs.forEach((n) => textEditor.view.dom.addEventListener(n, onDown))
		ups.forEach((n) => body.addEventListener(n, onUp))
		return () => {
			if (textEditor.isInitialized) downs.forEach((n) => textEditor.view.dom.removeEventListener(n, onDown))
			ups.forEach((n) => body.removeEventListener(n, onUp))
			set.cancel()
		}
	}, [textEditor])
	return down
}

// ---------------------------------------------------------------------------------------------
// Canvas helpers

function richTextShapes(editor: Editor) {
	return editor
		.getSelectedShapes()
		.filter((s) => (s.props as { richText?: TLRichText }).richText && !editor.isShapeOrAncestorLocked(s))
}

export function selectionHasRichText(editor: Editor) {
	return richTextShapes(editor).length > 0
}

/** Formats the whole text of each selected text/note/geo shape as one list kind (null = plain). */
export function formatSelectionAsList(editor: Editor, kind: ListKind | null) {
	const shapes = richTextShapes(editor)
	if (!shapes.length) return
	editor.markHistoryStoppingPoint('format-list')
	editor.updateShapes(
		shapes.map((s) => ({
			id: s.id,
			type: s.type,
			props: { richText: setListKind((s.props as { richText: RichDoc }).richText, kind) as TLRichText },
		})) as any
	)
}

/**
 * A checkbox in a shape that is not being edited sits in static HTML, so a click would only flip the
 * DOM box and also select the shape. Catch it first (capture phase), flip the item in the store
 * (one undo step), and keep tldraw from seeing the press. Edit mode uses TipTap's own checkbox.
 */
export function registerChecklistClicks(editor: Editor): () => void {
	const container = editor.getContainer()
	const staticBox = (target: EventTarget | null) => {
		const el = target as HTMLElement | null
		if (!el || el.tagName !== 'INPUT' || (el as HTMLInputElement).type !== 'checkbox') return null
		if (!el.closest('.tl-rich-text li[data-type="taskItem"]') || el.closest('[contenteditable="true"]')) return null
		return el as HTMLInputElement
	}
	const onDown = (e: PointerEvent) => {
		const box = staticBox(e.target)
		if (!box || e.button !== 0) return
		e.stopPropagation()
		e.preventDefault()
		if (editor.getIsReadonly()) return
		const shapeEl = box.closest('.tl-shape')
		const id = shapeEl?.getAttribute('data-shape-id') as TLShapeId | null
		const shape = id ? editor.getShape(id) : undefined
		const richText = (shape?.props as { richText?: RichDoc } | undefined)?.richText
		if (!shape || !richText || editor.isShapeOrAncestorLocked(shape)) return
		const boxes = Array.from(shapeEl!.querySelectorAll<HTMLInputElement>('li[data-type="taskItem"] > label > input'))
		const index = boxes.indexOf(box)
		if (index < 0) return
		editor.markHistoryStoppingPoint('toggle-task')
		editor.updateShape({ id: shape.id, type: shape.type, props: { richText: toggleTaskAt(richText, index) } } as any)
	}
	// The browser would still flip the static box on click; the store change re-renders it anyway.
	const onClick = (e: MouseEvent) => {
		if (staticBox(e.target)) e.preventDefault()
	}
	container.addEventListener('pointerdown', onDown, true)
	container.addEventListener('click', onClick, true)
	return () => {
		container.removeEventListener('pointerdown', onDown, true)
		container.removeEventListener('click', onClick, true)
	}
}
