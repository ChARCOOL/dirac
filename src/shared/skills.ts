import type { HostCapabilityRequirement } from "./host-capabilities"

/**
 * Skill metadata loaded at startup for discovery.
 * Only name and description are parsed from frontmatter initially.
 */
export const NATIVE_WEB_SEARCH_SKILL_NAME = "web-search"
export const ARCHITECTURE_BOARD_SKILL_NAME = "architecture-board"

export type SkillProviderCapability = "native_web_search"
export type SkillProviderCapabilities = Record<SkillProviderCapability, boolean>

export interface SkillMetadata extends HostCapabilityRequirement {
	name: string
	description: string
	path: string
	source: "builtin" | "global" | "project"
	interactiveOnly?: boolean
	/** Available only to foreground Task/Goal conversations, never private workers or utility models. */
	foregroundOnly?: boolean
	/** Provider runtime capability required before this skill may be advertised or activated. */
	requiredProviderCapability?: SkillProviderCapability
	/** Built-in-only dependencies injected while this skill is active. */
	toolDependencies?: readonly string[]
}

/**
 * Full skill content loaded on-demand when skill is activated.
 */
export interface SkillContent extends SkillMetadata {
	instructions: string
}

export function filterSkillsByProviderCapabilities(
	skills: SkillMetadata[],
	capabilities: SkillProviderCapabilities,
): SkillMetadata[] {
	return skills.filter((skill) => !skill.requiredProviderCapability || capabilities[skill.requiredProviderCapability])
}
