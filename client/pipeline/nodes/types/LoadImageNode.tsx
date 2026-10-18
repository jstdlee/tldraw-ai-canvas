import { categoryOf } from '../../../../shared/nodeGroups'
import { useCallback, useState } from 'react'
import { T, useEditor } from 'tldraw'
import { apiImportImage } from '../../api/pipelineApi'
import { FieldMax, ImageZoom } from '../../editors/LargeEditor'
import { toImageUrl } from '../../imageOps'
import { LoadImageIcon } from '../../components/icons/LoadImageIcon'
import {
	getNodeRowHeightPx,
	NODE_HEADER_HEIGHT_PX,
	NODE_IMAGE_PREVIEW_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
	NODE_WIDTH_PX,
} from '../../constants'
import { ShapePort } from '../../ports/Port'
import { sleep } from '../../utils/sleep'
import { IconClose, UiButton, UiIconButton, UiTextInput } from '../../../ui'
import { NodeShape } from '../NodeShapeUtil'
import { PortRow, useInputConnected, WireField, WireFieldHeader } from './fields'
import {
	ExecutionResult,
	getInputText,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeImage,
	NodeRow,
	updateNode,
} from './shared'

export type LoadImageNode = T.TypeOf<typeof LoadImageNode>
export const LoadImageNode = T.object({
	type: T.literal('load_image'),
	imageUrl: T.string.nullable(),
	/** A URL or a file path. Play copies it into the image store. */
	source: T.string.optional(),
	/** IMAGE-05: the same message whether the broken URL came from the Source field or a wired
	 * `url` port — new field on an existing type, so it's optional (old saves have none). */
	error: T.string.nullable().optional(),
})

export class LoadImageNodeDefinition extends NodeDefinition<LoadImageNode> {
	static type = 'load_image'
	static validator = LoadImageNode
	title = 'Load image'
	heading = 'Image'
	icon = <LoadImageIcon />
	category = categoryOf('load_image')
	override showsOutput = true
	getDefault(): LoadImageNode {
		return {
			type: 'load_image',
			imageUrl: null,
			source: '',
			error: null,
		}
	}
	getBodyHeightPx(shape: NodeShape) {
		// +1 row (WP17): the imageUrl field got its own label row.
		return getNodeRowHeightPx(shape.props.fontSize) * 4 + NODE_IMAGE_PREVIEW_HEIGHT_PX
	}
	getPorts(shape: NodeShape): Record<string, ShapePort> {
		return {
			url: {
				id: 'url',
				x: 0,
				y: NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX + getNodeRowHeightPx(shape.props.fontSize) * 0.5,
				terminal: 'end',
				dataType: 'text',
			},
			output: {
				id: 'output',
				x: NODE_WIDTH_PX,
				y: NODE_HEADER_HEIGHT_PX / 2,
				terminal: 'start',
				dataType: 'image',
			},
		}
	}
	async execute(shape: NodeShape, node: LoadImageNode, inputs: InputValues): Promise<ExecutionResult> {
		const fromPort = getInputText(inputs, 'url').trim()
		const source = fromPort || (node.source ?? '').trim()
		let imageUrl = node.imageUrl
		if (source) {
			try {
				imageUrl = fromPort ? await toImageUrl(fromPort) : await apiImportImage(source)
			} catch (e) {
				// IMAGE-05: store the same message the Source field's own "Load" button shows
				// inline, then still throw — the run banner is the normal way a card reports
				// failure (RULES.md), and a wired `url` port has no field-level UI of its own to
				// show it inline instead.
				const message = (e as Error).message
				updateNode<LoadImageNode>(this.editor, shape, (n) => ({ ...n, error: message }), false)
				throw e
			}
			updateNode<LoadImageNode>(this.editor, shape, (n) => ({
				...n,
				imageUrl,
				source: fromPort ? n.source : source,
				error: null,
			}))
		}
		await sleep(200)
		return { output: imageUrl }
	}
	getOutputInfo(shape: NodeShape, node: LoadImageNode): InfoValues {
		return {
			output: {
				value: node.imageUrl,
				isOutOfDate: shape.props.isOutOfDate,
				dataType: 'image',
			},
		}
	}
	Component = LoadImageNodeComponent
}

/** Read a File as a data URL. */
function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(reader.result as string)
		reader.onerror = () => reject(reader.error)
		reader.readAsDataURL(file)
	})
}

/** Open the native file picker for an image file. */
function selectImageFile(): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement('input')
		input.type = 'file'
		input.accept = 'image/*'
		input.style.display = 'none'

		const dispose = () => {
			input.removeEventListener('change', onChange)
			input.removeEventListener('cancel', onCancel)
			input.remove()
		}

		const onChange = (event: Event) => {
			const fileList = (event.target as HTMLInputElement).files
			resolve(fileList && fileList.length > 0 ? fileList[0] : null)
			dispose()
		}

		const onCancel = () => {
			resolve(null)
			dispose()
		}

		document.body.appendChild(input)
		input.addEventListener('cancel', onCancel)
		input.addEventListener('change', onChange)
		input.click()
	})
}

function LoadImageNodeComponent({ shape, node }: NodeComponentProps<LoadImageNode>) {
	const editor = useEditor()
	const urlWired = useInputConnected(shape.id, 'url')
	const [isDragOver, setIsDragOver] = useState(false)
	const [zoom, setZoom] = useState(false)

	const handleFile = useCallback(
		async (file: File) => {
			if (!file.type.startsWith('image/')) return
			const dataUrl = await readFileAsDataUrl(file)
			updateNode<LoadImageNode>(editor, shape, (n) => ({ ...n, imageUrl: dataUrl, source: '', error: null }))
		},
		[editor, shape]
	)

	const handleBrowse = useCallback(async () => {
		const file = await selectImageFile()
		if (file) handleFile(file)
	}, [handleFile])

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault()
			e.stopPropagation()
			setIsDragOver(false)
			const file = e.dataTransfer.files[0]
			if (file) handleFile(file)
		},
		[handleFile]
	)

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragOver(true)
	}, [])

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragOver(false)
	}, [])

	const loadSource = useCallback(async () => {
		const source = (node.source ?? '').trim()
		if (!source) return
		updateNode<LoadImageNode>(editor, shape, (n) => ({ ...n, error: null }), false)
		try {
			const imageUrl = await apiImportImage(source)
			updateNode<LoadImageNode>(editor, shape, (n) => ({ ...n, imageUrl, error: null }))
		} catch (e) {
			// IMAGE-05: stored on the node (not just local state), so this exact message is also
			// what the run-failed banner shows if the card is run some other way (a wired `url`
			// port, Run without cache, …) — one message, however the failure happened.
			updateNode<LoadImageNode>(editor, shape, (n) => ({ ...n, error: (e as Error).message }), false)
		}
	}, [editor, node.source, shape])

	return (
		<>
			<PortRow shapeId={shape.id} portId="url" label="URL" dataType="text" hint="optional: overrides the field below" />
			{!urlWired && (
				<WireField shapeId={shape.id} fieldKey="source" label="Source">
					<>
						<UiTextInput
							placeholder="Image URL"
							value={node.source ?? ''}
							onChange={(source) => updateNode<LoadImageNode>(editor, shape, (n) => ({ ...n, source }))}
						/>
						<UiButton size="sm" variant="low" className="LoadImageNode-browse" label="Load" onClick={() => void loadSource()} />
					</>
				</WireField>
			)}
			<WireFieldHeader shapeId={shape.id} fieldKey="imageUrl" label="Image" />
			<NodeRow>
				<UiButton
					size="sm"
					variant="low"
					className="LoadImageNode-browse"
					label={node.imageUrl ? 'Replace...' : 'Browse...'}
					onClick={handleBrowse}
				/>
				{node.imageUrl && (
					<UiIconButton
						icon={<IconClose />}
						title="Clear image"
						onClick={() => updateNode<LoadImageNode>(editor, shape, (n) => ({ ...n, imageUrl: null, source: '' }))}
					/>
				)}
			</NodeRow>
			<div
				className={`NodeImagePreview ${isDragOver ? 'NodeImagePreview_dragover' : ''}`}
				onDrop={handleDrop}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
			>
				{node.imageUrl ? (
					<>
						<NodeImage src={node.imageUrl} alt="Loaded" />
						<FieldMax title="Open the image" onClick={() => setZoom(true)} />
					</>
				) : (
					<div className="NodeImagePreview-empty">
						<span>{isDragOver ? 'Drop image here' : node.error ?? 'Drop, browse, paste, or enter a URL'}</span>
					</div>
				)}
			</div>
			{zoom && node.imageUrl && (
				<ImageZoom src={node.imageUrl} onClose={() => setZoom(false)} editor={editor} nextTo={shape} />
			)}
		</>
	)
}
