import {
	DefaultContextMenu,
	DefaultContextMenuContent,
	Editor,
	TLUiActionsContextType,
	TLUiContextMenuProps,
	TLUiOverrideHelpers,
	TldrawUiMenuActionItem,
	TldrawUiMenuGroup,
	TldrawUiMenuSubmenu,
	useEditor,
	useValue,
} from 'tldraw'
import {
	aiAskSelection,
	aiDescribeImage,
	aiExplainSelection,
	aiExtractText,
	aiTextJob,
	createClipAtCenter,
	fetchPageAsMarkdown,
	insertDateTime,
	makeQrCode,
	Notify,
	selectedImage,
	sendImageToPipeline,
	wordCount,
} from './canvasFeatures'
import { $findOpen } from './FindBar'
import { $imageEditorTarget } from './ImageEditor'
import { packSelection, unpack } from '../pipeline/subgraph'

export const MarkdownIcon = (
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
		<rect x="2.5" y="5" width="19" height="14" rx="2" />
		<path d="M6 15V9l2.5 3L11 9v6M15.5 9v6m0 0 2.5-2.5M15.5 15 13 12.5" strokeLinecap="round" strokeLinejoin="round" />
	</svg>
)

export const MermaidIcon = (
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
		<rect x="3" y="3" width="7" height="5" rx="1" />
		<rect x="14" y="16" width="7" height="5" rx="1" />
		<rect x="14" y="3" width="7" height="5" rx="1" />
		<path d="M10 5.5h4M6.5 8v8.5a2 2 0 0 0 2 2H14" strokeLinecap="round" />
	</svg>
)

/** All canvas feature actions, with keyboard shortcuts ($ = Ctrl/Cmd, ! = Shift, ? = Alt). */
export function canvasActionOverrides(
	editor: Editor,
	helpers: TLUiOverrideHelpers
): TLUiActionsContextType {
	const notify: Notify = (title, severity = 'info') =>
		helpers.addToast({ title, severity, keepOpen: severity === 'error' })
	const a = (id: string, label: string, onSelect: () => unknown, kbd?: string) => ({
		[id]: { id, label, kbd, readonlyOk: false, onSelect: () => void onSelect() },
	})
	return {
		...a('ai-describe-image', 'Describe image', () => aiDescribeImage(editor, notify)),
		...a('ai-extract-text', 'Extract text (OCR)', () => aiExtractText(editor, notify)),
		...a('ai-explain', 'Explain selection', () => aiExplainSelection(editor, notify)),
		...a('ai-ask', 'Ask about selection…', () => aiAskSelection(editor, notify), '$!k'),
		...a('ai-summarize', 'Summarize text', () => aiTextJob(editor, notify, 'summarize')),
		...a('ai-translate', 'Translate text…', () => aiTextJob(editor, notify, 'translate')),
		...a('ai-improve', 'Improve writing', () => aiTextJob(editor, notify, 'improve')),
		...a('ai-brainstorm', 'Brainstorm ideas', () => aiTextJob(editor, notify, 'brainstorm')),
		...a('edit-image', 'Edit image…', () => {
			const image = selectedImage(editor)
			if (!image) return notify('Select one image first', 'warning')
			$imageEditorTarget.set(image.shape.id)
		}, '?e'),
		...a('image-to-pipeline', 'Use image in pipeline', () => sendImageToPipeline(editor, notify)),
		...a('qr-code', 'QR code from text / link', () => makeQrCode(editor, notify)),
		...a('word-count', 'Word count', () => wordCount(editor, notify), '?w'),
		...a('insert-date', 'Insert date & time', () => insertDateTime(editor), '?d'),
		...a('find-on-canvas', 'Find on canvas', () => $findOpen.set(true), '$!f'),
		...a('fetch-page', 'Web page → Markdown…', () => fetchPageAsMarkdown(editor, notify)),
		...a('new-markdown', 'New Markdown clip', () => createClipAtCenter(editor, 'markdown'), '?m'),
		...a('new-mermaid', 'New Mermaid diagram', () => createClipAtCenter(editor, 'mermaid'), '?g'),
		...a('pack-nodes', 'Pack into one node', async () => {
			if (!(await packSelection(editor))) notify('Select at least one node to pack', 'warning')
		}, '$!p'),
		...a('unpack-node', 'Unpack', () => {
			const s = editor.getOnlySelectedShape()
			if (s?.type === 'node' && (s.props as any).node?.type === 'subgraph') unpack(editor, s.id)
		}),
	}
}

/** Right-click menu: AI and image items first, then tldraw's own items. */
export function CanvasContextMenu(props: TLUiContextMenuProps) {
	const editor = useEditor()
	const hasSelection = useValue('has selection', () => editor.getSelectedShapeIds().length > 0, [editor])
	const isImage = useValue('is image', () => !!selectedImage(editor), [editor])
	const hasNodes = useValue('has nodes', () => editor.getSelectedShapes().some((s) => s.type === 'node'), [editor])
	const isPackedNode = useValue(
		'is packed node',
		() => {
			const s = editor.getOnlySelectedShape()
			return s?.type === 'node' && (s.props as any).node?.type === 'subgraph'
		},
		[editor]
	)
	return (
		<DefaultContextMenu {...props}>
			{isImage && (
				<TldrawUiMenuGroup id="image-tools">
					<TldrawUiMenuActionItem actionId="edit-image" />
					<TldrawUiMenuActionItem actionId="ai-describe-image" />
					<TldrawUiMenuActionItem actionId="ai-extract-text" />
					<TldrawUiMenuActionItem actionId="image-to-pipeline" />
				</TldrawUiMenuGroup>
			)}
			{(hasNodes || isPackedNode) && (
				<TldrawUiMenuGroup id="pack-tools">
					{isPackedNode ? <TldrawUiMenuActionItem actionId="unpack-node" /> : <TldrawUiMenuActionItem actionId="pack-nodes" />}
				</TldrawUiMenuGroup>
			)}
			{hasSelection ? (
				<TldrawUiMenuGroup id="ai-tools">
					<TldrawUiMenuSubmenu id="ai-submenu" label="AI">
						<TldrawUiMenuGroup id="ai-sel">
							<TldrawUiMenuActionItem actionId="ai-ask" />
							<TldrawUiMenuActionItem actionId="ai-explain" />
						</TldrawUiMenuGroup>
						<TldrawUiMenuGroup id="ai-text">
							<TldrawUiMenuActionItem actionId="ai-summarize" />
							<TldrawUiMenuActionItem actionId="ai-translate" />
							<TldrawUiMenuActionItem actionId="ai-improve" />
							<TldrawUiMenuActionItem actionId="ai-brainstorm" />
						</TldrawUiMenuGroup>
					</TldrawUiMenuSubmenu>
					<TldrawUiMenuActionItem actionId="qr-code" />
					<TldrawUiMenuActionItem actionId="word-count" />
				</TldrawUiMenuGroup>
			) : (
				<TldrawUiMenuGroup id="canvas-tools">
					<TldrawUiMenuActionItem actionId="new-markdown" />
					<TldrawUiMenuActionItem actionId="new-mermaid" />
					<TldrawUiMenuActionItem actionId="insert-date" />
					<TldrawUiMenuActionItem actionId="fetch-page" />
					<TldrawUiMenuActionItem actionId="qr-code" />
					<TldrawUiMenuActionItem actionId="find-on-canvas" />
				</TldrawUiMenuGroup>
			)}
			<DefaultContextMenuContent />
		</DefaultContextMenu>
	)
}

/** "Canvas tools" submenu for the main menu. */
export function CanvasToolsMenuGroup() {
	return (
		<TldrawUiMenuSubmenu id="canvas-tools-menu" label="Canvas tools">
			<TldrawUiMenuGroup id="ct-clips">
				<TldrawUiMenuActionItem actionId="new-markdown" />
				<TldrawUiMenuActionItem actionId="new-mermaid" />
				<TldrawUiMenuActionItem actionId="fetch-page" />
			</TldrawUiMenuGroup>
			<TldrawUiMenuGroup id="ct-ai">
				<TldrawUiMenuActionItem actionId="ai-ask" />
				<TldrawUiMenuActionItem actionId="ai-explain" />
				<TldrawUiMenuActionItem actionId="ai-summarize" />
				<TldrawUiMenuActionItem actionId="ai-translate" />
			</TldrawUiMenuGroup>
			<TldrawUiMenuGroup id="ct-utils">
				<TldrawUiMenuActionItem actionId="find-on-canvas" />
				<TldrawUiMenuActionItem actionId="insert-date" />
				<TldrawUiMenuActionItem actionId="word-count" />
				<TldrawUiMenuActionItem actionId="qr-code" />
				<TldrawUiMenuActionItem actionId="edit-image" />
			</TldrawUiMenuGroup>
		</TldrawUiMenuSubmenu>
	)
}
