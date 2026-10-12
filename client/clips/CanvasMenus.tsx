import {
	ArrangeMenuSubmenu,
	ClipboardMenuGroup,
	ConversionsMenuGroup,
	DefaultContextMenu,
	Editor,
	EditMenuSubmenu,
	MoveToPageMenu,
	ReorderMenuSubmenu,
	SelectAllMenuItem,
	TLUiActionsContextType,
	TLUiContextMenuProps,
	TLUiOverrideHelpers,
	TldrawUiMenuActionItem,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
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
import { openBuildPanel } from '../pipeline/aiBuild'
import { $findOpen } from './FindBar'
import { compareTargets, copyDocument, keepVariant, openCompare, openRewrite, retryVariant, selectedVariant, splitIntoParagraphs } from './rewrite'
import { $imageEditorTarget } from './ImageEditor'
import { diveGroup, groupSelection, leaveGroup, renameSelection } from '../pipeline/groups/groupActions'
import { closeGroup, openGroup, packSelection, unpack } from '../pipeline/subgraph'
import {
	exportCustomNodeFile,
	importCustomNodeFile,
	openCanvasFile,
	saveCanvasFile,
	saveCustomNode,
} from '../pipeline/customNodes'
import { imagesKeepRatio, toggleImageRatio, toggleTextWrap } from './shapeOptions'
import { $mapOpen, openInsertPaletteAtPointer, startColorChord } from '../shell/shellState'
import { EXAMPLES } from '../../shared/examples'
import { loadExample } from '../pipeline/loadExample'
import { startExecution } from '../pipeline/execution/executionState'
import { getNodeDefinitions, shouldSpillOutput } from '../pipeline/nodes/nodeTypes'
import { createNodeAt } from '../pipeline/placeNode'
import { NODE_GROUP_LABELS, NODE_GROUP_ORDER } from '../../shared/nodeGroups'

/**
 * Delete the selection, skipping nodes whose "Lock delete" is on. Used by the
 * "erase-selection" action override and by the Ctrl/Cmd+E key handler in
 * ShellChrome, so there is exactly one place that implements the behaviour.
 */
export function eraseSelection(editor: Editor, notify: Notify) {
	const selected = editor.getSelectedShapes()
	const locked = selected.filter(
		(shape) => shape.type === 'node' && (shape.props as { deleteLocked?: boolean }).deleteLocked
	)
	const toDelete = selected.filter((shape) => !locked.includes(shape))
	if (toDelete.length) editor.deleteShapes(toDelete.map((shape) => shape.id))
	if (locked.length) {
		notify(`${locked.length} locked node${locked.length === 1 ? '' : 's'} kept`, 'warning')
	}
}

function centerView(editor: Editor) {
	const selected = editor.getSelectionPageBounds()
	const bounds = selected ?? editor.getCurrentPageBounds()
	if (!bounds) return
	editor.centerOnPoint(bounds.center, { animation: { duration: 200 } })
}

function resetZoom(editor: Editor) {
	editor.resetZoom(editor.getViewportScreenCenter(), { animation: { duration: 200 } })
}

/** The open-box group among the selection: the group itself, or any of its members. */
function findOpenBoxGroup(editor: Editor) {
	for (const shape of editor.getSelectedShapes()) {
		if (shape.type === 'group' && typeof shape.meta?.boxOf === 'string') return shape.id
		const parent = editor.getShape(shape.parentId)
		if (parent?.type === 'group' && typeof parent.meta?.boxOf === 'string') return parent.id
	}
	return null
}

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
		...a('build-with-ai', 'Build with AI…', () => openBuildPanel()),
		...a('ai-summarize', 'Summarize text', () => aiTextJob(editor, notify, 'summarize')),
		...a('ai-translate', 'Translate text…', () => aiTextJob(editor, notify, 'translate')),
		...a('ai-improve', 'Improve writing', () => aiTextJob(editor, notify, 'improve')),
		...a('ai-brainstorm', 'Brainstorm ideas', () => aiTextJob(editor, notify, 'brainstorm')),
		...a('rewrite-split', 'Split into paragraphs', () => splitIntoParagraphs(editor, notify)),
		...a('rewrite-open', 'Rewrite…', () => openRewrite(editor, notify), '?b'),
		...a('compare', 'Compare (diff)', () => openCompare(editor, notify), '?c'),
		...a('rewrite-use', 'Use this version', () => keepVariant(editor, notify)),
		...a('rewrite-retry', 'Rewrite again (same instruction)', () => retryVariant(editor, notify)),
		...a('rewrite-copy', 'Copy document as Markdown', () => copyDocument(editor, notify)),
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
		...a('toggle-map', 'Map view', () => $mapOpen.set(!$mapOpen.get())),
		...a('center-view', 'Center view', () => centerView(editor)),
		...a('reset-zoom', 'Reset zoom', () => resetZoom(editor)),
		...a('erase-selection', 'Delete (erase)', () => eraseSelection(editor, notify), '$e'),
		...a(
			'color-chord',
			'Colour selection… (then C, then G/K/B/R/Y)',
			() => startColorChord(),
			'$b'
		),
		...a('fetch-page', 'Web page → Markdown…', () => fetchPageAsMarkdown(editor, notify)),
		...a('new-markdown', 'New Markdown clip', () => createClipAtCenter(editor, 'markdown'), '?m'),
		...a('new-mermaid', 'New Mermaid diagram', () => createClipAtCenter(editor, 'mermaid'), '?g'),
		...a('toggle-text-wrap', 'Text: wrap on / off', () => {
			const on = toggleTextWrap(editor)
			if (on === null) notify('Select text shapes first', 'warning')
			else notify(on ? 'Text wraps at its width' : 'Text grows on one line (no wrap)')
		}, '?t'),
		...a('toggle-image-ratio', 'Image: keep ratio on / off', () => {
			const keep = imagesKeepRatio(editor)
			if (!toggleImageRatio(editor)) notify('Select images first', 'warning')
			else notify(keep ? 'Image can now stretch freely' : 'Image keeps its ratio')
		}, '?r'),
		...a('pack-nodes', 'Group as box', async () => {
			if (!(await packSelection(editor))) notify('Select at least one node to group', 'warning')
		}, '$!p'),
		...a('open-group', 'Open group', () => {
			const s = editor.getOnlySelectedShape()
			if (!(s?.type === 'node' && (s.props as any).node?.type === 'subgraph')) return
			openGroup(editor, s.id)
		}),
		...a('close-to-box', 'Close to box', async () => {
			const groupId = findOpenBoxGroup(editor)
			if (!groupId) return
			const removed = await closeGroup(editor, groupId)
			if (removed) notify(`${removed} wire${removed === 1 ? '' : 's'} removed`, 'warning')
		}),
		...a('save-custom-node', 'Save as my node…', async () => {
			const s = editor.getOnlySelectedShape()
			if (!(s?.type === 'node' && (s.props as any).node?.type === 'subgraph')) {
				return notify('Group nodes first (Ctrl+Shift+P), then select the box', 'warning')
			}
			const name = window.prompt('Name for this node:', (s.props as any).node.title)
			if (!name) return
			try {
				if (await saveCustomNode(editor, s.id, name)) notify(`Saved "${name}" to My nodes`, 'success')
			} catch (e) {
				notify((e as Error).message, 'error')
			}
		}),
		...a('export-node-file', 'Export node file (.node.json)', async () => {
			const s = editor.getOnlySelectedShape()
			if (!(s?.type === 'node' && (s.props as any).node?.type === 'subgraph')) return notify('Select a packed node', 'warning')
			await exportCustomNodeFile(editor, s.id)
		}),
		...a('import-node-file', 'Import node file…', async () => {
			try {
				if (await importCustomNodeFile(editor)) notify('Node added to My nodes and the canvas', 'success')
			} catch (e) {
				notify((e as Error).message, 'error')
			}
		}),
		...a('save-canvas-file', 'Save canvas as JSON', () => saveCanvasFile(editor), '$!s'),
		...a('open-canvas-file', 'Open canvas JSON…', async () => {
			if (!window.confirm('Open a canvas file? It replaces what is on this canvas now (Ctrl+Z will not undo it).')) return
			try {
				if (await openCanvasFile(editor)) notify('Canvas opened', 'success')
			} catch (e) {
				notify((e as Error).message, 'error')
			}
		}),
		...a('group-shapes', 'Group selection', () => {
			if (!groupSelection(editor)) notify('Select at least two shapes', 'warning')
		}, '$!g'),
		...a('rename-shape', 'Rename component or group', () => {
			const name = window.prompt('Name on the top edge')
			if (!name) return
			if (!renameSelection(editor, name)) notify('Select one component or one group', 'warning')
		}),
		...a('dive-group', 'Dive into group', () => {
			if (!diveGroup(editor)) notify('Select one group', 'warning')
		}),
		...a('leave-group', 'Back from group', () => {
			if (!leaveGroup(editor)) notify('You are not inside a group', 'warning')
		}),
		...a('unpack-node', 'Ungroup box', () => {
			const s = editor.getOnlySelectedShape()
			if (s?.type === 'node' && (s.props as any).node?.type === 'subgraph') unpack(editor, s.id)
		}),
		...a('run-node', 'Run card', () => {
			const ids = selectedNodeIds(editor)
			if (ids.size) void startExecution(editor, ids)
		}),
		...a('run-node-no-cache', 'Run without cache', () => {
			const ids = selectedNodeIds(editor)
			if (ids.size) void startExecution(editor, ids, { noCache: true })
		}),
		...a('toggle-spill', 'Put output on canvas', () => {
			const shapes = editor.getSelectedShapes().filter((s) => s.type === 'node')
			if (!shapes.length) return
			// If any selected card isn't spilling yet, turn it on for all of them; otherwise off.
			const anyOff = shapes.some((s) => !shouldSpillOutput(editor, s as any))
			editor.run(() => {
				for (const s of shapes) {
					editor.updateShape({ id: s.id, type: 'node', props: { spill: anyOff ? 'always' : 'never' } })
				}
			})
		}),
		...a('insert-card-palette', 'Insert card…', () => openInsertPaletteAtPointer(editor)),
	}
}

/** Every selected node shape's id, as a set `startExecution` can run. */
function selectedNodeIds(editor: Editor) {
	return new Set(editor.getSelectedShapes().filter((s) => s.type === 'node').map((s) => s.id))
}

/**
 * Right-click menu, in this order (each section only when it applies):
 * 1. Card — run, group as box / open / close / ungroup, save as my node, put output on canvas
 * 2. AI — ask AI, build with AI, explain, text jobs (incl. image AI when an image is selected)
 * 3. Insert — "Insert card…" (opens the palette at the pointer) + a submenu per card group
 * 4. Edit — tldraw's own edit items, unchanged
 * 5. Arrange — tldraw's own arrange/align items, plus Text wrap / Image ratio
 * 6. Canvas — Find, Map view, Save canvas, Examples
 */
export function CanvasContextMenu(props: TLUiContextMenuProps) {
	const editor = useEditor()
	const hasSelection = useValue('has selection', () => editor.getSelectedShapeIds().length > 0, [editor])
	const isImage = useValue('is image', () => !!selectedImage(editor), [editor])
	const hasNodes = useValue('has nodes', () => editor.getSelectedShapes().some((s) => s.type === 'node'), [editor])
	const hasText = useValue('has text', () => editor.getSelectedShapes().some((s) => s.type === 'text'), [editor])
	const isPackedNode = useValue(
		'is packed node',
		() => {
			const s = editor.getOnlySelectedShape()
			return s?.type === 'node' && (s.props as any).node?.type === 'subgraph'
		},
		[editor]
	)
	const isVariant = useValue('rewrite variant', () => !!selectedVariant(editor), [editor])
	const canCompare = useValue('can compare', () => !!compareTargets(editor), [editor])
	const isFrame = useValue('one frame', () => editor.getOnlySelectedShape()?.type === 'frame', [editor])
	const openBoxGroupId = useValue('open box group', () => findOpenBoxGroup(editor), [editor])
	return (
		<DefaultContextMenu {...props}>
			{/* 1. Card */}
			{(hasNodes || isPackedNode || openBoxGroupId) && (
				<TldrawUiMenuGroup id="card-tools">
					{hasNodes && <TldrawUiMenuActionItem actionId="run-node" />}
					{hasNodes && <TldrawUiMenuActionItem actionId="run-node-no-cache" />}
					{isPackedNode ? (
						<>
							<TldrawUiMenuActionItem actionId="open-group" />
							<TldrawUiMenuActionItem actionId="unpack-node" />
							<TldrawUiMenuActionItem actionId="export-node-file" />
						</>
					) : openBoxGroupId ? (
						<TldrawUiMenuActionItem actionId="close-to-box" />
					) : (
						<TldrawUiMenuActionItem actionId="pack-nodes" />
					)}
					{hasNodes && <TldrawUiMenuActionItem actionId="save-custom-node" />}
					{hasNodes && <TldrawUiMenuActionItem actionId="toggle-spill" />}
				</TldrawUiMenuGroup>
			)}
			{/* 2. AI */}
			{hasSelection && (
				<TldrawUiMenuGroup id="ai-tools">
					<TldrawUiMenuSubmenu id="ai-submenu" label="AI">
						<TldrawUiMenuGroup id="ai-sel">
							<TldrawUiMenuActionItem actionId="ai-ask" />
							<TldrawUiMenuActionItem actionId="build-with-ai" />
							<TldrawUiMenuActionItem actionId="ai-explain" />
						</TldrawUiMenuGroup>
						{isImage && (
							<TldrawUiMenuGroup id="ai-image">
								<TldrawUiMenuActionItem actionId="ai-describe-image" />
								<TldrawUiMenuActionItem actionId="ai-extract-text" />
							</TldrawUiMenuGroup>
						)}
						<TldrawUiMenuGroup id="ai-text">
							<TldrawUiMenuActionItem actionId="ai-summarize" />
							<TldrawUiMenuActionItem actionId="ai-translate" />
							<TldrawUiMenuActionItem actionId="ai-improve" />
							<TldrawUiMenuActionItem actionId="ai-brainstorm" />
						</TldrawUiMenuGroup>
						<TldrawUiMenuGroup id="ai-rewrite">
							<TldrawUiMenuActionItem actionId="rewrite-open" />
							{isVariant ? (
								<>
									<TldrawUiMenuActionItem actionId="rewrite-use" />
									<TldrawUiMenuActionItem actionId="rewrite-retry" />
								</>
							) : (
								<TldrawUiMenuActionItem actionId="rewrite-split" />
							)}
							{isFrame && <TldrawUiMenuActionItem actionId="rewrite-copy" />}
						</TldrawUiMenuGroup>
					</TldrawUiMenuSubmenu>
					{isImage && <TldrawUiMenuActionItem actionId="image-to-pipeline" />}
					{canCompare && <TldrawUiMenuActionItem actionId="compare" />}
					<TldrawUiMenuActionItem actionId="qr-code" />
					<TldrawUiMenuActionItem actionId="word-count" />
				</TldrawUiMenuGroup>
			)}
			{/* 3. Insert */}
			<TldrawUiMenuGroup id="insert-tools">
				<TldrawUiMenuActionItem actionId="insert-card-palette" />
				<InsertCardSubmenus />
			</TldrawUiMenuGroup>
			{/* 4. Edit (tldraw's own items, unchanged) */}
			<TldrawUiMenuGroup id="edit-tools">
				<EditMenuSubmenu />
			</TldrawUiMenuGroup>
			<ClipboardMenuGroup />
			<ConversionsMenuGroup />
			<TldrawUiMenuGroup id="select-all">
				<SelectAllMenuItem />
			</TldrawUiMenuGroup>
			{hasSelection && (
				<TldrawUiMenuGroup id="group-tools">
					<TldrawUiMenuActionItem actionId="group-shapes" />
					<TldrawUiMenuActionItem actionId="rename-shape" />
					<TldrawUiMenuActionItem actionId="dive-group" />
					<TldrawUiMenuActionItem actionId="leave-group" />
				</TldrawUiMenuGroup>
			)}
			{/* 5. Arrange (tldraw's own items, plus Text wrap / Image ratio) */}
			<TldrawUiMenuGroup id="arrange-tools">
				<ArrangeMenuSubmenu />
				<ReorderMenuSubmenu />
				<MoveToPageMenu />
				{hasText && <TldrawUiMenuActionItem actionId="toggle-text-wrap" />}
				{isImage && <TldrawUiMenuActionItem actionId="toggle-image-ratio" />}
				{isImage && <TldrawUiMenuActionItem actionId="edit-image" />}
			</TldrawUiMenuGroup>
			{/* 6. Canvas */}
			<TldrawUiMenuGroup id="canvas-tools">
				<TldrawUiMenuActionItem actionId="find-on-canvas" />
				<TldrawUiMenuActionItem actionId="toggle-map" />
				<TldrawUiMenuActionItem actionId="save-canvas-file" />
				<ExamplesMenu />
				{!hasSelection && (
					<>
						<TldrawUiMenuActionItem actionId="new-markdown" />
						<TldrawUiMenuActionItem actionId="new-mermaid" />
						<TldrawUiMenuActionItem actionId="insert-date" />
						<TldrawUiMenuActionItem actionId="fetch-page" />
					</>
				)}
				{hasSelection && <TldrawUiMenuActionItem actionId="erase-selection" />}
				<TldrawUiMenuActionItem actionId="center-view" />
				<TldrawUiMenuActionItem actionId="reset-zoom" />
			</TldrawUiMenuGroup>
		</DefaultContextMenu>
	)
}

/** One submenu per card group, each listing that group's cards for a quick insert at the pointer. */
function InsertCardSubmenus() {
	const editor = useEditor()
	const grouped = useValue(
		'insert card groups',
		() => {
			const byGroup = new Map<string, { type: string; title: string }[]>()
			for (const def of Object.values(getNodeDefinitions(editor))) {
				if (def.hidden) continue
				const list = byGroup.get(def.category) ?? []
				list.push({ type: def.type, title: def.title })
				byGroup.set(def.category, list)
			}
			return byGroup
		},
		[editor]
	)
	const insertType = (type: string) => {
		const def = getNodeDefinitions(editor)[type as keyof ReturnType<typeof getNodeDefinitions>]
		if (!def) return
		const point = editor.inputs.getCurrentPagePoint?.() ?? editor.getViewportPageBounds().center
		createNodeAt(editor, def.getDefault(), { near: point, select: true })
	}
	return (
		<>
			{NODE_GROUP_ORDER.map((groupId) => {
				const defs = grouped.get(groupId)
				if (!defs?.length) return null
				return (
					<TldrawUiMenuSubmenu key={groupId} id={`insert-group-${groupId}`} label={NODE_GROUP_LABELS[groupId] ?? groupId}>
						<TldrawUiMenuGroup id={`insert-group-${groupId}-items`}>
							{defs.map((def) => (
								<TldrawUiMenuItem
									key={def.type}
									id={`insert-${def.type}`}
									label={def.title}
									onSelect={() => insertType(def.type)}
								/>
							))}
						</TldrawUiMenuGroup>
					</TldrawUiMenuSubmenu>
				)
			})}
		</>
	)
}

/** Examples live inside the top-left menu. */
export function ExamplesMenu() {
	const editor = useEditor()
	return (
		<TldrawUiMenuSubmenu id="examples-menu" label="Examples">
			<TldrawUiMenuGroup id="examples-list">
				{EXAMPLES.map((example) => (
					<TldrawUiMenuItem
						key={example.id}
						id={`example-${example.id}`}
						label={example.title}
						onSelect={() => {
							const view = editor.getViewportPageBounds()
							loadExample(editor, example, { x: view.minX + 80, y: view.minY + 80 })
						}}
					/>
				))}
			</TldrawUiMenuGroup>
		</TldrawUiMenuSubmenu>
	)
}

/** "Canvas tools" submenu for the main menu. */
export function CanvasToolsMenuGroup() {
	// File and view items only: everything else (AI jobs, clip creation, find, word count,
	// QR code, image edit, erase, colour chord's selection target) now lives in the
	// context menu's Card/AI/Insert/Edit/Arrange/Canvas sections — see CanvasContextMenu
	// above, kept in the same order here so there is exactly one place for each item.
	return (
		<TldrawUiMenuSubmenu id="canvas-tools-menu" label="Canvas tools">
			<TldrawUiMenuGroup id="ct-files">
				<TldrawUiMenuActionItem actionId="open-canvas-file" />
				<TldrawUiMenuActionItem actionId="import-node-file" />
			</TldrawUiMenuGroup>
			<TldrawUiMenuGroup id="ct-view">
				<TldrawUiMenuActionItem actionId="color-chord" />
			</TldrawUiMenuGroup>
		</TldrawUiMenuSubmenu>
	)
}
