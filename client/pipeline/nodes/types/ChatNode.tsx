import { categoryOf } from '../../../../shared/nodeGroups'
import { useCallback } from 'react'
import { Editor, T, useEditor, useValue } from 'tldraw'
import { ModelSelect } from '../../../ai/aiConfig'
import { apiChatStream, ChatMessage } from '../../api/pipelineApi'
import { formatLlmUsage } from '../../../../shared/llmUsage'
import { GenerateTextIcon } from '../../components/icons/GenerateTextIcon'
import {
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_HEADER_GAP_PX,
	NODE_ROW_HEIGHT_PX,
	NODE_WIDTH_PX,
} from '../../constants'
import { Port, ShapePort } from '../../ports/Port'
import { getNodeInputPortValues, getNodePortConnections, NodePortConnection } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'

import {
	DEFAULT_LLM_SETTINGS,
	LlmSettingsFields,
	LlmSettingsPanel,
	llmRequestSettings,
	llmSettingsHeight,
} from './llmSettings'
import {
	ExecutionResult,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodePlaceholder,
	NodePortLabel,
	NodeRow,
	PipelineValue,
	STOP_EXECUTION,
	updateNode,
} from './shared'

/**
 * One turn of a branching conversation (from the tldraw "branching chat"
 * starter kit). Wire a chat node's output into another chat node's "Reply to"
 * port to continue the conversation; wire one parent into several children to
 * branch it. "Attach" takes an image (e.g. from a Capture node, so you can chat
 * about a sketch) or extra text.
 */
export type ChatNode = T.TypeOf<typeof ChatNode>
export const ChatNode = T.object({
	type: T.literal('chat'),
	userMessage: T.string,
	assistantMessage: T.string,
	model: T.string,
	error: T.string.nullable(),
	...LlmSettingsFields,
})

const MESSAGE_HEIGHT_PX = 76
const EMPTY_TURN: ChatNode = {
	type: 'chat',
	userMessage: '',
	assistantMessage: '',
	model: '',
	error: null,
	...DEFAULT_LLM_SETTINGS,
}
const REPLY_HEIGHT_PX = 168

export class ChatNodeDefinition extends NodeDefinition<ChatNode> {
	static type = 'chat'
	static validator = ChatNode
	title = 'Chat message'
	heading = 'Chat'
	icon = <GenerateTextIcon />
	category = categoryOf('chat')
	resultKeys = ['assistantMessage', 'error'] as const
	getDefault(): ChatNode {
		return {
			type: 'chat',
			userMessage: '',
			assistantMessage: '',
			model: '',
			error: null,
			...DEFAULT_LLM_SETTINGS,
		}
	}
	getBodyHeightPx(_shape: NodeShape, node: ChatNode) {
		return NODE_ROW_HEIGHT_PX * 3 + llmSettingsHeight(node) + MESSAGE_HEIGHT_PX
	}
	getPorts(): Record<string, ShapePort> {
		const baseY = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
		return {
			parent: {
				id: 'parent',
				x: 0,
				y: baseY + NODE_ROW_HEIGHT_PX * 0.5,
				terminal: 'end',
				dataType: 'text',
			},
			attach: {
				id: 'attach',
				x: 0,
				y: baseY + NODE_ROW_HEIGHT_PX * 1.5,
				terminal: 'end',
				dataType: 'any',
			},
			output: {
				id: 'output',
				x: NODE_WIDTH_PX,
				y: NODE_HEADER_HEIGHT_PX / 2,
				terminal: 'start',
				dataType: 'text',
			},
		}
	}
	async execute(shape: NodeShape, node: ChatNode, inputs: InputValues): Promise<ExecutionResult> {
		const text = await sendChat(this.editor, shape, node, inputs.attach as PipelineValue)
		return { output: text ?? STOP_EXECUTION }
	}
	getOutputInfo(shape: NodeShape, node: ChatNode): InfoValues {
		return {
			output: {
				value: node.assistantMessage || null,
				isOutOfDate: shape.props.isOutOfDate || !node.assistantMessage,
				dataType: 'text',
			},
		}
	}
	Component = ChatNodeComponent
}

function isImageValue(value: string) {
	return /^(data:image\/|\/api\/images\/|https?:\/\/.*\.(png|jpe?g|webp|gif)(\?|$))/i.test(value)
}

/** Walk "Reply to" links back to the root and build the message history. */
export function buildChatHistory(editor: Editor, shape: NodeShape): ChatMessage[] {
	const turns: ChatNode[] = []
	const seen = new Set<string>([shape.id])
	let current: NodeShape | undefined = shape
	while (current) {
		const parentLink: NodePortConnection | undefined = getNodePortConnections(editor, current).find(
			(c) => c.ownPortId === 'parent' && c.terminal === 'end'
		)
		if (!parentLink || seen.has(parentLink.connectedShapeId)) break
		seen.add(parentLink.connectedShapeId)
		const parent: NodeShape | undefined = editor.getShape<NodeShape>(parentLink.connectedShapeId)
		if (!parent || parent.type !== 'node') break
		if (parent.props.node.type === 'chat') turns.unshift(parent.props.node)
		else {
			// A non-chat node (e.g. a Prompt) feeds text in as an earlier user turn.
			const value = getNodeInputPortValues(editor, current.id).parent?.value
			if (typeof value === 'string' && value) {
				turns.unshift({ ...EMPTY_TURN, userMessage: value })
			}
			break
		}
		current = parent
	}
	const messages: ChatMessage[] = []
	for (const turn of turns) {
		if (turn.userMessage) messages.push({ role: 'user', content: turn.userMessage })
		if (turn.assistantMessage) messages.push({ role: 'assistant', content: turn.assistantMessage })
	}
	return messages
}

/** Send this node's message (with its history) and stream the reply into the node. */
export async function sendChat(
	editor: Editor,
	shape: NodeShape,
	node: ChatNode,
	attach: PipelineValue | undefined
): Promise<string | null> {
	const messages = buildChatHistory(editor, shape)
	const attachment = attach == null ? '' : String(attach)
	const userText = node.userMessage.trim() || (attachment && isImageValue(attachment) ? 'Describe this image.' : '')
	if (!userText && !attachment) {
		updateNode<ChatNode>(editor, shape, (n) => ({ ...n, error: 'Type a message first.' }), false)
		return null
	}
	if (attachment && isImageValue(attachment)) {
		messages.push({
			role: 'user',
			content: [
				{ type: 'image', image: attachment },
				{ type: 'text', text: userText },
			],
		})
	} else {
		const text = attachment ? `${attachment}\n\n${userText}` : userText
		messages.push({ role: 'user', content: text })
	}

	updateNode<ChatNode>(editor, shape, (n) => ({ ...n, assistantMessage: '', error: null }))
	try {
		const reply = await apiChatStream({ model: node.model || undefined, messages, ...llmRequestSettings(node) }, (text) => {
			const latest = editor.getShape<NodeShape>(shape.id)
			if (!latest) return
			updateNode<ChatNode>(editor, latest, (n) => ({ ...n, assistantMessage: text }))
		})
		const usage = reply.usage ? formatLlmUsage(reply.usage) : ''
		const latest = editor.getShape<NodeShape>(shape.id)
		if (latest) {
			updateNode<ChatNode>(editor, latest, (n) => ({
				...n,
				assistantMessage: reply.text,
				lastUsage: usage || undefined,
			}), false)
		}
		return reply.text
	} catch (e) {
		const latest = editor.getShape<NodeShape>(shape.id)
		if (latest) {
			updateNode<ChatNode>(editor, latest, (n) => ({ ...n, error: (e as Error).message }), false)
		}
		return null
	}
}

function ChatNodeComponent({ shape, node }: NodeComponentProps<ChatNode>) {
	const editor = useEditor()
	const inputs = useValue('chat inputs', () => getNodeInputPortValues(editor, shape.id), [
		editor,
		shape.id,
	])
	const parent = inputs.parent
	const attach = inputs.attach
	const busy = shape.props.isOutOfDate && !node.error && node.assistantMessage === ''

	const handleSend = useCallback(() => {
		const value = attach && !Array.isArray(attach.value) ? attach.value : null
		sendChat(editor, shape, node, value === STOP_EXECUTION ? null : (value as PipelineValue))
	}, [editor, shape, node, attach])

	return (
		<>
			<NodeRow>
				<Port shapeId={shape.id} portId="parent" />
				<NodePortLabel dataType="text">Reply to</NodePortLabel>
				{parent ? (
					<span className="NodeRow-connected-value">
						{parent.isOutOfDate ? <NodePlaceholder /> : 'conversation'}
					</span>
				) : (
					<span className="NodeRow-disconnected">new conversation</span>
				)}
			</NodeRow>
			<NodeRow>
				<Port shapeId={shape.id} portId="attach" />
				<NodePortLabel dataType="any">Attach</NodePortLabel>
				{attach ? (
					<span className="NodeRow-connected-value">
						{attach.isOutOfDate ? (
							<NodePlaceholder />
						) : isImageValue(String(attach.value ?? '')) ? (
							'image'
						) : (
							String(attach.value ?? '').slice(0, 24)
						)}
					</span>
				) : (
					<span className="NodeRow-disconnected">image or text (optional)</span>
				)}
			</NodeRow>
			<NodeRow>
				<span className="NodeInputRow-label">Model</span>
				<ModelSelect
					className="node-model-select"
					capability={attach ? 'vision' : 'chat'}
					value={node.model}
					onChange={(model) => updateNode<ChatNode>(editor, shape, (n) => ({ ...n, model }), false)}
				/>
			</NodeRow>
			<LlmSettingsPanel editor={editor} shape={shape} node={node} />
			<div className="ChatNode-compose" style={{ height: MESSAGE_HEIGHT_PX }}>
				<textarea
					className="ChatNode-input NodeScroll"
					placeholder="Message… (Ctrl+Enter to send)"
					value={node.userMessage}
					onPointerDown={editor.markEventAsHandled}
					onChange={(e) =>
						updateNode<ChatNode>(editor, shape, (n) => ({ ...n, userMessage: e.target.value }), false)
					}
					onKeyDown={(e) => {
						e.stopPropagation()
						if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend()
					}}
				/>
				<button
					className="ChatNode-send"
					title="Send (Ctrl+Enter)"
					disabled={busy}
					onPointerDown={editor.markEventAsHandled}
					onClick={handleSend}
				>
					{busy ? (
						<span>…</span>
					) : (
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
							<path d="M12 19V5M5 12l7-7 7 7" />
						</svg>
					)}
				</button>
			</div>
		</>
	)
}
