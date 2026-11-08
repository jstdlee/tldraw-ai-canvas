import { useEditor, useValue } from 'tldraw'
import { $zipSliders } from './zipWires'

/** WP43: the small zip slider pill that runs along a bundle while "Zip wires" plays. */
export function ZipSliderLayer() {
	const editor = useEditor()
	const pills = useValue(
		'zip sliders',
		() =>
			$zipSliders.get().map((slider) => {
				const point = editor.pageToViewport(slider)
				return { id: slider.id, x: point.x, y: point.y, angle: slider.angle, opacity: slider.opacity }
			}),
		[editor]
	)
	if (!pills.length) return null
	return (
		<>
			{pills.map((pill) => (
				<div
					key={pill.id}
					className="ZipSlider"
					aria-hidden
					style={{
						transform: `translate(${pill.x}px, ${pill.y}px) translate(-50%, -50%) rotate(${pill.angle}rad)`,
						opacity: pill.opacity,
					}}
				/>
			))}
		</>
	)
}
