import './aiCards.css'
import { TLShapeId, useValue } from 'tldraw'
import { ModelCapability } from '../../../../shared/aiConfig'
import { $aiConfig, ModelSelect, openProvidersDialog } from '../../../ai/aiConfig'
import { Port, ShapePort } from '../../ports/Port'
import { useFieldPortAnchor } from '../../ports/useFieldPortAnchor'
import { UiButton } from '../../../ui'
import { PortRow, useInputConnected } from './fields'
import { NodeRow } from './shared'

/** WP50: small pieces shared by the AI cards (Document Q&A, Classify, Speech to text, Text to speech). */

export const CAPABILITY_NAMES: Partial<Record<ModelCapability, string>> = {
	chat: 'chat',
	embed: 'embedding',
	stt: 'speech-to-text',
	tts: 'text-to-speech',
}

/** True when no model is chosen and no configured model has this capability. */
export function capabilityMissing(capability: ModelCapability, value: string | undefined | null): boolean {
	if (value) return false
	const config = $aiConfig.get()
	if (!config) return false
	return !config.models.some((m) => m.capabilities.includes(capability))
}

export function useCapabilityMissing(capability: ModelCapability, value: string | undefined | null) {
	return useValue('capability missing ' + capability, () => capabilityMissing(capability, value), [capability, value])
}

/** A `model` input port at `y` (a Model provider card can be wired in). */
export function modelPort(y: number): ShapePort {
	return { id: 'model', x: 0, y, terminal: 'end', dataType: 'model' }
}

/** The model row: a model picker, or the wired Model provider when the `model` port is wired. */
export function ModelPickRow({
	shapeId,
	capability,
	value,
	onChange,
	label = 'Model',
}: {
	shapeId: TLShapeId
	capability: ModelCapability
	value: string
	onChange(value: string): void
	label?: string
}) {
	const wired = useInputConnected(shapeId, 'model')
	const ref = useFieldPortAnchor<HTMLDivElement>(shapeId, 'model')
	if (wired) return <PortRow shapeId={shapeId} portId="model" label={label} dataType="model" />
	return (
		<NodeRow ref={ref}>
			<Port shapeId={shapeId} portId="model" />
			<span className="NodeInputRow-label">{label}</span>
			<ModelSelect className="node-model-select" capability={capability} value={value} onChange={onChange} />
		</NodeRow>
	)
}

/**
 * One status row: the "set up a model" message with a link to AI providers when the card's
 * capability has no model; otherwise `children` (the card's own status).
 */
export function AiStatusRow({
	capability,
	value,
	modelWired,
	children,
}: {
	capability: ModelCapability
	value: string
	modelWired?: boolean
	children?: React.ReactNode
}) {
	const missing = useCapabilityMissing(capability, value) && !modelWired
	if (missing) {
		return (
			<NodeRow className="AiCardSetup">
				<span className="NodeStatus is-error AiCardSetup-text">
					No {CAPABILITY_NAMES[capability] ?? capability} model is set up.
				</span>
				<UiButton size="sm" variant="low" label="AI providers…" onClick={() => openProvidersDialog()} />
			</NodeRow>
		)
	}
	return <NodeRow className="AiCardStatus">{children}</NodeRow>
}
