import { render, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ArchitectureDiagram, NodeKind, ResolvedArchitectureIdentity } from "@shared/architecture"
import { CommentReviews } from "./CommentReviews"
import { Inspector } from "./Inspector"
import { NODE_KIND_LABELS } from "./nodeShapes"

const identity: ResolvedArchitectureIdentity = { taskId: "owner", name: "types", version: 1 }
const diagramFor = (kind: NodeKind): ArchitectureDiagram => ({
	title: "Concrete types",
	summary: "The represented entity determines its kind, not its name or incidental references.",
	nodes: [
		{
			id: "entity",
			kind,
			label: "StorageService",
			description: "A role can represent a declaration, deployed service, data store or composite unit.",
			code: [{ path: "src/core/architecture/ArchitectureStorage.ts", symbol: "ArchitectureStorage" }],
		},
	],
	edges: [{ id: "calls", kind: "api_call", source: "entity", target: "entity", label: "Refresh" }],
})

function inspector(kind: NodeKind, version = 1) {
	const versionIdentity = { ...identity, version }
	return (
		<Inspector
			diagram={diagramFor(kind)}
			identity={versionIdentity}
			target={{ kind: "node", id: "entity" }}
			select={vi.fn()}
			reviews={new CommentReviews()}
			review={{ identity: versionIdentity, comments: [], drafts: [] }}
		/>
	)
}

describe("Inspector node types", () => {
	it.each(
		Object.keys(NODE_KIND_LABELS) as NodeKind[],
	)("shows the saved %s type rather than calling every entity a component", (kind) => {
		const view = render(inspector(kind))
		expect(view.container.querySelector(".inspector-eyebrow")).toHaveTextContent(NODE_KIND_LABELS[kind])
		expect(
			within(view.getByLabelText("Inspect element")).getByRole("option", {
				name: `${NODE_KIND_LABELS[kind]}: StorageService`,
			}),
		).toBeInTheDocument()
		expect(view.getByRole("group", { name: "Elements" })).toBeInTheDocument()
		expect(view.container.querySelector(".element-identity code")).toHaveTextContent("entity")
	})

	it("renders a corrected kind on a new version without inferring from a name or related class", () => {
		const view = render(inspector("component"))
		expect(view.container.querySelector(".inspector-eyebrow")).toHaveTextContent("Component")
		view.rerender(inspector("class", 2))
		expect(view.container.querySelector(".inspector-eyebrow")).toHaveTextContent("Class")
		expect(view.getByRole("heading", { name: "StorageService" })).toBeInTheDocument()
		expect(view.getByRole("complementary", { name: "Inspector version 2" })).toBeInTheDocument()
		expect(view.container.querySelector(".element-identity code")).toHaveTextContent("entity")
	})
})
