import { Editor, TLShape } from 'tldraw'
import { shortTimeStamp, slugifyFileName } from '../../shared/fileSlug'
import { linkDerived } from '../clips/derivedLink'
import { storeBlob } from './imageOps'
import { placeImageOnCanvas } from './placeOnCanvas'

/**
 * Chart rendering off-screen (ECharts' server-side SVG mode: no DOM node, no animation frame, so
 * it renders the same whether or not the page is visible) and WP49's chart exports: Save PNG,
 * Save SVG, Copy image, Place on canvas. The Chart card's own run output uses the same path.
 */

export const CHART_EXPORT_WIDTH = 960
export const CHART_EXPORT_HEIGHT = 600

/** The theme's own background, so dark-theme text stays readable in an exported image. */
function chartBackground(): string {
	return (
		getComputedStyle(document.querySelector('.tl-container') ?? document.body).getPropertyValue('--tl-color-background').trim() || '#fff'
	)
}

/** An ECharts option rendered to an SVG document (text). */
export async function chartSvg(option: Record<string, unknown>, width = CHART_EXPORT_WIDTH, height = CHART_EXPORT_HEIGHT): Promise<string> {
	const mod = await import('echarts')
	const chart = mod.init(null, null, { renderer: 'svg', ssr: true, width, height })
	try {
		chart.setOption({ ...option, animation: false, backgroundColor: chartBackground() })
		return chart.renderToSVGString()
	} finally {
		chart.dispose()
	}
}

export async function svgToPng(svg: Blob, width: number, height: number, scale: number): Promise<Blob> {
	const url = URL.createObjectURL(svg)
	try {
		const img = new Image()
		img.src = url
		await Promise.race([
			img.decode(),
			new Promise((_, reject) => setTimeout(() => reject(new Error('SVG decode timed out')), 5000)),
		])
		const canvas = document.createElement('canvas')
		canvas.width = width * scale
		canvas.height = height * scale
		const ctx = canvas.getContext('2d')
		if (!ctx) throw new Error('No 2D canvas')
		ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encode failed'))), 'image/png')
		)
	} finally {
		URL.revokeObjectURL(url)
	}
}

/** Render to a stored image URL (/api/images/…): a PNG, or the SVG when rasterizing fails. */
export async function renderChartPng(option: Record<string, unknown>, width = CHART_EXPORT_WIDTH, height = CHART_EXPORT_HEIGHT): Promise<string> {
	const svgBlob = new Blob([await chartSvg(option, width, height)], { type: 'image/svg+xml' })
	try {
		return await storeBlob(await svgToPng(svgBlob, width, height, 2))
	} catch {
		// Rasterizing failed (no canvas support): keep the SVG, it still shows and places fine.
		return await storeBlob(svgBlob)
	}
}

async function chartPngBlob(option: Record<string, unknown>): Promise<Blob> {
	const svg = new Blob([await chartSvg(option)], { type: 'image/svg+xml' })
	return svgToPng(svg, CHART_EXPORT_WIDTH, CHART_EXPORT_HEIGHT, 2)
}

function downloadBlob(blob: Blob, fileName: string) {
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = fileName
	document.body.appendChild(a)
	a.click()
	document.body.removeChild(a)
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function exportName(label: string, ext: string) {
	return `${slugifyFileName(label || 'chart', 'chart')}-${shortTimeStamp()}.${ext}`
}

export async function saveChartPng(option: Record<string, unknown>, label: string) {
	downloadBlob(await chartPngBlob(option), exportName(label, 'png'))
}

export async function saveChartSvg(option: Record<string, unknown>, label: string) {
	downloadBlob(new Blob([await chartSvg(option)], { type: 'image/svg+xml' }), exportName(label, 'svg'))
}

/** Copy the chart as a PNG image to the clipboard. */
export async function copyChartImage(option: Record<string, unknown>) {
	if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
		throw new Error('This browser cannot copy images. Use Save PNG instead.')
	}
	// The promise form keeps the user gesture while the PNG is rendered.
	await navigator.clipboard.write([new ClipboardItem({ 'image/png': chartPngBlob(option) })])
}

/** Place the chart on the canvas as an image shape, with a "derived from" link to the card. */
export async function placeChartOnCanvas(editor: Editor, card: TLShape, option: Record<string, unknown>) {
	const url = await storeBlob(await chartPngBlob(option))
	const id = await placeImageOnCanvas(editor, card, url, { name: 'chart' })
	linkDerived(editor, card.id, id, 'chart')
	return id
}
