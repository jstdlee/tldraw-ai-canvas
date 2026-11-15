import { cardCatalogText } from '../../shared/nodeSpecs'
import { CardCatalogPart } from '../../shared/schema/PromptPartDefinitions'
import { loadAllowedTypes } from '../pipeline/aiBuild'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

/** WP48: the card catalog in brief, so the one agent knows which cards build-workflow can add. */
export const CardCatalogPartUtil = registerPromptPartUtil(
	class CardCatalogPartUtil extends PromptPartUtil<CardCatalogPart> {
		static override type = 'cardCatalog' as const

		override getPart(): CardCatalogPart {
			return { type: 'cardCatalog', catalog: cardCatalogText(loadAllowedTypes()) }
		}
	}
)
