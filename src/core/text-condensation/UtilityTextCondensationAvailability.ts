import { getConfiguredUtilityModelSelection } from "@core/utility-model/UtilityModelSelection"
import { CONVERSATION_CONTINUATION_TEMPLATE_ID } from "./templates"
import type { TextCondensationTemplateId } from "./TextCondenser"
import type { TextCondensationTemplateRegistry } from "./TextCondensationTemplateRegistry"

export interface UtilityTextCondensationSettings {
	/** Used only while reading an unmigrated legacy configuration. */
	utilityModelEnabled?: unknown
	utilityModelUseCondense?: unknown
	utilityModelSelection: unknown
}

export { getConfiguredUtilityModelSelection } from "@core/utility-model/UtilityModelSelection"

export function isUtilityModelUseCaseEnabled(
	settings: UtilityTextCondensationSettings,
	template: TextCondensationTemplateId,
): boolean {
	const useCaseEnabled = template === CONVERSATION_CONTINUATION_TEMPLATE_ID ? settings.utilityModelUseCondense : false
	if (useCaseEnabled !== undefined) return useCaseEnabled === true

	// Configurations written before the migration contain only the legacy switch.
	return settings.utilityModelEnabled === true
}


export function isUtilityTextCondensationAvailable(
	settings: UtilityTextCondensationSettings,
	template: TextCondensationTemplateId,
	templates: TextCondensationTemplateRegistry,
): boolean {
	return (
		isUtilityModelUseCaseEnabled(settings, template) &&
		getConfiguredUtilityModelSelection(settings.utilityModelSelection) !== undefined &&
		templates.has(template)
	)
}
