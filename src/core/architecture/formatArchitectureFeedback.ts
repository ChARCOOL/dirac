import type { ArchitectureDiagram, CodeReference, ResolvedArchitectureIdentity, ReviewComment } from "@shared/architecture"
import { ARCHITECTURE_LIMITS as limits } from "./limits"
import { validateReviewState } from "./reviewValidation"
import { validateArchitectureDiagram } from "./validation"
import { resolvedIdentitySchema } from "./validationPrimitives"

export interface ArchitectureFeedbackScope {
	identity: ResolvedArchitectureIdentity
	diagram: ArchitectureDiagram
	comments: ReviewComment[]
}

/** Formats an explicit pending-comment snapshot only. No storage reads, delivery or command/mention parsing. */
export function formatArchitectureFeedback(scopes: ArchitectureFeedbackScope[]): string {
	if (!scopes.length || scopes.length > 2) throw new Error("Feedback requires one or two displayed versions")
	const versions = new Set<number>()
	const owner = resolvedIdentitySchema.parse(scopes[0].identity)
	const blocks: string[] = []
	let bytes = 0
	let count = 0
	for (const scope of scopes) {
		const identity = resolvedIdentitySchema.parse(scope.identity)
		if (identity.taskId !== owner.taskId || identity.name !== owner.name || versions.has(identity.version))
			throw new Error("Feedback must belong to distinct displayed versions of one owning diagram")
		versions.add(identity.version)
		count += scope.comments.length
		if (count > limits.maxFeedbackComments) throw new Error(`Feedback exceeds ${limits.maxFeedbackComments} comments`)
		const diagram = validateArchitectureDiagram(scope.diagram)
		const { comments } = validateReviewState({ comments: scope.comments }, diagram)
		for (const comment of comments) {
			if (comment.sent) throw new Error("Feedback must include pending comments only")
			const context = targetContext(diagram, comment)
			const block = `Architecture feedback: ${identity.name}, version ${identity.version}\n${context}\nComment: ${comment.text}`
			bytes += Buffer.byteLength(block, "utf8") + (blocks.length ? 2 : 0)
			if (bytes > limits.maxFeedbackBytes) throw new Error(`Feedback exceeds ${limits.maxFeedbackBytes} UTF-8 bytes`)
			blocks.push(block)
		}
	}
	if (!count) throw new Error("No pending comments to format")
	return blocks.join("\n\n")
}

function targetContext(diagram: ArchitectureDiagram, comment: ReviewComment): string {
	const target = comment.target
	if (target.kind === "diagram") return `Diagram: ${diagram.title}`
	if (target.kind === "node") {
		const node = diagram.nodes.find((node) => node.id === target.id)!
		return [
			`Node: ${node.id} (${node.label})`,
			`Kind: ${node.kind}`,
			node.description && `Responsibility: ${node.description}`,
			codeContext(node.code),
		]
			.filter(Boolean)
			.join("\n")
	}
	const edge = diagram.edges.find((edge) => edge.id === target.id)!
	const source = diagram.nodes.find((node) => node.id === edge.source)!
	const destination = diagram.nodes.find((node) => node.id === edge.target)!
	return [
		`Edge: ${edge.id} (${edge.kind})`,
		`From: ${source.id} (${source.label})`,
		`To: ${destination.id} (${destination.label})`,
		edge.label && `Label: ${edge.label}`,
		edge.description && `Responsibility: ${edge.description}`,
		codeContext(edge.code),
	]
		.filter(Boolean)
		.join("\n")
}

function codeContext(code?: CodeReference[]): string | undefined {
	return code?.length
		? `Related code: ${code.map((reference) => `${reference.path}${reference.symbol ? ` (${reference.symbol})` : ""}${reference.line ? `:${reference.line}` : ""}`).join(", ")}`
		: undefined
}
