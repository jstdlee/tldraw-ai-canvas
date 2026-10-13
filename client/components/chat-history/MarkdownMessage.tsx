import { ReactNode, useState } from 'react'
import Markdown from 'react-markdown'
import { IconCheck, IconCopy } from '../../ui'

/**
 * WP28 Part C: renders agent/action markdown with a copy button on code blocks.
 * Used everywhere action descriptions are shown in the chat thread.
 *
 * Takes `text` rather than `children` — a component prop typed as exactly `string`
 * runs into a TS/JSX quirk (TS2745) that expects an array of children instead of one.
 */
export function MarkdownMessage({ text }: { text: string | null }) {
	return (
		<Markdown
			components={{
				code(props) {
					const { children: code, className } = props
					// Inline code (no fence, no language class) stays plain.
					if (!className) return <code className={className}>{code}</code>
					return <CodeBlock className={className}>{code}</CodeBlock>
				},
			}}
		>
			{text}
		</Markdown>
	)
}

function CodeBlock({ className, children }: { className?: string; children: ReactNode }) {
	const [copied, setCopied] = useState(false)

	const copy = () => {
		const text = typeof children === 'string' ? children : String(children ?? '')
		navigator.clipboard?.writeText(text).then(() => {
			setCopied(true)
			setTimeout(() => setCopied(false), 1200)
		})
	}

	return (
		<div className="chat-code-block">
			<button
				type="button"
				className="chat-code-block-copy"
				title="Copy code"
				onPointerDown={(e) => e.stopPropagation()}
				onClick={copy}
			>
				{copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
			</button>
			<pre>
				<code className={className}>{children}</code>
			</pre>
		</div>
	)
}
