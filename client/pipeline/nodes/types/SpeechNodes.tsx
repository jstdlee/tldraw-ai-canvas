import { useEffect, useRef, useState } from 'react'
import { T, useEditor } from 'tldraw'
import { isAbortError } from '../../../../shared/abort'
import { categoryOf } from '../../../../shared/nodeGroups'
import { toCsv } from '../../../../shared/tableText'
import { apiSpeech, apiTranscribe, apiVoices } from '../../api/aiCardsApi'
import { getNodeRowHeightPx, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX } from '../../constants'
import { currentRunSignal } from '../../execution/executionState'
import { storeFile } from '../../fileStore'
import { ShapePort } from '../../ports/Port'
import { isInputWired } from '../nodePorts'
import { NodeShape } from '../NodeShapeUtil'
import { IconMic, IconSpeaker, IconStop, UiIconButton, UiTextArea, UiTextInput } from '../../../ui'
import { AiStatusRow, capabilityMissing, ModelPickRow, modelPort } from './aiCardParts'
import { NodeSelect, NodeTextResult, OutputPortRow, PortRow, stopEvent, useInputConnected, WireField } from './fields'
import {
	areAnyInputsOutOfDate,
	ExecutionResult,
	getInputText,
	InfoValues,
	InputValues,
	NodeComponentProps,
	NodeDefinition,
	NodeRow,
	updateNode,
} from './shared'

/** First line of an audio value: Read from's binary output is "/api/files/x\n(binary file …)". */
export function audioSource(value: string): string {
	return (value ?? '').trim().split(/\r?\n/)[0].trim()
}

/** Whether an audio element can play this value directly. */
function isPlayable(src: string) {
	return /^(data:(audio|video)\/|\/api\/files\/|https?:\/\/)/.test(src)
}

const PLAYER_PX = 52

function AudioPlayer({ src, empty }: { src: string; empty: string }) {
	return (
		<div className="AiAudioPlayer" style={{ height: PLAYER_PX }} onPointerDown={stopEvent}>
			{src && isPlayable(src) ? (
				<audio className="AiAudioPlayer-audio" controls preload="metadata" src={src} />
			) : (
				<span className="AiAudioPlayer-empty">{empty}</span>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Speech to text
// ---------------------------------------------------------------------------

/**
 * WP50 Speech to text: audio (a file from Load file / Read from, a recording made with the
 * microphone button, a data URL or a URL) → text, plus a `segments` table (start, end, text)
 * when the model returns timestamps. Calls `/v1/audio/transcriptions` through the server.
 */
export type SpeechToTextNode = T.TypeOf<typeof SpeechToTextNode>
export const SpeechToTextNode = T.object({
	type: T.literal('speech_to_text'),
	/** The recording or a typed file path / URL, used when the audio port is not wired. */
	audio: T.string,
	/** '' = detect the language; else a code such as en, de, zh. */
	language: T.string,
	model: T.string,
	lastText: T.string.nullable(),
	lastSegments: T.string.nullable(),
	lastInfo: T.string.optional(),
	error: T.string.nullable(),
})

const STT_RESULT_PX = 110

export class SpeechToTextNodeDefinition extends NodeDefinition<SpeechToTextNode> {
	static type = 'speech_to_text'
	static validator = SpeechToTextNode
	title = 'Speech to text'
	heading = 'Speech to text'
	icon = <IconMic />
	category = categoryOf('speech_to_text')
	override defaultWidthPx = 380
	override showsOutput = true
	resultKeys = ['lastText', 'lastSegments', 'lastInfo', 'error'] as const
	getDefault(): SpeechToTextNode {
		return {
			type: 'speech_to_text',
			audio: '',
			language: '',
			model: '',
			lastText: null,
			lastSegments: null,
			lastInfo: '',
			error: null,
		}
	}
	private ownAudioPx(shape: NodeShape, rowPx: number) {
		// The record / file row and the player, only while the audio port is not wired.
		return isInputWired(this.editor, shape.id, 'audio') ? 0 : rowPx + PLAYER_PX
	}
	getBodyHeightPx(shape: NodeShape, _node: SpeechToTextNode) {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		// audio, language, model, status, text out, segments out.
		return rowPx * 6 + this.ownAudioPx(shape, rowPx) + STT_RESULT_PX
	}
	getPorts(shape: NodeShape, node: SpeechToTextNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const base = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
		const modelY = base + rowPx * 2 + this.ownAudioPx(shape, rowPx)
		const outY = modelY + rowPx * 2 + STT_RESULT_PX
		const width = this.getWidthPx(shape, node)
		return {
			audio: { id: 'audio', x: 0, y: base + rowPx * 0.5, terminal: 'end', dataType: 'any' },
			model: modelPort(modelY + rowPx * 0.5),
			text: { id: 'text', x: width, y: outY + rowPx * 0.5, terminal: 'start', dataType: 'text' },
			segments: { id: 'segments', x: width, y: outY + rowPx * 1.5, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: SpeechToTextNode, inputs: InputValues): Promise<ExecutionResult> {
		const signal = currentRunSignal(this.editor)
		try {
			const raw = isInputWired(this.editor, shape.id, 'audio') ? getInputText(inputs, 'audio') : node.audio
			const audio = audioSource(raw)
			if (!audio) throw new Error('No audio. Record with the microphone button, or wire a file from Load file / Read from.')
			const model = getInputText(inputs, 'model').trim() || node.model || undefined
			const result = await apiTranscribe(audio, model, node.language.trim(), signal)
			const segments = result.segments?.length
				? toCsv(
						['start', 'end', 'text'],
						result.segments.map((s) => [s.start, s.end, s.text])
					)
				: ''
			const info = [result.language ? `Language: ${result.language}` : '', segments ? `${result.segments!.length} segments` : '']
				.filter(Boolean)
				.join(' · ')
			updateNode<SpeechToTextNode>(
				this.editor,
				shape,
				(n) => ({ ...n, lastText: result.text, lastSegments: segments || null, lastInfo: info, error: null }),
				false
			)
			return { text: result.text, segments }
		} catch (e) {
			if (!isAbortError(e)) updateNode<SpeechToTextNode>(this.editor, shape, (n) => ({ ...n, error: (e as Error).message }), false)
			throw e
		}
	}
	getOutputInfo(shape: NodeShape, node: SpeechToTextNode, inputs: InfoValues): InfoValues {
		const isOutOfDate = areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate
		return {
			text: { value: node.lastText, isOutOfDate, dataType: 'text' },
			segments: { value: node.lastSegments, isOutOfDate, dataType: 'text' },
		}
	}
	Component = SpeechToTextNodeComponent
}

/** Records from the microphone with MediaRecorder and stores the clip in the file store. */
function useRecorder(onDone: (url: string) => void, onError: (message: string) => void) {
	const [recording, setRecording] = useState(false)
	const [seconds, setSeconds] = useState(0)
	const recorderRef = useRef<MediaRecorder | null>(null)
	const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
	useEffect(
		() => () => {
			clearInterval(timerRef.current)
			const recorder = recorderRef.current
			if (recorder && recorder.state !== 'inactive') recorder.stop()
		},
		[]
	)
	const start = async () => {
		if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
			onError('This browser cannot record audio.')
			return
		}
		let stream: MediaStream
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true })
		} catch (e) {
			onError(`Microphone not available: ${(e as Error).message}`)
			return
		}
		const recorder = new MediaRecorder(stream)
		const parts: Blob[] = []
		recorder.ondataavailable = (event) => {
			if (event.data.size) parts.push(event.data)
		}
		recorder.onstop = async () => {
			stream.getTracks().forEach((t) => t.stop())
			clearInterval(timerRef.current)
			setRecording(false)
			const type = recorder.mimeType || 'audio/webm'
			const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm'
			try {
				const stored = await storeFile(new File(parts, `recording-${Date.now()}.${ext}`, { type }))
				onDone(stored.url)
			} catch (e) {
				onError(`Saving the recording failed: ${(e as Error).message}`)
			}
		}
		recorderRef.current = recorder
		recorder.start()
		setSeconds(0)
		setRecording(true)
		timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
	}
	const stop = () => recorderRef.current?.stop()
	return { recording, seconds, start, stop }
}

function SpeechToTextNodeComponent({ shape, node }: NodeComponentProps<SpeechToTextNode>) {
	const editor = useEditor()
	const audioWired = useInputConnected(shape.id, 'audio')
	const modelWired = useInputConnected(shape.id, 'model')
	const set = (patch: Partial<SpeechToTextNode>, outOfDate = true) =>
		updateNode<SpeechToTextNode>(editor, shape, (n) => ({ ...n, ...patch }), outOfDate)
	const recorder = useRecorder(
		(audio) => set({ audio, error: null }),
		(error) => set({ error }, false)
	)
	const src = audioSource(node.audio)
	return (
		<>
			<PortRow shapeId={shape.id} portId="audio" label="Audio" dataType="any" hint="record, or wire a file" />
			{!audioWired && (
				<>
					<NodeRow>
						<UiIconButton
							icon={recorder.recording ? <IconStop /> : <IconMic />}
							title={recorder.recording ? 'Stop recording' : 'Record from the microphone'}
							active={recorder.recording}
							onClick={() => (recorder.recording ? recorder.stop() : void recorder.start())}
						/>
						{recorder.recording ? (
							<span className="NodeStatus AiRecording">
								Recording {Math.floor(recorder.seconds / 60)}:{String(recorder.seconds % 60).padStart(2, '0')}
							</span>
						) : (
							<UiTextInput
								placeholder="or a file path / URL"
								value={node.audio}
								onChange={(audio) => set({ audio })}
							/>
						)}
					</NodeRow>
					<AudioPlayer src={src} empty="No audio yet" />
				</>
			)}
			<WireField shapeId={shape.id} fieldKey="language" label="Language" hint="blank = auto">
				<UiTextInput placeholder="auto, or en, de, zh…" value={node.language} onChange={(language) => set({ language })} />
			</WireField>
			<ModelPickRow shapeId={shape.id} capability="stt" value={node.model} onChange={(model) => set({ model }, false)} />
			<AiStatusRow capability="stt" value={node.model} modelWired={modelWired}>
				<span className="NodeStatus AiCardStatus-text">{node.lastInfo || 'Segments with timestamps when the model gives them'}</span>
			</AiStatusRow>
			<NodeTextResult text={node.lastText} error={node.error} empty="The transcript appears here" height={STT_RESULT_PX} />
			<OutputPortRow shapeId={shape.id} portId="text" label="Text" dataType="text" />
			<OutputPortRow shapeId={shape.id} portId="segments" label="Segments (table)" dataType="text" />
		</>
	)
}

// ---------------------------------------------------------------------------
// Text to speech
// ---------------------------------------------------------------------------

/**
 * WP50 Text to speech: text → an audio file (mp3 or wav) via `/v1/audio/speech`. The server
 * saves the file in the data dir's file store; the output is its `/api/files/…` path, and the
 * card plays it.
 */
export type TextToSpeechNode = T.TypeOf<typeof TextToSpeechNode>
export const TextToSpeechNode = T.object({
	type: T.literal('text_to_speech'),
	text: T.string,
	voice: T.string,
	/** 'mp3' | 'wav' */
	format: T.string,
	model: T.string,
	lastAudio: T.string.nullable(),
	lastInfo: T.string.optional(),
	error: T.string.nullable(),
})

const TTS_TEXT_PX = 88

export class TextToSpeechNodeDefinition extends NodeDefinition<TextToSpeechNode> {
	static type = 'text_to_speech'
	static validator = TextToSpeechNode
	title = 'Text to speech'
	heading = 'Text to speech'
	icon = <IconSpeaker />
	category = categoryOf('text_to_speech')
	override defaultWidthPx = 380
	override showsOutput = true
	resultKeys = ['lastAudio', 'lastInfo', 'error'] as const
	getDefault(): TextToSpeechNode {
		return {
			type: 'text_to_speech',
			text: '',
			voice: '',
			format: 'mp3',
			model: '',
			lastAudio: null,
			lastInfo: '',
			error: null,
		}
	}
	private textPx(shape: NodeShape) {
		return isInputWired(this.editor, shape.id, 'text') ? 0 : TTS_TEXT_PX
	}
	getBodyHeightPx(shape: NodeShape, _node: TextToSpeechNode) {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		// text, voice, format, model, status, player.
		return rowPx * 5 + this.textPx(shape) + PLAYER_PX
	}
	getPorts(shape: NodeShape, node: TextToSpeechNode): Record<string, ShapePort> {
		const rowPx = getNodeRowHeightPx(shape.props.fontSize)
		const base = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
		return {
			text: { id: 'text', x: 0, y: base + rowPx * 0.5, terminal: 'end', dataType: 'text' },
			model: modelPort(base + rowPx * 3.5 + this.textPx(shape)),
			output: { id: 'output', x: this.getWidthPx(shape, node), y: NODE_HEADER_HEIGHT_PX / 2, terminal: 'start', dataType: 'text' },
		}
	}
	async execute(shape: NodeShape, node: TextToSpeechNode, inputs: InputValues): Promise<ExecutionResult> {
		const signal = currentRunSignal(this.editor)
		try {
			const text = (isInputWired(this.editor, shape.id, 'text') ? getInputText(inputs, 'text') : node.text).trim()
			if (!text) throw new Error('No text to speak. Type it, or wire text into Text.')
			const model = getInputText(inputs, 'model').trim() || node.model || undefined
			const format = node.format === 'wav' ? 'wav' : 'mp3'
			const result = await apiSpeech({ text, voice: node.voice, format, model }, signal)
			const info = `${result.name} · ${Math.max(1, Math.round(result.size / 1024))} KB`
			updateNode<TextToSpeechNode>(this.editor, shape, (n) => ({ ...n, lastAudio: result.url, lastInfo: info, error: null }), false)
			return { output: result.url }
		} catch (e) {
			if (!isAbortError(e)) updateNode<TextToSpeechNode>(this.editor, shape, (n) => ({ ...n, error: (e as Error).message }), false)
			throw e
		}
	}
	getOutputInfo(shape: NodeShape, node: TextToSpeechNode, inputs: InfoValues): InfoValues {
		return {
			output: { value: node.lastAudio, isOutOfDate: areAnyInputsOutOfDate(inputs) || shape.props.isOutOfDate, dataType: 'text' },
		}
	}
	Component = TextToSpeechNodeComponent
}

function TextToSpeechNodeComponent({ shape, node }: NodeComponentProps<TextToSpeechNode>) {
	const editor = useEditor()
	const textWired = useInputConnected(shape.id, 'text')
	const modelWired = useInputConnected(shape.id, 'model')
	const [voices, setVoices] = useState<string[]>([])
	const set = (patch: Partial<TextToSpeechNode>, outOfDate = true) =>
		updateNode<TextToSpeechNode>(editor, shape, (n) => ({ ...n, ...patch }), outOfDate)
	useEffect(() => {
		let live = true
		if (modelWired || capabilityMissing('tts', node.model)) {
			setVoices([])
			return
		}
		apiVoices(node.model || undefined)
			.then((list) => live && setVoices(list))
			.catch(() => live && setVoices([]))
		return () => {
			live = false
		}
	}, [node.model, modelWired])
	return (
		<>
			<PortRow shapeId={shape.id} portId="text" label="Text" dataType="text" />
			{!textWired && (
				<div className="NodeField-block" style={{ height: TTS_TEXT_PX }}>
					<UiTextArea
						className="NodeField-textarea"
						grow
						placeholder="Text to speak"
						value={node.text}
						onChange={(text) => set({ text })}
					/>
				</div>
			)}
			<WireField shapeId={shape.id} fieldKey="voice" label="Voice">
				<div className="AiVoiceField">
					<UiTextInput placeholder={voices[0] ?? 'model default'} value={node.voice} onChange={(voice) => set({ voice })} />
					{voices.length > 0 && (
						<NodeSelect
							className="AiVoiceField-pick"
							title="Voices this model offers"
							value=""
							onPointerDown={stopEvent}
							onChange={(e) => e.target.value && set({ voice: e.target.value })}
						>
							<option value="">Voices…</option>
							{voices.map((v) => (
								<option key={v} value={v}>
									{v}
								</option>
							))}
						</NodeSelect>
					)}
				</div>
			</WireField>
			<WireField shapeId={shape.id} fieldKey="format" label="Format">
				<NodeSelect className="NodeField-select" value={node.format} onPointerDown={stopEvent} onChange={(e) => set({ format: e.target.value })}>
					<option value="mp3">mp3</option>
					<option value="wav">wav</option>
				</NodeSelect>
			</WireField>
			<ModelPickRow shapeId={shape.id} capability="tts" value={node.model} onChange={(model) => set({ model }, false)} />
			<AiStatusRow capability="tts" value={node.model} modelWired={modelWired}>
				<span className={'NodeStatus AiCardStatus-text' + (node.error ? ' is-error' : '')} title={node.error ?? undefined}>
					{node.error || node.lastInfo || 'Saved in the data folder; the output is its file path'}
				</span>
			</AiStatusRow>
			<AudioPlayer src={node.lastAudio ?? ''} empty="Run to make speech" />
		</>
	)
}
