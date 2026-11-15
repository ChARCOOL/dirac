export type ArchitectureDiagramArguments =
	| { operation: "upsert_diagram"; name: string; diagram: string }
	| { operation: "display_diagram"; name: string; version?: number }
	| { operation: "fetch_diagram"; name: string; version?: number }
	| { operation: "display_comparison"; name: string; start_version: number; end_version: number }
	| { operation: "list_diagrams" }

const operationParameters = {
	upsert_diagram: ["name", "diagram"],
	display_diagram: ["name", "version"],
	display_comparison: ["name", "start_version", "end_version"],
	list_diagrams: [],
	fetch_diagram: ["name", "version"],
} as const

const parameterNames = new Set(["operation", "name", "diagram", "version", "start_version", "end_version"])

function requiredString(args: Record<string, unknown>, key: string): string {
	const value = args[key]
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${key}: a non-empty string is required for ${args.operation}.`)
	}
	return value
}

function requiredVersion(args: Record<string, unknown>, key: string): number {
	const value = args[key]
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${key}: a positive safe integer is required for ${args.operation}.`)
	}
	return value
}

/** Validate tool arguments only; graph and safe-name validation belong to the environment's storage boundary. */
export function validateArchitectureDiagramArguments(input: unknown): ArchitectureDiagramArguments {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("Arguments must be an object with a required operation.")
	}
	const args = input as Record<string, unknown>
	const operation = args.operation
	if (typeof operation !== "string" || !Object.hasOwn(operationParameters, operation)) {
		throw new Error(`operation: required; choose ${Object.keys(operationParameters).join(", ")}.`)
	}
	const allowed: readonly string[] = operationParameters[operation as keyof typeof operationParameters]
	for (const [key, value] of Object.entries(args)) {
		if (!parameterNames.has(key)) throw new Error(`${key}: unknown parameter for ${operation}.`)
		// Strict provider schemas send unused optional fields as null. Required fields are checked below.
		if (key !== "operation" && value !== null && value !== undefined && !allowed.includes(key)) {
			throw new Error(`${key}: incompatible with ${operation}; omit it or set it to null.`)
		}
	}
	if (operation === "list_diagrams") return { operation }
	const name = requiredString(args, "name")
	if (operation === "upsert_diagram") return { operation, name, diagram: requiredString(args, "diagram") }
	if (operation === "display_comparison") {
		return {
			operation,
			name,
			start_version: requiredVersion(args, "start_version"),
			end_version: requiredVersion(args, "end_version"),
		}
	}
	return {
		operation: operation as "display_diagram" | "fetch_diagram",
		name,
		...(args.version == null ? {} : { version: requiredVersion(args, "version") }),
	}
}
