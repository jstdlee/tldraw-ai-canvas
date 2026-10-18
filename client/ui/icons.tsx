import type { ReactNode } from 'react'

export interface IconProps {
	size?: number
}

function Svg({
	size = 16,
	children,
	fill = 'none',
}: {
	size?: number
	children: ReactNode
	fill?: string
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill={fill}
			stroke={fill === 'none' ? 'currentColor' : 'none'}
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			{children}
		</svg>
	)
}

/** Four-point star with a smaller star. The AI mark. */
export function IconSparkle({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M8 1.4 9.15 6.1 13.6 8 9.15 9.9 8 14.6 6.85 9.9 2.4 8 6.85 6.1Z" />
			<path d="M12.4 1.7 12.9 3.1 14.3 3.55 12.9 4 12.4 5.4 11.9 4 10.5 3.55 11.9 3.1Z" />
		</Svg>
	)
}

export function IconPlay({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M5 3.2v9.6l7.2-4.8L5 3.2Z" />
		</Svg>
	)
}

export function IconStop({ size }: IconProps) {
	return (
		<Svg size={size}>
			<rect x="4" y="4" width="8" height="8" rx="1.2" />
		</Svg>
	)
}

export function IconCopy({ size }: IconProps) {
	return (
		<Svg size={size}>
			<rect x="5.5" y="5.5" width="7" height="8" rx="1.2" />
			<path d="M3.5 10.5v-7A1.5 1.5 0 0 1 5 2h6" />
		</Svg>
	)
}

export function IconCheck({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M3.2 8.2 6.4 11.4 12.8 4.6" />
		</Svg>
	)
}

export function IconChevronUp({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="m3.5 10 4.5-4.5L12.5 10" />
		</Svg>
	)
}

export function IconChevronDown({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="m3.5 6 4.5 4.5L12.5 6" />
		</Svg>
	)
}

export function IconChevronRight({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="m6 3.5 4.5 4.5L6 12.5" />
		</Svg>
	)
}

/** Three horizontal dots. */
export function IconMore({ size = 16 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
			<circle cx="3.2" cy="8" r="1.15" />
			<circle cx="8" cy="8" r="1.15" />
			<circle cx="12.8" cy="8" r="1.15" />
		</svg>
	)
}

export function IconPin({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M8 14.2s-4.2-4-4.2-7.1a4.2 4.2 0 0 1 8.4 0c0 3.1-4.2 7.1-4.2 7.1Z" />
			<circle cx="8" cy="7" r="1.3" />
		</Svg>
	)
}

export function IconLock({ size }: IconProps) {
	return (
		<Svg size={size}>
			<rect x="3.5" y="7" width="9" height="6.2" rx="1.2" />
			<path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
		</Svg>
	)
}

export function IconUnlock({ size }: IconProps) {
	return (
		<Svg size={size}>
			<rect x="3.5" y="7" width="9" height="6.2" rx="1.2" />
			<path d="M5.5 7V5.2a2.5 2.5 0 0 1 4.6-1.3" />
		</Svg>
	)
}

export function IconPaste({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M5.5 3.2h5A1.5 1.5 0 0 1 12 4.7v8.6H4V4.7A1.5 1.5 0 0 1 5.5 3.2Z" />
			<path d="M6.2 3.2V2.4h3.6v.8" />
		</Svg>
	)
}

/** Eraser. */
export function IconClear({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M3 10.2 7.6 5.6l3.2 3.2-4.6 4.6H3.4L3 10.2Z" />
			<path d="M6.2 13.4h6.6" />
		</Svg>
	)
}

export function IconTextSmaller({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M2.4 12.2 5.2 4h1.3l2.8 8.2" />
			<path d="M3.4 9.4h4.4" />
			<path d="M11.2 12.2h3.2" />
		</Svg>
	)
}

export function IconTextLarger({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M1.8 12.6 5 3.2h1.4L9.6 12.6" />
			<path d="M3 9.4h4.6" />
			<path d="M12.2 8.2v4.4M10 10.4h4.4" />
		</Svg>
	)
}

export function IconAlert({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M8 2.2 14.2 13.2H1.8L8 2.2Z" />
			<path d="M8 6.4v3.3" />
			<path d="M8 11.4h.01" />
		</Svg>
	)
}

export function IconClose({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="m4 4 8 8M12 4l-8 8" />
		</Svg>
	)
}

export function IconUpload({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M8 3.2v7" />
			<path d="m4.8 6.2 3.2-3.2 3.2 3.2" />
			<path d="M3.2 12.8h9.6" />
		</Svg>
	)
}

export function IconDownload({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M8 3.2v7" />
			<path d="m4.8 7.8 3.2 3.2 3.2-3.2" />
			<path d="M3.2 12.8h9.6" />
		</Svg>
	)
}

export function IconTable({ size }: IconProps) {
	return (
		<Svg size={size}>
			<rect x="2.2" y="2.6" width="11.6" height="10.8" rx="1.2" />
			<path d="M2.2 6.2h11.6M6.2 6.2v7.2" />
		</Svg>
	)
}

export function IconDatabase({ size }: IconProps) {
	return (
		<Svg size={size}>
			<ellipse cx="8" cy="3.8" rx="4.8" ry="1.7" />
			<path d="M3.2 3.8v8.2c0 1 2.1 1.8 4.8 1.8s4.8-.8 4.8-1.8V3.8" />
			<path d="M3.2 8c0 1 2.1 1.8 4.8 1.8s4.8-.8 4.8-1.8" />
		</Svg>
	)
}

/** Two stacked boxes. */
export function IconGroup({ size }: IconProps) {
	return (
		<Svg size={size}>
			<rect x="2.4" y="6.2" width="8.2" height="6.4" rx="1" />
			<path d="M5.4 6.2V4.4A1 1 0 0 1 6.4 3.4h6.2a1 1 0 0 1 1 1V9" />
		</Svg>
	)
}

export function IconExpand({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M9.2 3.2H12.8V6.8" />
			<path d="M12.6 3.4 9 7" />
			<path d="M6.8 12.8H3.2V9.2" />
			<path d="M3.4 12.6 7 9" />
		</Svg>
	)
}

export function IconCollapse({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M6.8 6.8H3.2V3.2" />
			<path d="M3.4 3.4 7 7" />
			<path d="M9.2 9.2h3.6v3.6" />
			<path d="M12.6 12.6 9 9" />
		</Svg>
	)
}

export function IconPlus({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M8 3.2v9.6M3.2 8h9.6" />
		</Svg>
	)
}

export function IconTrash({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M3.2 4.4h9.6" />
			<path d="M6.2 4.4V3.2h3.6v1.2" />
			<path d="M4.4 4.4 5 13h6l.6-8.6" />
		</Svg>
	)
}

export function IconWand({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M3.2 12.8 11.2 4.8l1.2 1.2-8 8-1.6.4.4-1.6Z" />
			<path d="M11.6 2.4v2.2M10.5 3.5h2.2" />
			<path d="M3.4 3.2v1.6M2.6 4h1.6" />
		</Svg>
	)
}

/** Side panel with an arrow pointing left. Collapse the library. */
export function IconSidebarCollapse({ size }: IconProps) {
	return (
		<Svg size={size}>
			<rect x="2.2" y="2.4" width="11.6" height="11.2" rx="1.2" />
			<path d="M6.2 2.4v11.2" />
			<path d="M10.6 6.4 8.2 8l2.4 1.6" />
		</Svg>
	)
}

/** Side panel with an arrow pointing right. Expand the library. */
export function IconSidebarExpand({ size }: IconProps) {
	return (
		<Svg size={size}>
			<rect x="2.2" y="2.4" width="11.6" height="11.2" rx="1.2" />
			<path d="M6.2 2.4v11.2" />
			<path d="M8 6.4 10.4 8 8 9.6" />
		</Svg>
	)
}

/** Magnifying glass. Search. */
export function IconSearch({ size }: IconProps) {
	return (
		<Svg size={size}>
			<circle cx="6.8" cy="6.8" r="4.2" />
			<path d="M13.2 13.2 10 10" strokeLinecap="round" />
		</Svg>
	)
}

/** Four-pointed sparkle, smaller than IconSparkle. Marks an AI-ranked result. */
export function IconJevMark({ size }: IconProps) {
	return (
		<Svg size={size} fill="currentColor">
			<path d="M8 2.2 9.2 6.8 13.8 8 9.2 9.2 8 13.8 6.8 9.2 2.2 8 6.8 6.8Z" />
		</Svg>
	)
}

/** A capital "T". The Text card group. */
export function IconText({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M3 3.6h10" />
			<path d="M8 3.6v8.8" />
		</Svg>
	)
}

/** A fork: one line splitting into two. The Decide card group. */
export function IconBranch({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M5 2.4v4.2c0 1.6 1.3 2.4 3 2.4s3-.8 3-2.4V2.4" />
			<path d="M8 8.6v4.8" />
			<circle cx="5" cy="2.4" r="1" />
			<circle cx="11" cy="2.4" r="1" />
			<circle cx="8" cy="13.6" r="1" />
		</Svg>
	)
}

/** A globe. The Web card group. */
export function IconGlobe({ size }: IconProps) {
	return (
		<Svg size={size}>
			<circle cx="8" cy="8" r="5.6" />
			<path d="M2.4 8h11.2" />
			<path d="M8 2.4c1.8 1.6 2.8 3.6 2.8 5.6s-1 4-2.8 5.6c-1.8-1.6-2.8-3.6-2.8-5.6s1-4 2.8-5.6Z" />
		</Svg>
	)
}

/** A mountain/picture frame. The Image card group. */
export function IconPicture({ size }: IconProps) {
	return (
		<Svg size={size}>
			<rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1.2" />
			<circle cx="5.6" cy="6.2" r="1.1" />
			<path d="m3 12 3.6-4 2.6 2.8 1.8-2 2.4 3" />
		</Svg>
	)
}

/** Code brackets. The Flow & code card group. */
export function IconCodeBrackets({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M6 3.6 2.6 8 6 12.4" />
			<path d="M10 3.6 13.4 8 10 12.4" />
		</Svg>
	)
}

/** An arrow leaving a box. The Output card group. */
export function IconOutput({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M3.2 2.8h5.2v10.4H3.2z" />
			<path d="M8.4 8h4.4" />
			<path d="m10.6 5.6 2.4 2.4-2.4 2.4" />
		</Svg>
	)
}

/** A curly brace fanning out into separate lines. The JSON fields card. */
export function IconJsonFields({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M5.4 2.8c-1 0-1.4.5-1.4 1.6v1.4c0 .7-.3.9-.9 1.1.6.2.9.4.9 1.1v1.4c0 1.1.4 1.6 1.4 1.6" />
			<path d="M9 5.4h4M9 8h4M9 10.6h4" />
		</Svg>
	)
}

/** A funnel. The Extract-from-text card. */
export function IconExtract({ size }: IconProps) {
	return (
		<Svg size={size}>
			<path d="M2.6 3.2h10.8l-3.8 4.6v4l-3.2 1.4V7.8z" />
		</Svg>
	)
}

/** A document with mirrored {{ }} marks. The Template card. */
export function IconTemplate({ size }: IconProps) {
	return (
		<Svg size={size}>
			<rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1.4" />
			<path d="M6.4 6.4c-.7 0-.9.3-.9.9v.9c0 .3-.2.4-.4.5.2.1.4.2.4.5v.9c0 .6.2.9.9.9" />
			<path d="M9.6 6.4c.7 0 .9.3.9.9v.9c0 .3.2.4.4.5-.2.1-.4.2-.4.5v.9c0 .6-.2.9-.9.9" />
		</Svg>
	)
}
