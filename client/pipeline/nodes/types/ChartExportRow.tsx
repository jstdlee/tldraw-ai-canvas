import { useState } from 'react'
import { useEditor } from 'tldraw'
import { copyChartImage, placeChartOnCanvas, saveChartPng, saveChartSvg } from '../../chartExport'
import { NodeShape } from '../NodeShapeUtil'
import { IconCopy, IconDownload, IconPicture, UiButton } from '../../../ui'
import { NodeRow } from './shared'

/**
 * WP49: the Chart card's export row: Save PNG, Save SVG, Copy image, Place on canvas (an image
 * shape with a "derived from" link back to the card). Renders the chart's current settings
 * off-screen, the same way the card's own run output is made (client/pipeline/chartExport.ts).
 */
export function ChartExportRow({
	shape,
	ready,
	label,
	getOption,
}: {
	shape: NodeShape
	ready: boolean
	label: string
	getOption: () => Record<string, unknown>
}) {
	const editor = useEditor()
	const [status, setStatus] = useState<string | null>(null)
	const run = (job: () => Promise<unknown>, done: string) => {
		setStatus(null)
		job()
			.then(() => setStatus(done))
			.catch((error: Error) => setStatus(error.message || 'Export failed'))
	}
	return (
		<NodeRow className="ChartNode-actions" title={status ?? ''}>
			<UiButton size="sm" variant="low" icon={<IconDownload size={14} />} label="PNG" title="Save PNG" disabled={!ready} onClick={() => run(() => saveChartPng(getOption(), label), 'Saved')} />
			<UiButton size="sm" variant="low" icon={<IconDownload size={14} />} label="SVG" title="Save SVG" disabled={!ready} onClick={() => run(() => saveChartSvg(getOption(), label), 'Saved')} />
			<UiButton size="sm" variant="low" icon={<IconCopy size={14} />} label="Copy" title="Copy image" disabled={!ready} onClick={() => run(() => copyChartImage(getOption()), 'Copied')} />
			<UiButton
				size="sm"
				variant="low"
				icon={<IconPicture size={14} />}
				label="Place"
				title="Place on canvas"
				disabled={!ready}
				onClick={() => run(() => placeChartOnCanvas(editor, editor.getShape(shape.id) ?? shape, getOption()), 'Placed')}
			/>
			{status && <span className="NodeHint">{status}</span>}
		</NodeRow>
	)
}
