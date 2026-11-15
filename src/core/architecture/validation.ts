import type { ArchitectureDiagram, ArchitectureSelection, ResolvedArchitectureIdentity } from "@shared/architecture"
import { z } from "zod"
import { ARCHITECTURE_LIMITS as limits } from "./limits"
import {
	assertArchitectureJsonBytes,
	assertBoundedArchitectureValue,
	diagramNameSchema,
	diagramVersionSchema,
	entityIdSchema,
	nonblankString,
	rejectArchitectureValue,
	resolvedIdentitySchema,
} from "./validationPrimitives"

/** Local relative paths only. A workspace hint selects a root, not a protocol or an absolute path. */
function isSafeCodePath(value: string): boolean {
	let path = value
	if (path.startsWith("@")) {
		const separator = path.indexOf(":")
		if (separator < 2 || separator - 1 > limits.maxWorkspaceHintLength) return false
		if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(path.slice(1, separator))) return false
		path = path.slice(separator + 1)
	}
	if (!path || path.startsWith("~") || /[\\:%?#<>"|*]/.test(path)) return false
	if ([...path].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return false
	return path.split("/").every((segment) => {
		if (!segment || segment === "." || segment === ".." || segment !== segment.trim() || segment.endsWith(".")) return false
		return !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(segment)
	})
}

const codeReferenceSchema = z
	.object({
		path: z
			.string()
			.min(1)
			.max(limits.maxCodePathLength)
			.refine(isSafeCodePath, "Expected a safe workspace-relative code path"),
		symbol: nonblankString(limits.maxCodeSymbolLength).optional(),
		line: z.number().int().min(1).max(limits.maxCodeLine).optional(),
	})
	.strict()
const changeSchema = z.enum(["added", "modified", "removed"])
const descriptions = {
	description: z.string().max(limits.maxDescriptionLength).optional(),
	rationale: z.string().max(limits.maxDescriptionLength).optional(),
	code: z.array(codeReferenceSchema).max(limits.maxCodeReferencesPerElement).optional(),
	change: changeSchema.optional(),
}
const nodeSchema = z
	.object({
		id: entityIdSchema,
		kind: z.enum(["component", "class", "function", "database", "service", "api_endpoint", "group", "state", "actor"]),
		label: nonblankString(limits.maxLabelLength),
		parentId: entityIdSchema.optional(),
		...descriptions,
	})
	.strict()
const edgeSchema = z
	.object({
		id: entityIdSchema,
		kind: z.enum(["dependency", "aggregation", "data_flow", "api_call", "transition", "message"]),
		source: entityIdSchema,
		target: entityIdSchema,
		label: z.string().max(limits.maxLabelLength).optional(),
		...descriptions,
	})
	.strict()
const diagramSchema = z
	.object({
		title: nonblankString(limits.maxTitleLength),
		summary: nonblankString(limits.maxSummaryLength),
		nodes: z.array(nodeSchema).max(limits.maxNodes),
		edges: z.array(edgeSchema).max(limits.maxEdges),
	})
	.strict()

/** Throws a location-bearing validation error; never renames unsafe input. */
export function assertDiagramName(name: unknown): asserts name is string {
	if (typeof name === "string" && name.length > limits.maxNameLength) {
		rejectArchitectureValue([], `Diagram name exceeds ${limits.maxNameLength} characters`)
	}
	diagramNameSchema.parse(name)
}

export function assertDiagramVersion(version: unknown): asserts version is number {
	diagramVersionSchema.parse(version)
}

/** Check raw size before parsing so malformed, deeply nested or oversized files remain board-local failures. */
export function parseArchitectureDiagram(json: string): ArchitectureDiagram {
	assertArchitectureJsonBytes(json, limits.maxDiagramBytes)
	let value: unknown
	try {
		value = JSON.parse(json)
	} catch (error) {
		throw new Error("Architecture diagram: malformed JSON", { cause: error })
	}
	return validateArchitectureDiagram(value)
}

/** Validates and returns a plain clone. Does not resolve code symbols or touch files. */
export function validateArchitectureDiagram(value: unknown): ArchitectureDiagram {
	assertBoundedArchitectureValue(value, limits.maxDiagramBytes)
	const diagram = diagramSchema.parse(value)
	validateGraphReferences(diagram)
	return diagram
}

function validateGraphReferences(diagram: ArchitectureDiagram): void {
	const nodes = new Map<string, (typeof diagram.nodes)[number]>()
	const edges = new Set<string>()
	let codeReferences = 0
	for (const [index, node] of diagram.nodes.entries()) {
		if (nodes.has(node.id)) rejectArchitectureValue(["nodes", index, "id"], `Duplicate node ID '${node.id}'`)
		nodes.set(node.id, node)
		codeReferences += node.code?.length ?? 0
	}
	for (const [index, edge] of diagram.edges.entries()) {
		if (edges.has(edge.id)) rejectArchitectureValue(["edges", index, "id"], `Duplicate edge ID '${edge.id}'`)
		edges.add(edge.id)
		if (!nodes.has(edge.source)) rejectArchitectureValue(["edges", index, "source"], `Unknown node '${edge.source}'`)
		if (!nodes.has(edge.target)) rejectArchitectureValue(["edges", index, "target"], `Unknown node '${edge.target}'`)
		if (edge.kind === "transition") {
			for (const endpoint of ["source", "target"] as const) {
				if (nodes.get(edge[endpoint])?.kind !== "state")
					rejectArchitectureValue(["edges", index, endpoint], "Transition endpoints must identify state nodes")
			}
		}
		codeReferences += edge.code?.length ?? 0
	}
	if (codeReferences > limits.maxCodeReferences) {
		rejectArchitectureValue([], `Diagram exceeds ${limits.maxCodeReferences} code references`)
	}
	for (const [index, node] of diagram.nodes.entries()) {
		if (node.parentId === undefined) continue
		if (node.parentId === node.id) rejectArchitectureValue(["nodes", index, "parentId"], "A node cannot parent itself")
		if (nodes.get(node.parentId)?.kind !== "group") {
			rejectArchitectureValue(["nodes", index, "parentId"], "Parent must identify an existing group node")
		}
	}
	validateContainmentCycles(diagram)
}

/** Parent chains are walked iteratively in O(nodes), independently of valid relationship cycles. */
function validateContainmentCycles(diagram: ArchitectureDiagram): void {
	const parents = new Map(diagram.nodes.map((node) => [node.id, node.parentId]))
	const complete = new Set<string>()
	for (const [index, node] of diagram.nodes.entries()) {
		const chain = new Set<string>()
		let id: string | undefined = node.id
		while (id !== undefined && !complete.has(id)) {
			if (chain.has(id)) rejectArchitectureValue(["nodes", index, "parentId"], `Containment cycle involving '${id}'`)
			chain.add(id)
			id = parents.get(id)
		}
		for (const visited of chain) complete.add(visited)
	}
}

const selectionBase = { taskId: resolvedIdentitySchema.shape.taskId, name: diagramNameSchema }
const selectionSchema = z.discriminatedUnion("mode", [
	z.object({ ...selectionBase, mode: z.literal("latest") }).strict(),
	z.object({ ...selectionBase, mode: z.literal("exact"), version: diagramVersionSchema }).strict(),
	z
		.object({
			...selectionBase,
			mode: z.literal("comparison"),
			startVersion: diagramVersionSchema,
			endVersion: diagramVersionSchema,
		})
		.strict(),
])

export function validateArchitectureSelection(value: unknown): ArchitectureSelection {
	assertBoundedArchitectureValue(value, limits.maxDiagramBytes)
	return selectionSchema.parse(value)
}

export function validateResolvedArchitectureIdentity(value: unknown): ResolvedArchitectureIdentity {
	assertBoundedArchitectureValue(value, limits.maxDiagramBytes)
	return resolvedIdentitySchema.parse(value)
}
