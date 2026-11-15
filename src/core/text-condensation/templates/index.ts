import { TextCondensationTemplateRegistry } from "../TextCondensationTemplateRegistry"
import { conversationContinuationTemplate } from "./conversationContinuationTemplate"

export { CONVERSATION_CONTINUATION_TEMPLATE_ID, conversationContinuationTemplate } from "./conversationContinuationTemplate"

export const defaultTextCondensationTemplates = [conversationContinuationTemplate]

export function createDefaultTextCondensationTemplateRegistry(): TextCondensationTemplateRegistry {
	return new TextCondensationTemplateRegistry(defaultTextCondensationTemplates)
}
