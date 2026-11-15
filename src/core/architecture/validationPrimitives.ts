import { z } from "zod"
import { ARCHITECTURE_LIMITS as limits } from "./limits"

export function rejectArchitectureValue(path: (string | number)[], message: string): never {
	throw new z.ZodError([{ code: z.ZodIssueCode.custom, path, message }])
}

const RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i
const UNSAFE_IDS = new Set(["__proto__", "prototype", "constructor"])

/** Safe single path segments, including on Windows. Never normalize an invalid identity. */
export const diagramNameSchema = z
	.string()
	.min(1)
	.max(limits.maxNameLength)
	.regex(/^[a-z0-9][a-z0-9_-]*$/, "Expected a single name containing only lowercase letters, digits, underscores or hyphens")
	.refine((name) => !RESERVED_SEGMENT.test(name) && !UNSAFE_IDS.has(name), "Reserved diagram name")

export const diagramVersionSchema = z.number().int().min(1).max(limits.maxVersion)

export const entityIdSchema = z
	.string()
	.min(1)
	.max(limits.maxIdLength)
	.regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.:-]*$/, "Expected an identifier, not a path or link")
	.refine((id) => !UNSAFE_IDS.has(id), "Reserved identifier")

export const resolvedIdentitySchema = z
	.object({
		taskId: z
			.string()
			.min(1)
			.max(limits.maxTaskIdLength)
			.regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "Expected a task identifier, not a path")
			.refine((id) => !RESERVED_SEGMENT.test(id) && !UNSAFE_IDS.has(id), "Reserved task identifier"),
		name: diagramNameSchema,
		version: diagramVersionSchema,
	})
	.strict()

export function nonblankString(maxLength: number): z.ZodString {
	return z.string().min(1).max(maxLength).regex(/\S/, "Must not be blank")
}

/** Check before JSON.parse: whitespace and UTF-8 expansion count against the file/wire limit. */
export function assertArchitectureJsonBytes(json: string, maxBytes: number): void {
	if (typeof json !== "string") {
		rejectArchitectureValue([], "Expected a JSON string")
	}
	if (json.length > maxBytes || Buffer.byteLength(json, "utf8") > maxBytes) {
		rejectArchitectureValue([], `JSON exceeds ${maxBytes} UTF-8 bytes`)
	}
}

/**
 * Bound unknown-value validation before Zod traverses arrays (its .max() alone does not stop traversal).
 * Count canonical JSON bytes incrementally, without serializing an unbounded object or invoking toJSON/getters.
 * Depth and visit budgets also reject deeply nested, cyclic and non-JSON values before schema parsing.
 */
export function assertBoundedArchitectureValue(value: unknown, maxBytes: number): void {
	let bytes = 0
	let visits = 0
	const ancestors = new Set<object>()

	function addBytes(count: number, path: (string | number)[]): void {
		bytes += count
		if (bytes > maxBytes) rejectArchitectureValue(path, `JSON exceeds ${maxBytes} UTF-8 bytes`)
	}

	function countString(text: string, path: (string | number)[]): void {
		if (text.length > limits.maxValidationStringLength) {
			rejectArchitectureValue(path, `String exceeds ${limits.maxValidationStringLength} characters`)
		}
		addBytes(Buffer.byteLength(JSON.stringify(text), "utf8"), path)
	}

	function visit(current: unknown, path: (string | number)[], depth: number): void {
		if (++visits > limits.maxValidationValues) rejectArchitectureValue(path, "Validation value limit exceeded")
		if (depth > limits.maxValidationDepth) rejectArchitectureValue(path, "JSON nesting limit exceeded")
		if (typeof current === "string") {
			countString(current, path)
			return
		}
		if (current === null) {
			addBytes(4, path)
			return
		}
		if (typeof current === "boolean") {
			addBytes(current ? 4 : 5, path)
			return
		}
		if (typeof current === "number" && Number.isFinite(current)) {
			addBytes(String(current).length, path)
			return
		}
		if (typeof current !== "object") rejectArchitectureValue(path, "Expected a finite JSON value")
		if (ancestors.has(current)) rejectArchitectureValue(path, "Cyclic JSON value")
		ancestors.add(current)

		const array = Array.isArray(current)
		if (!array && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) {
			rejectArchitectureValue(path, "Expected a plain JSON object")
		}
		if (array && current.length > limits.maxValidationCollectionEntries) {
			rejectArchitectureValue(path, `Collection exceeds ${limits.maxValidationCollectionEntries} entries`)
		}
		const keys = Object.keys(current)
		if (keys.length > limits.maxValidationCollectionEntries) {
			rejectArchitectureValue(path, `Collection exceeds ${limits.maxValidationCollectionEntries} entries`)
		}
		if (Object.getOwnPropertySymbols(current).length > 0) rejectArchitectureValue(path, "JSON keys must be strings")
		if (array && (keys.length !== current.length || keys.some((key, index) => key !== String(index)))) {
			rejectArchitectureValue(path, "Expected a dense JSON array without extra properties")
		}
		addBytes(2 + Math.max(0, keys.length - 1), path)
		for (const key of keys) {
			const childPath = [...path, array ? Number(key) : key]
			if (!array) {
				countString(key, childPath)
				addBytes(1, childPath)
			}
			const descriptor = Object.getOwnPropertyDescriptor(current, key)!
			if (!("value" in descriptor)) rejectArchitectureValue(childPath, "JSON properties cannot be accessors")
			visit(descriptor.value, childPath, depth + 1)
		}
		ancestors.delete(current)
	}

	visit(value, [], 0)
}
