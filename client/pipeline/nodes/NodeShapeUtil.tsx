import classNames from 'classnames'
import { useCallback, useRef, useState } from 'react'
import {
	Circle2d,
	getColorValue,
	Group2d,
	HTMLContainer,
	RecordProps,
	Rectangle2d,
	resizeBox,
	ShapeUtil,
	T,
	TldrawUiButton,
	TldrawUiButtonCheck,
	TldrawUiButtonLabel,
	TldrawUiDropdownMenuContent,
	TldrawUiDropdownMenuGroup,
	TldrawUiDropdownMenuItem,
	TldrawUiDropdownMenuRoot,
	TldrawUiDropdownMenuTrigger,
	TLResizeInfo,
	TLShape,
	useEditor,
	useValue,
} from 'tldraw'
import {
	IconChevronDown,
	IconChevronUp,
	IconCopy,
	IconMore,
	IconPlay,
	IconSparkle,
	IconStop,
	UiButton,
	UiErrorBanner,
	UiIconButton,
	UiTextInput,
} from '../../ui'
import {
	DEFAULT_NODE_FONT_PX,
	getNodeRowHeightPx,
	NODE_FOOTER_HEIGHT_PX,
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_BOTTOM_PADDING_PX,
	NODE_ROW_HEADER_GAP_PX,
	PORT_RADIUS_PX,
} from '../constants'
import { executionState, startExecution, stopExecution } from '../execution/executionState'
import { Port } from '../ports/Port'
import { getNodeOutputPortInfo, getNodePorts } from './nodePorts'
import { getNodeHeightPx, getNodeWidthPx, NodeBody, shouldSpillOutput } from './nodeTypes'
import { getNodeDefinition, NodeType } from './registry'
import { resizeNode } from './resizeNode'
import { openGroup } from '../subgraph'
import { placeImageOnCanvas, placeTextOnCanvas } from '../placeOnCanvas'
import { formatRunMs } from '../../../shared/llmUsage'
import { pastePatch } from '../../../shared/pasteTarget'
import { openFillAssist } from '../assist'
import { readClipboard } from '../clipboard'
import { apiImportImage } from '../api/pipelineApi'
import { clearNodeRun, nodeRunState } from '../execution/nodeRunState'
import { STOP_EXECUTION } from './types/shared'
import { $notesAll, $notesOpen, toggleNoteOpen } from '../../shell/shellState'

const NODE_TYPE = 'node'
/** Matches --tl-radius-3, the card's own border radius. */
const NODE_CARD_RADIUS_PX = 9

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		[NODE_TYPE]: {
			node: NodeType
			isOutOfDate: boolean
			/** User-set width (resize). */
			w?: number
			/** Extra body height added by resizing. */
			extraH?: number
			/** Show only the header and footer. */
			collapsed?: boolean
			/** Freeze position and size. */
			pinned?: boolean
			/** Refuse deletion. */
			deleteLocked?: boolean
			/** Text or image shape that shows an unconnected output. */
			spillId?: string
			/** Output history shapes, newest first. The newest sits beside the node; older ones shift right. */
			spillIds?: string[]
			/** Whether the unconnected output is also put on the canvas. Undefined = 'auto' (skip when the card already shows the result). */
			spill?: 'auto' | 'always' | 'never'
			/** Accent colour for the card header (one of tldraw's colour names). */
			color?: string
			/** Name drawn on the top edge. */
			label?: string
			/** Free text note kept with the node. */
			note?: string
			/** Text size inside the node, in px. Default 13. */
			fontSize?: number
			/**
			 * Hash of the card type, its settings and its inputs from the last run
			 * (WP14 Part B). Run skips the card when this still matches and the
			 * outputs are present.
			 */
			lastRunHash?: string
		}
	}
}

export type NodeShape = TLShape<typeof NODE_TYPE>

export class NodeShapeUtil extends ShapeUtil<NodeShape> {
	static override type = NODE_TYPE
	static override props: RecordProps<NodeShape> = {
		node: NodeType,
		isOutOfDate: T.boolean,
		w: T.number.optional(),
		extraH: T.number.optional(),
		collapsed: T.boolean.optional(),
		pinned: T.boolean.optional(),
		deleteLocked: T.boolean.optional(),
		spillId: T.string.optional(),
		spillIds: T.arrayOf(T.string).optional(),
		spill: T.literalEnum('auto', 'always', 'never').optional(),
		color: T.string.optional(),
		label: T.string.optional(),
		note: T.string.optional(),
		fontSize: T.number.optional(),
		lastRunHash: T.string.optional(),
	}

	getDefaultProps(): NodeShape['props'] {
		return {
			node: getNodeDefinition(this.editor, 'prompt').getDefault(),
			isOutOfDate: false,
		}
	}

	override canEdit(_shape: NodeShape) {
		return false
	}
	override onDoubleClick(shape: NodeShape) {
		// Double-click a box to open it in place.
		if (shape.props.node.type === 'subgraph') openGroup(this.editor, shape.id)
	}
	override canResize(shape: NodeShape) {
		return !shape.props.collapsed && !shape.props.pinned
	}
	override hideResizeHandles(shape: NodeShape) {
		return !this.canResize(shape)
	}
	override hideRotateHandle(_shape: NodeShape) {
		return true
	}
	override hideSelectionBoundsBg(shape: NodeShape) {
		return !this.canResize(shape)
	}
	override hideSelectionBoundsFg(_shape: NodeShape) {
		// tldraw's own selection rectangle is hidden; getIndicatorPath draws the single
		// rounded edge (and resize handles still show through hideResizeHandles).
		return true
	}
	override isAspectRatioLocked(_shape: NodeShape) {
		return false
	}
	override getBoundsSnapGeometry(_shape: NodeShape) {
		return {
			points: [{ x: 0, y: 0 }],
		}
	}

	getGeometry(shape: NodeShape) {
		const ports = getNodePorts(this.editor, shape)
		const width = getNodeWidthPx(this.editor, shape)

		const portGeometries = Object.values(ports).map(
			(port) =>
				new Circle2d({
					x: port.x - PORT_RADIUS_PX,
					y: port.y - PORT_RADIUS_PX,
					radius: PORT_RADIUS_PX,
					isFilled: true,
					isLabel: true,
					excludeFromShapeBounds: true,
				})
		)

		const bodyGeometry = new Rectangle2d({
			width,
			height: getNodeHeightPx(this.editor, shape),
			isFilled: true,
		})

		return new Group2d({
			children: [bodyGeometry, ...portGeometries],
		})
	}

	override onResize(shape: any, info: TLResizeInfo<any>) {
		const definition = getNodeDefinition(this.editor, shape.props.node)
		if (definition.canResizeNode) {
			const node = shape.props.node as { w: number; h: number; type: string }
			const prevW = getNodeWidthPx(this.editor, shape)
			const prevH = getNodeHeightPx(this.editor, shape)
			const newW = Math.max(200, Math.round(prevW * info.scaleX))
			const newH = Math.max(120, Math.round(prevH * info.scaleY))
			const bodyH =
				newH -
				NODE_HEADER_HEIGHT_PX -
				NODE_ROW_HEADER_GAP_PX -
				NODE_ROW_BOTTOM_PADDING_PX -
				NODE_FOOTER_HEIGHT_PX

			return {
				...resizeNode(shape, info),
				props: {
					...shape.props,
					node: {
						...node,
						w: newW,
						h:
							NODE_HEADER_HEIGHT_PX +
							NODE_ROW_HEADER_GAP_PX +
							Math.max(0, bodyH) +
							NODE_ROW_BOTTOM_PADDING_PX +
							NODE_FOOTER_HEIGHT_PX,
					},
				},
			}
		}
		// Any other node: free width, and extra height for its result area.
		const initial = info.initialShape as NodeShape
		const prevW = getNodeWidthPx(this.editor, initial)
		const prevH = getNodeHeightPx(this.editor, initial)
		const baseH = prevH - (initial.props.extraH ?? 0)
		const newW = Math.max(220, Math.round(prevW * Math.abs(info.scaleX)))
		const newH = Math.round(prevH * Math.abs(info.scaleY))
		// resizeBox works on w/h props; give it the node's current box to get the new position.
		const asBox = (s: NodeShape) => ({ ...s, props: { ...s.props, w: prevW, h: prevH } }) as any
		const resized = resizeBox(asBox(shape), { ...info, initialShape: asBox(initial) })
		return {
			...resized,
			props: { ...shape.props, w: newW, extraH: Math.max(0, newH - baseH) },
		}
	}

	component(shape: NodeShape) {
		return <NodeShapeComponent shape={shape} />
	}

	getIndicatorPath(shape: NodeShape) {
		const width = getNodeWidthPx(this.editor, shape)
		const height = getNodeHeightPx(this.editor, shape)
		const path = new Path2D()
		// Same radius as the card (--tl-radius-3), so the indicator sits exactly on its edge.
		path.roundRect(0, 0, width, height, NODE_CARD_RADIUS_PX)
		const ports = Object.values(getNodePorts(this.editor, shape))
		for (const port of ports) {
			path.moveTo(port.x + PORT_RADIUS_PX, port.y)
			path.arc(port.x, port.y, PORT_RADIUS_PX, 0, Math.PI * 2)
		}
		return path
	}
}

function NodeShapeComponent({ shape }: { shape: NodeShape }) {
	const editor = useEditor()

	const output = useValue(
		'output',
		() => getNodeOutputPortInfo(editor, shape.id)?.output ?? undefined,
		[editor, shape.id]
	)

	const isExecuting = useValue(
		'is executing',
		() => executionState.get(editor).runningGraph?.getNodeStatus(shape.id) === 'executing',
		[editor, shape.id]
	)

	const isGraphRunning = useValue(
		'is graph running',
		() => executionState.get(editor).runningGraph !== null,
		[editor]
	)

	const run = useValue('node run', () => nodeRunState.get(editor)[shape.id], [editor, shape.id])

	// Total cards in the current run (this card, its stale upstream, and downstream), for the footer text.
	const runningCards = useValue(
		'running cards',
		() => executionState.get(editor).runningGraph?.size ?? null,
		[editor]
	)

	const nodeDefinition = getNodeDefinition(editor, shape.props.node)
	const [naming, setNaming] = useState(false)
	// A group box shows its own title (e.g. "Group (3 cards)") instead of the generic heading.
	const boxTitle = shape.props.node.type === 'subgraph' ? (shape.props.node as { title?: string }).title : undefined
	const title = shape.props.label || boxTitle || nodeDefinition.heading || nodeDefinition.title
	const [nameDraft, setNameDraft] = useState(title)
	const cancelRename = useRef(false)
	const storedError = (shape.props.node as { error?: unknown }).error
	const nodeError = typeof storedError === 'string' && storedError.trim() ? storedError : ''
	const runMessage =
		(run?.status === 'error' || run?.status === 'missing') && run.message?.trim() ? run.message : ''
	const bannerMessage = runMessage || nodeError
	const bannerTitle = run?.status === 'missing' && runMessage ? 'Input missing' : 'Run failed'
	const [hiddenBanner, setHiddenBanner] = useState<string | null>(null)
	const showBanner = !!bannerMessage && hiddenBanner !== bannerMessage
	const fontSize = shape.props.fontSize
	const accentColor = shape.props.color
		? getColorValue(editor.getCurrentTheme().colors[editor.getColorMode()], shape.props.color, 'solid')
		: undefined
	const runClass =
		isExecuting || run?.status === 'running'
			? 'NodeShape_running'
			: run?.status === 'ok'
				? 'NodeShape_ok'
				: run?.status === 'missing'
					? 'NodeShape_missing'
					: run?.status === 'error'
						? 'NodeShape_error'
						: undefined

	return (
		<HTMLContainer
			className={classNames('NodeShape', runClass, {
				NodeShape_executing: isExecuting,
				NodeShape_capture: shape.props.node.type === 'capture',
				NodeShape_collapsed: !!shape.props.collapsed,
				NodeShape_pinned: !!shape.props.pinned,
				NodeShape_fs: !!fontSize,
				NodeShape_accent: !!accentColor,
			})}
			style={
				{
					'--node-header-h': `${NODE_HEADER_HEIGHT_PX}px`,
					'--node-footer-h': `${NODE_FOOTER_HEIGHT_PX}px`,
					'--node-row-h': `${getNodeRowHeightPx(fontSize)}px`,
					...(fontSize ? { '--node-fs': `${fontSize}px` } : null),
					...(accentColor ? { '--node-accent': accentColor } : null),
				} as React.CSSProperties
			}
			onContextMenu={(e) => {
				const target = e.target as HTMLElement
				const tag = target.tagName
				if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') {
					e.stopPropagation()
				}
			}}
			onPointerDownCapture={(event) => {
				// A node underneath must not open its menu when a higher shape covers the click.
				const point = editor.screenToPage({ x: event.clientX, y: event.clientY })
				const top = editor
					.getShapesAtPoint(point, { hitInside: true })
					.find((hit) => hit.type !== 'arrow' && hit.type !== 'connection')
				if (!top || top.id === shape.id) return
				event.preventDefault()
				event.stopPropagation()
				editor.select(top.id)
			}}
		>
			<NodeNote shape={shape} />
			<div className="NodeShape-heading">
				<div className="NodeShape-icon">{nodeDefinition.icon}</div>
				{naming ? (
					<UiTextInput
						className="NodeShape-label NodeShape-label-input"
						autoFocus
						value={nameDraft}
						onChange={setNameDraft}
						onCommit={(next) => {
							if (cancelRename.current) {
								cancelRename.current = false
								setNaming(false)
								return
							}
							const trimmed = next.trim()
							// An empty name goes back to the node type's own name.
							const node = shape.props.node
							editor.updateShape<NodeShape>({
								id: shape.id,
								type: 'node',
								props: {
									label: trimmed || undefined,
									// A box's name is also kept on node.title (used when saving it to My nodes).
									node: node.type === 'subgraph' && trimmed ? { ...node, title: trimmed } : node,
								},
							})
							setNaming(false)
						}}
						onKeyDown={(event) => {
							if (event.key !== 'Escape') return
							cancelRename.current = true
							setNameDraft(title)
							setNaming(false)
						}}
					/>
				) : (
					<div
						className="NodeShape-label NodeShape-label-name"
						title="Double-click to rename"
						onDoubleClick={() => {
							setNameDraft(title)
							setNaming(true)
						}}
					>
						{title}
					</div>
				)}
				{output !== undefined && shape.props.node.type !== 'subgraph' && <Port shapeId={shape.id} portId="output" />}
			</div>
			<NodeBody shape={shape} />
			<div className="NodeShape-footer">
				<UiButton
					size="sm"
					variant="low"
					className={isExecuting ? 'NodeRunButton_busy' : undefined}
					icon={isExecuting ? <IconStop /> : <IconPlay />}
					label={isExecuting ? 'Stop' : run?.ms != null ? formatRunMs(run.ms) : 'Run'}
					onClick={() => {
						if (isGraphRunning) stopExecution(editor)
						else startExecution(editor, new Set([shape.id]))
					}}
				/>
				<div className="NodeShape-footer-tools">
					<UiIconButton
						className="NodeAiButton"
						icon={<IconSparkle />}
						title="Ask AI about this node"
						onClick={() => openFillAssist(shape.id)}
					/>
					<CopyOutputButton shape={shape} />
					<UiIconButton
						icon={shape.props.collapsed ? <IconChevronDown /> : <IconChevronUp />}
						title={shape.props.collapsed ? 'Expand node' : 'Collapse node'}
						onClick={() =>
							editor.updateShape<NodeShape>({
								id: shape.id,
								type: 'node',
								props: { collapsed: !shape.props.collapsed },
							})
						}
					/>
					<NodeFooterMenu shape={shape} />
				</div>
			</div>
			{showBanner ? (
				<NodeErrorBanner
					shape={shape}
					title={bannerTitle}
					message={bannerMessage}
					onDismiss={() => {
						clearNodeRun(editor, shape.id)
						// node.error stays on the shape. Hide this text until it changes.
						setHiddenBanner(bannerMessage)
					}}
				/>
			) : (
				<NodeRunStatus
					shape={shape}
					running={isExecuting || run?.status === 'running'}
					cards={runningCards}
					cached={run?.status === 'ok' && run.message === 'cached'}
				/>
			)}
		</HTMLContainer>
	)
}

/** Model call state sits under the card, not in the settings row. */
function NodeRunStatus({
	shape,
	running,
	cards,
	cached,
}: {
	shape: NodeShape
	running: boolean
	cards?: number | null
	cached?: boolean
}) {
	const usage = (shape.props.node as { lastUsage?: string | null }).lastUsage
	const text = running
		? cards && cards > 1
			? `Running ${cards} cards…`
			: 'Running…'
		: cached
			? 'cached'
			: typeof usage === 'string'
				? usage
				: ''
	if (!text) return null
	return <div className="NodeLlmStatus">{text}</div>
}

/** Copy a node value: images as image data (fallback: URL), everything else as text. */
async function copyValue(value: string) {
	if (/^(data:image\/|\/api\/images\/)/.test(value)) {
		try {
			const blob = await (await fetch(value)).blob()
			const png = blob.type === 'image/png' ? blob : await toPng(blob)
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
			return
		} catch {
			// Fall through to copying the URL.
		}
	}
	await navigator.clipboard.writeText(value)
}

async function toPng(blob: Blob): Promise<Blob> {
	const bitmap = await createImageBitmap(blob)
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
	canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
	return canvas.convertToBlob({ type: 'image/png' })
}

function primaryOutput(editor: ReturnType<typeof useEditor>, shape: NodeShape): string | null {
	const info = getNodeOutputPortInfo(editor, shape.id)
	for (const out of Object.values(info)) {
		const v = out.multi ? out.value[0] : out.value
		if (v != null && v !== STOP_EXECUTION && v !== '') return String(v)
	}
	return null
}

function CopyOutputButton({ shape }: { shape: NodeShape }) {
	const editor = useEditor()
	const value = useValue('primary output', () => primaryOutput(editor, shape), [editor, shape.id])
	const [done, setDone] = useState(false)
	return (
		<UiIconButton
			icon={<IconCopy />}
			title={value ? 'Copy output' : 'No output yet'}
			disabled={!value}
			done={done}
			onClick={() => {
				if (!value) return
				setDone(false)
				void copyValue(value).then(() => setDone(true))
			}}
		/>
	)
}

/** Error under the card. Does not change the shape size. */
function NodeErrorBanner({
	shape,
	title,
	message,
	onDismiss,
}: {
	shape: NodeShape
	title: string
	message: string
	onDismiss: () => void
}) {
	return (
		<div className="NodeErrorBanner" onPointerDown={(event) => event.stopPropagation()}>
			<UiErrorBanner
				title={title}
				message={message}
				onCopy={() => void navigator.clipboard.writeText(message)}
				onFix={() => openFillAssist(shape.id, { error: message })}
				onDismiss={onDismiss}
			/>
		</div>
	)
}

function NodeFooterMenu({ shape }: { shape: NodeShape }) {
	const editor = useEditor()

	const outputInfo = useValue('output info', () => getNodeOutputPortInfo(editor, shape.id), [
		editor,
		shape.id,
	])

	// Find any image output that has a valid URL
	const imageUrl = Object.values(outputInfo).find(
		(info) =>
			info.dataType === 'image' && typeof info.value === 'string' && info.value && info.value !== ''
	)?.value as string | undefined

	const node = shape.props.node as Record<string, unknown>
	const definition = getNodeDefinition(editor, shape.props.node)
	const resultKeys = definition.resultKeys
	const defaults = definition.getDefault() as Record<string, unknown>
	const hasResult = resultKeys ? resultKeys.some((key) => node[key] !== defaults[key]) : false
	const textOutput = Object.values(outputInfo).find(
		(info) => info.dataType === 'text' && typeof info.value === 'string' && info.value !== ''
	)?.value as string | undefined
	const textResult =
		textOutput ??
		(typeof node.lastResultText === 'string' && node.lastResultText !== ''
			? (node.lastResultText as string)
			: null)

	const handleDuplicate = useCallback(() => {
		editor.markHistoryStoppingPoint('duplicate node')
		editor.duplicateShapes([shape.id])
	}, [editor, shape.id])

	const handleDownloadImage = useCallback(async () => {
		if (!imageUrl) return
		const response = await fetch(imageUrl)
		const blob = await response.blob()
		const ext = blob.type.split('/')[1] ?? 'png'
		const blobUrl = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = blobUrl
		a.download = `image.${ext}`
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(blobUrl)
	}, [imageUrl])

	const handleCopyText = useCallback(async () => {
		if (!textResult) return
		await navigator.clipboard.writeText(textResult)
	}, [textResult])

	const handleClearResult = useCallback(() => {
		if (!resultKeys || resultKeys.length === 0) return
		const updates: Record<string, unknown> = {}
		for (const key of resultKeys) {
			updates[key] = defaults[key]
		}

		editor.updateShape({
			id: shape.id,
			type: shape.type,
			props: {
				node: { ...(shape.props.node as any), ...updates },
				isOutOfDate: true,
			},
		})
	}, [editor, resultKeys, defaults, shape])

	const pinned = !!shape.props.pinned
	const deleteLocked = !!shape.props.deleteLocked
	const fontSize = shape.props.fontSize ?? DEFAULT_NODE_FONT_PX
	const spills = shouldSpillOutput(editor, shape)

	const toggleSpill = () => {
		editor.updateShape<NodeShape>({
			id: shape.id,
			type: 'node',
			props: { spill: spills ? 'never' : 'always' },
		})
	}

	const stepFont = (delta: number) => {
		const next = Math.max(MIN_NODE_FONT_PX, Math.min(MAX_NODE_FONT_PX, fontSize + delta))
		editor.updateShape<NodeShape>({
			id: shape.id,
			type: 'node',
			props: { fontSize: next === DEFAULT_NODE_FONT_PX ? undefined : next },
		})
	}

	const clearOutput = () => {
		const definition = getNodeDefinition(editor, shape.props.node)
		const defaults = definition.getDefault() as unknown as Record<string, unknown>
		const node = { ...(shape.props.node as unknown as Record<string, unknown>) }
		for (const key of definition.resultKeys ?? []) node[key] = defaults[key]
		const spillIds = (shape.props.spillIds as string[] | undefined) ?? (shape.props.spillId ? [shape.props.spillId as string] : [])
		const spills = spillIds.map((id) => editor.getShape(id as typeof shape.id)).filter(Boolean)
		if (spills.length) editor.deleteShapes(spills.map((s) => s!.id))
		editor.updateShape<NodeShape>({
			id: shape.id,
			type: 'node',
			props: { node: node as NodeShape['props']['node'], spillId: undefined, spillIds: undefined, isOutOfDate: true },
		})
		clearNodeRun(editor, shape.id)
	}

	const paste = async () => {
		const data = await readClipboard()
		const patch = pastePatch(shape.props.node as unknown as { type: string }, data)
		if (!patch) return
		let next = { ...(shape.props.node as unknown as Record<string, unknown>), ...patch }
		if (next.type === 'load_image' && typeof next.source === 'string' && next.source && !data.imageUrl) {
			try {
				next = { ...next, imageUrl: await apiImportImage(next.source) }
			} catch {
				// Keep the path or URL. Run reports it if the file cannot be read.
			}
		}
		editor.updateShape<NodeShape>({
			id: shape.id,
			type: 'node',
			props: { node: next as NodeShape['props']['node'], isOutOfDate: true },
		})
	}

	return (
		<div className="NodeFooterMenu" onPointerDown={(e) => e.stopPropagation()}>
			<TldrawUiDropdownMenuRoot id={`node-menu-${shape.id}`}>
				<TldrawUiDropdownMenuTrigger>
					<UiIconButton icon={<IconMore />} title="More options" className="NodeFooterMenu-trigger" />
				</TldrawUiDropdownMenuTrigger>
				<TldrawUiDropdownMenuContent side="top" align="end" sideOffset={4} alignOffset={0}>
					<TldrawUiDropdownMenuGroup>
						<TldrawUiDropdownMenuItem>
							<TldrawUiButton type="menu" onClick={handleDuplicate}>
								<TldrawUiButtonLabel>Duplicate</TldrawUiButtonLabel>
							</TldrawUiButton>
						</TldrawUiDropdownMenuItem>
						{imageUrl && (
							<TldrawUiDropdownMenuItem>
								<TldrawUiButton type="menu" onClick={handleDownloadImage}>
									<TldrawUiButtonLabel>Download image</TldrawUiButtonLabel>
								</TldrawUiButton>
							</TldrawUiDropdownMenuItem>
						)}
						{imageUrl && (
							<TldrawUiDropdownMenuItem>
								<TldrawUiButton type="menu" onClick={() => placeImageOnCanvas(editor, shape, imageUrl)}>
									<TldrawUiButtonLabel>Place image on canvas</TldrawUiButtonLabel>
								</TldrawUiButton>
							</TldrawUiDropdownMenuItem>
						)}
						{textResult && (
							<TldrawUiDropdownMenuItem>
								<TldrawUiButton type="menu" onClick={() => placeTextOnCanvas(editor, shape, textResult, 'markdown')}>
									<TldrawUiButtonLabel>Place text on canvas</TldrawUiButtonLabel>
								</TldrawUiButton>
							</TldrawUiDropdownMenuItem>
						)}
						{textResult && (
							<TldrawUiDropdownMenuItem>
								<TldrawUiButton type="menu" onClick={handleCopyText}>
									<TldrawUiButtonLabel>Copy text</TldrawUiButtonLabel>
								</TldrawUiButton>
							</TldrawUiDropdownMenuItem>
						)}
						{hasResult && (
							<TldrawUiDropdownMenuItem>
								<TldrawUiButton type="menu" onClick={handleClearResult}>
									<TldrawUiButtonLabel>Clear result</TldrawUiButtonLabel>
								</TldrawUiButton>
							</TldrawUiDropdownMenuItem>
						)}
					</TldrawUiDropdownMenuGroup>
					<TldrawUiDropdownMenuGroup>
						<TldrawUiDropdownMenuItem>
							<TldrawUiButton type="menu" title="Paste text or an image" onClick={() => void paste()}>
								<TldrawUiButtonLabel>Paste</TldrawUiButtonLabel>
							</TldrawUiButton>
						</TldrawUiDropdownMenuItem>
						<TldrawUiDropdownMenuItem noClose>
							<TldrawUiButton
								type="menu"
								title={pinned ? 'Unpin' : 'Pin. Freezes position and size, and keeps every wire on this node.'}
								onClick={() => editor.updateShape<NodeShape>({ id: shape.id, type: 'node', props: { pinned: !pinned } })}
							>
								<TldrawUiButtonCheck checked={pinned} />
								<TldrawUiButtonLabel>{pinned ? 'Unpin' : 'Pin'}</TldrawUiButtonLabel>
							</TldrawUiButton>
						</TldrawUiDropdownMenuItem>
						<TldrawUiDropdownMenuItem noClose>
							<TldrawUiButton
								type="menu"
								title={deleteLocked ? 'Allow delete' : 'Lock delete'}
								onClick={() =>
									editor.updateShape<NodeShape>({ id: shape.id, type: 'node', props: { deleteLocked: !deleteLocked } })
								}
							>
								<TldrawUiButtonCheck checked={deleteLocked} />
								<TldrawUiButtonLabel>{deleteLocked ? 'Allow delete' : 'Lock delete'}</TldrawUiButtonLabel>
							</TldrawUiButton>
						</TldrawUiDropdownMenuItem>
						<TldrawUiDropdownMenuItem noClose>
							<TldrawUiButton
								type="menu"
								title="When on, the output also appears as a shape next to the node"
								onClick={toggleSpill}
							>
								<TldrawUiButtonCheck checked={spills} />
								<TldrawUiButtonLabel>Put output on canvas</TldrawUiButtonLabel>
							</TldrawUiButton>
						</TldrawUiDropdownMenuItem>
						<TldrawUiDropdownMenuItem noClose>
							<TldrawUiButton type="menu" title="Smaller text" disabled={fontSize <= MIN_NODE_FONT_PX} onClick={() => stepFont(-1)}>
								<TldrawUiButtonLabel>Smaller text</TldrawUiButtonLabel>
							</TldrawUiButton>
						</TldrawUiDropdownMenuItem>
						<TldrawUiDropdownMenuItem noClose>
							<TldrawUiButton type="menu" title="Larger text" disabled={fontSize >= MAX_NODE_FONT_PX} onClick={() => stepFont(1)}>
								<TldrawUiButtonLabel>Larger text</TldrawUiButtonLabel>
							</TldrawUiButton>
						</TldrawUiDropdownMenuItem>
						<TldrawUiDropdownMenuItem>
							<TldrawUiButton type="menu" title="Clear output" onClick={clearOutput}>
								<TldrawUiButtonLabel>Clear output</TldrawUiButtonLabel>
							</TldrawUiButton>
						</TldrawUiDropdownMenuItem>
						<TldrawUiDropdownMenuItem>
							<TldrawUiButton
								type="menu"
								title="Run this card (and anything it needs) again, even if nothing changed"
								onClick={() => void startExecution(editor, new Set([shape.id]), { noCache: true })}
							>
								<TldrawUiButtonLabel>Run without cache</TldrawUiButtonLabel>
							</TldrawUiButton>
						</TldrawUiDropdownMenuItem>
					</TldrawUiDropdownMenuGroup>
				</TldrawUiDropdownMenuContent>
			</TldrawUiDropdownMenuRoot>
		</div>
	)
}

const MIN_NODE_FONT_PX = 12
const MAX_NODE_FONT_PX = 28

/**
 * A note kept with the node. The corner icon opens it. "Show all notes" in the menu opens every
 * note in view; right-click Note opens a single one.
 */
function NodeNote({ shape }: { shape: NodeShape }) {
	const editor = useEditor()
	const all = useValue('notes all', () => $notesAll.get(), [])
	const opened = useValue('note open', () => $notesOpen.get().includes(shape.id), [shape.id])
	const note = shape.props.note ?? ''
	const open = all ? note !== '' || opened : opened
	return (
		<>
			<button
				type="button"
				className={'NodeShape-noteIcon' + (note ? ' has-note' : '') + (open ? ' is-open' : '')}
				title={note ? 'Note' : 'Add a note'}
				onPointerDown={(event) => event.stopPropagation()}
				onClick={() => toggleNoteOpen(shape.id)}
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<circle cx="5" cy="12" r="1.2" fill="currentColor" />
					<circle cx="12" cy="12" r="1.2" fill="currentColor" />
					<circle cx="19" cy="12" r="1.2" fill="currentColor" />
				</svg>
			</button>
			{open && (
				<textarea
					className="NodeShape-note"
					autoFocus={opened}
					placeholder="Note"
					value={note}
					onPointerDown={(event) => event.stopPropagation()}
					onKeyDown={(event) => event.stopPropagation()}
					onChange={(event) =>
						editor.updateShape<NodeShape>({ id: shape.id, type: 'node', props: { note: event.target.value || undefined } })
					}
				/>
			)}
		</>
	)
}
