import type { ArchitectureSelection } from "./identity"

/** Validate compact persisted/wire references without loading storage or a renderer. */
export function parseArchitectureSelection(input: unknown): ArchitectureSelection {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid architecture selection")
	const value = input as Record<string, unknown>
	const { taskId, name, mode } = value
	if (typeof taskId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(taskId))
		throw new Error("Invalid architecture task identity")
	if (typeof name !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) throw new Error("Invalid architecture diagram name")
	const allowed = ["taskId", "name", "mode"]
	const version = (key: string): number => {
		const number = value[key]
		if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1 || number > 2_147_483_647)
			throw new Error(`Invalid architecture ${key}`)
		return number
	}
	let result: ArchitectureSelection
	if (mode === "latest") result = { taskId, name, mode }
	else if (mode === "exact") {
		allowed.push("version")
		result = { taskId, name, mode, version: version("version") }
	} else if (mode === "comparison") {
		allowed.push("startVersion", "endVersion")
		result = { taskId, name, mode, startVersion: version("startVersion"), endVersion: version("endVersion") }
	} else throw new Error("Invalid architecture selection mode")
	for (const key of Object.keys(value)) {
		if (value[key] !== undefined && !allowed.includes(key)) throw new Error(`Unexpected architecture selection field: ${key}`)
	}
	return result
}
