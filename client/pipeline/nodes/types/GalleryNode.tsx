import { useState } from 'react'
import { categoryOf } from '../../../../shared/nodeGroups'
import { parseImageList } from '../../../../shared/imageList'
import { slugifyFileName } from '../../../../shared/fileSlug'
import { T, useEditor } from 'tldraw'
import { GalleryIcon } from '../../components/icons/GalleryIcon'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX, NODE_WIDTH_PX } from '../../constants'
import { ShapePort } from '../../ports/Port'
import { buildZip } from '../../utils/zip'
import { NodeShape } from '../NodeShapeUtil'
import { FieldMax, ImageZoom } from '../../editors/LargeEditor'
import { IconDownload, UiButton, UiEmpty, UiNumberInput } from '../../../ui'
import { OutputPortRow, PortRow, stopEvent, WireField } from './fields'
import {
	areAnyInputsOutOfDate,
	coerceToText,
	ExecutionResult,
	getInput,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeImage,
	updateNode,
} from './shared'

/**
 * WP36 "P" (image gallery / grid viewer): the single biggest gap for "a pipeline with more than
 * one image" — the generic Output card breaks on a multi-image value (IMAGE-02) and nothing
 * shows a list of images as a grid. Accepts the same shapes Generate image's own `images` port
 * and a For Each loop already produce: newline-joined URLs, a JSON array (of strings or of
 * `{url}`-ish objects), or a table with a `url`/`image`/`src` column (`shared/imageList.ts`).
 * Output passes the same list through, so a gallery can sit in the middle of a pipeline too.
 */
export type GalleryNode = T.TypeOf<typeof GalleryNode>
export const GalleryNode = T.object({
	type: T.literal('gallery'),
	columns: T.number,
	lastImages: T.string.nullable(),
	error: T.string.nullable(),
})

const GRID_AREA_PX = 240
const EMPTY_AREA_PX = 120

export class GalleryNodeDefinition extends NodeDefinition<GalleryNode> {
	static type = 'gallery'
	static validator = GalleryNode
	title = 'Gallery'
	heading = 'Gallery'
	icon = <GalleryIcon />
	category = categoryOf('gallery')
	override showsOutput = true
	resultKeys = ['lastImages', 'error'] as const
	getDefault(): GalleryNode {
		return { type: 'gallery', columns: 3, lastImages: null, error: null }
	}
	getBodyHeightPx(shape: NodeShape, node: GalleryNode) {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const list = parseImageList(node.lastImages)
		return rowPx * 2 + (list.length ? GRID_AREA_PX : EMPTY_AREA_PX)
	}
	getPorts(shape: NodeShape): Record<string, ShapePort> {
		return {
			images: {
				id: 'images',
				x: 0,
				y: NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX + getNodeRowHeightPx(shape.props.fontSize) * 0.5,
				terminal: 'end',
				dataType: 'text',
			},
			output: { id: 'output', x: NODE_WIDTH_PX, y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, _node: GalleryNode, inputs: InputValues): Promise<ExecutionResult> {
		const text = coerceToText(getInput(inputs, 'images'))
		updateNode<GalleryNode>(this.editor, shape, (n) => ({ ...n, lastImages: text, error: null }))
		return { output: text }
	}
	getOutputInfo(shape: NodeShape, node: GalleryNode, inputs: InfoValues): InfoValues {
		const live = inputs.images && !Array.isArray(inputs.images.value) ? inputs.images.value : null
		return {
			output: {
				value: typeof live === 'string' ? live : node.lastImages,
				isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate,
				dataType: 'text',
			},
		}
	}
	Component = GalleryNodeComponent
}

/** Fetches each URL, zips them (STORE-only, `client/pipeline/utils/zip.ts` — no npm dependency
 * for this), and downloads the archive. */
async function downloadAllAsZip(urls: string[], baseName: string) {
	const entries = await Promise.all(
		urls.map(async (url, i) => {
			const response = await fetch(url)
			const blob = await response.blob()
			const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
			return { name: `${i + 1}-${baseName}.${ext}`, data: new Uint8Array(await blob.arrayBuffer()) }
		})
	)
	const zipBlob = buildZip(entries)
	const blobUrl = URL.createObjectURL(zipBlob)
	const a = document.createElement('a')
	a.href = blobUrl
	a.download = `${baseName}.zip`
	a.rel = 'noopener'
	document.body.appendChild(a)
	a.click()
	a.remove()
	URL.revokeObjectURL(blobUrl)
}

function GalleryNodeComponent({ shape, node }: NodeComponentProps<GalleryNode>) {
	const editor = useEditor()
	const [zoomSrc, setZoomSrc] = useState<string | null>(null)
	const [zipping, setZipping] = useState(false)
	const images = parseImageList(node.lastImages)
	const columns = Math.max(1, Math.min(8, node.columns || 3))
	const baseName = slugifyFileName(shape.props.label || 'gallery')

	return (
		<>
			<PortRow shapeId={shape.id} portId="images" label="Images" dataType="text" hint="lines, JSON list, or a table's url column" />
			<OutputPortRow shapeId={shape.id} portId="output" label="Same list →" dataType="text" />
			<WireField shapeId={shape.id} fieldKey="columns" label="Columns">
				<UiNumberInput min={1} max={8} value={node.columns} onChange={(columns) => updateNode<GalleryNode>(editor, shape, (n) => ({ ...n, columns: columns ?? 3 }), false)} />
			</WireField>
			<div className="GalleryNode-grid NodeScroll" style={{ height: images.length ? GRID_AREA_PX : EMPTY_AREA_PX }} onPointerDown={stopEvent}>
				{images.length ? (
					<>
						<div className="GalleryNode-tiles" style={{ '--gallery-columns': columns } as React.CSSProperties}>
							{images.map((src, i) => (
								<div key={src + i} className="GalleryNode-tile" onClick={() => setZoomSrc(src)}>
									<NodeImage src={src} alt={`image ${i + 1}`} />
									<FieldMax title="Open the image" onClick={() => setZoomSrc(src)} />
								</div>
							))}
						</div>
						<UiButton
							size="sm"
							variant="low"
							className="GalleryNode-downloadAll"
							icon={<IconDownload />}
							label={zipping ? 'Zipping…' : `Download all (${images.length})`}
							disabled={zipping}
							onClick={async () => {
								setZipping(true)
								try {
									await downloadAllAsZip(images, baseName)
								} finally {
									setZipping(false)
								}
							}}
						/>
					</>
				) : (
					<UiEmpty text="Wire a list of images in" />
				)}
			</div>
			{zoomSrc && <ImageZoom src={zoomSrc} onClose={() => setZoomSrc(null)} editor={editor} nextTo={shape} />}
		</>
	)
}
