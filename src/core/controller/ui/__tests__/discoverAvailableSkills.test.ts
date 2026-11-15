/**
 * Unit tests for discoverAvailableSkills — FU-6.
 *
 * Guards the skills-toggles lookups: `getGlobalSettingsKey`/`getWorkspaceStateKey`
 * return `undefined` until a value is persisted, so the toggle map must default
 * to `{}` before indexing (matching the other call sites). Also covers the
 * `yoloModeToggled && skill.interactiveOnly` filter so the webview's
 * `availableSkills` matches the task loop / trait builder / context loader.
 * Stubs `getOrDiscoverSkills` so no real filesystem scan of the developer's
 * global skills directory occurs.
 */

import { setHostCapabilities } from "@hosts/host-capabilities"
import * as skillsModule from "@core/context/instructions/user-instructions/skills"
import type { SkillProviderCapabilities } from "@shared/skills"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { discoverAvailableSkills } from "../discoverAvailableSkills"

const PROVIDER_CAPABILITIES: SkillProviderCapabilities = { native_web_search: true }

function makeProjectSkill(path = "/skills/project/SKILL.md") {
	return { name: "project-skill", description: "A project skill", path, source: "project" }
}

function makeGlobalSkill(path = "/skills/global/SKILL.md") {
	return { name: "global-skill", description: "A global skill", path, source: "global" }
}

function makeStateManager(opts: { globalSkillsToggles?: unknown; localSkillsToggles?: unknown; yoloModeToggled?: boolean }) {
	return {
		getGlobalSettingsKey: sinon.stub().callsFake((key: string) => {
			if (key === "globalSkillsToggles") return opts.globalSkillsToggles
			if (key === "yoloModeToggled") return opts.yoloModeToggled
			return undefined
		}),
		getWorkspaceStateKey: sinon
			.stub()
			.callsFake((key: string) => (key === "localSkillsToggles" ? opts.localSkillsToggles : undefined)),
	}
}

describe("discoverAvailableSkills (FU-6)", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		setHostCapabilities(undefined)
		sandbox.restore()
	})

	it("omits viewer-only skills from headless slash-menu discovery, even with cached metadata", async () => {
		setHostCapabilities({})
		sandbox.stub(skillsModule, "getOrDiscoverSkills").resolves(skillsModule.BUILTIN_SKILLS)
		const result = await discoverAvailableSkills(makeStateManager({}) as any, "/workspace", {}, PROVIDER_CAPABILITIES)
		expect(result.some((skill) => skill.name === "architecture-board")).to.equal(false)
	})

	it("hermetic: stubs getOrDiscoverSkills so no filesystem scan runs", async () => {
		const discoverStub = sandbox.stub(skillsModule, "getOrDiscoverSkills").resolves([] as any)
		const stateManager = makeStateManager({ globalSkillsToggles: undefined, localSkillsToggles: undefined }) as any

		const result = await discoverAvailableSkills(stateManager, "/workspace", {}, PROVIDER_CAPABILITIES)

		expect(result).to.deep.equal([])
		sinon.assert.calledOnceWithExactly(discoverStub, "/workspace", {})
	})

	it("enables a project skill when localSkillsToggles is undefined (no throw)", async () => {
		const projectSkill = makeProjectSkill()
		sandbox.stub(skillsModule, "getOrDiscoverSkills").resolves([projectSkill] as any)
		const stateManager = makeStateManager({ globalSkillsToggles: undefined, localSkillsToggles: undefined }) as any

		const result = await discoverAvailableSkills(stateManager, "/workspace", {}, PROVIDER_CAPABILITIES)

		expect(result.map((skill: any) => skill.name)).to.deep.equal(["project-skill"])
	})

	it("enables a global skill when globalSkillsToggles is undefined (no throw)", async () => {
		const globalSkill = makeGlobalSkill()
		sandbox.stub(skillsModule, "getOrDiscoverSkills").resolves([globalSkill] as any)
		const stateManager = makeStateManager({ globalSkillsToggles: undefined, localSkillsToggles: undefined }) as any

		const result = await discoverAvailableSkills(stateManager, "/workspace", {}, PROVIDER_CAPABILITIES)

		expect(result.map((skill: any) => skill.name)).to.deep.equal(["global-skill"])
	})

	it("disables a project skill when localSkillsToggles maps it to false", async () => {
		const projectSkill = makeProjectSkill("/skills/project/SKILL.md")
		sandbox.stub(skillsModule, "getOrDiscoverSkills").resolves([projectSkill] as any)
		const stateManager = makeStateManager({
			globalSkillsToggles: undefined,
			localSkillsToggles: { "/skills/project/SKILL.md": false },
		}) as any

		const result = await discoverAvailableSkills(stateManager, "/workspace", {}, PROVIDER_CAPABILITIES)

		expect(result).to.deep.equal([])
	})

	it("always keeps builtin skills regardless of toggles", async () => {
		const builtinSkill = {
			name: "web-search",
			description: "Search",
			path: "<builtin>/web-search/SKILL.md",
			source: "builtin",
		}
		sandbox.stub(skillsModule, "getOrDiscoverSkills").resolves([builtinSkill] as any)
		const stateManager = makeStateManager({ globalSkillsToggles: undefined, localSkillsToggles: undefined }) as any

		const result = await discoverAvailableSkills(stateManager, "/workspace", {}, PROVIDER_CAPABILITIES)

		expect(result.map((skill: any) => skill.name)).to.deep.equal(["web-search"])
	})

	it("drops interactiveOnly skills when yoloModeToggled is true (matches task loop)", async () => {
		const interactiveSkill = { ...makeProjectSkill(), interactiveOnly: true }
		const normalSkill = makeGlobalSkill()
		sandbox.stub(skillsModule, "getOrDiscoverSkills").resolves([interactiveSkill, normalSkill] as any)
		const stateManager = makeStateManager({ yoloModeToggled: true }) as any

		const result = await discoverAvailableSkills(stateManager, "/workspace", {}, PROVIDER_CAPABILITIES)

		expect(result.map((skill: any) => skill.name)).to.deep.equal(["global-skill"])
	})

	it("keeps interactiveOnly skills when yoloModeToggled is false", async () => {
		const interactiveSkill = { ...makeProjectSkill(), interactiveOnly: true }
		sandbox.stub(skillsModule, "getOrDiscoverSkills").resolves([interactiveSkill] as any)
		const stateManager = makeStateManager({ yoloModeToggled: false }) as any

		const result = await discoverAvailableSkills(stateManager, "/workspace", {}, PROVIDER_CAPABILITIES)

		expect(result.map((skill: any) => skill.name)).to.deep.equal(["project-skill"])
	})
})
