import { meetsHostCapabilityRequirement } from "@hosts/host-capabilities"
import { getOrDiscoverSkills } from "@core/context/instructions/user-instructions/skills"
import type { StateManager } from "@core/storage/StateManager"
import { filterSkillsByProviderCapabilities, type SkillProviderCapabilities } from "@shared/skills"

export async function discoverAvailableSkills(
	stateManager: StateManager,
	cwd: string,
	taskState: any,
	providerCapabilities: SkillProviderCapabilities,
) {
	const globalSkillsToggles = stateManager.getGlobalSettingsKey("globalSkillsToggles") ?? {}
	const localSkillsToggles = stateManager.getWorkspaceStateKey("localSkillsToggles") ?? {}
	const yoloModeToggled = !!stateManager.getGlobalSettingsKey("yoloModeToggled")
	const discoveredSkills = await getOrDiscoverSkills(cwd, taskState || {})
	const providerSkills = filterSkillsByProviderCapabilities(discoveredSkills, providerCapabilities)
	return providerSkills.filter(meetsHostCapabilityRequirement).filter((skill) => {
		if (yoloModeToggled && skill.interactiveOnly) return false
		if (skill.source === "builtin") return true
		const toggles = skill.source === "global" ? globalSkillsToggles : localSkillsToggles
		return toggles[skill.path] !== false
	})
}
