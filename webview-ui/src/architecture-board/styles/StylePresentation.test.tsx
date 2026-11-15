import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { NodeKind } from "@shared/architecture"
import { NodeTitle } from "../NodeTitle"
import { NodeShapeLegend } from "../NodeSilhouette"
import { NODE_KIND_LABELS } from "../nodeShapes"
import { BoardStyleContext, StyleNodeContent } from "./StyleContext"
import { resolveBoardStyle } from "./catalog"
import { boardNodeSizes } from "./boardGeometry"

vi.mock("../measureText", () => ({ measureBoardText: (text: string) => Array.from(text).length * 7 }))

function content(style: string, kind: NodeKind = "component", label = "GoalManager") {
	const size = kind === "group" ? { width: 400, height: 300 } : boardNodeSizes[kind]
	return render(
		<BoardStyleContext.Provider value={resolveBoardStyle(style)}>
			<StyleNodeContent kind={kind} label={label} {...size} title={<NodeTitle label={label} kind={kind} {...size} />} />
		</BoardStyleContext.Provider>,
	)
}

const leafKinds = ["class", "component", "service", "function", "database", "api_endpoint", "state", "actor"] as const

describe("Style-owned presentation", () => {
	it("uses Earth presentation for a removed preference without losing the title", () => {
		const view = content("no-longer-installed")
		expect(view.container.querySelectorAll(".node-title")).toHaveLength(1)
		expect(view.container.querySelector(".earth-title .node-title")).toHaveTextContent("GoalManager")
	})

	it("composes a Soft class header without inventing implementation text", () => {
		const view = content("soft", "class")
		expect(view.container.querySelector(".node-content .node-title")).toHaveTextContent("GoalManager")
		expect(view.container.querySelector(".class-header-glyph")).toHaveAttribute("aria-hidden", "true")
		expect(view.container.textContent).not.toContain("implementation")
	})

	it.each(["state", "actor"] as const)("labels Soft %s without inventing a participant subtype", (kind) => {
		const view = content("soft", kind, "Feedback review")
		expect(view.container.querySelector(".interaction-kind")).toHaveTextContent(NODE_KIND_LABELS[kind])
		expect(view.container.querySelector(".interaction-kind span")).toHaveAttribute("aria-hidden", "true")
		expect(view.container.querySelector(".node-title")).toHaveAttribute("aria-label", "Feedback review")
	})

	describe.each(["earth", "linen"])("%s semantic identity", (style) => {
		it.each(leafKinds)("keeps %s identity separate from the responsibility label", (kind) => {
			const view = content(style, kind, "Worker execution")
			expect(view.container.querySelector(`.${style}-kind`)).toHaveTextContent(NODE_KIND_LABELS[kind])
			expect(view.container.querySelector(`.${style}-glyph`)).toHaveAttribute("aria-hidden", "true")
			expect(view.container.querySelector(`.${style}-title .node-title`)).toHaveAttribute("aria-label", "Worker execution")
		})

		it("renders one fitted title as safe text and retains its full accessible name", () => {
			const view = content(style, "class", "Goal <script>unsafe()</script>")
			expect(view.container.querySelectorAll(".node-title")).toHaveLength(1)
			expect(view.container.querySelector(`.${style}-title .node-title`)).toHaveAttribute(
				"aria-label",
				"Goal <script>unsafe()</script>",
			)
			expect(view.container.querySelector("script")).toBeNull()
		})

		it("uses a plain group header without inventing a leaf kind", () => {
			const view = content(style, "group", "Agent pool")
			expect(view.container.querySelector(".node-content .node-title")).toHaveTextContent("Agent pool")
			expect(view.container.querySelector(`.${style}-kind`)).toBeNull()
		})

		it("places legend gradients inside each kind's palette scope", () => {
			const view = render(
				<BoardStyleContext.Provider value={resolveBoardStyle(style)}>
					<NodeShapeLegend kinds={[...leafKinds, "group", "class"]} />
				</BoardStyleContext.Provider>,
			)
			expect(view.container.querySelectorAll(".legend-silhouette")).toHaveLength(9)
			for (const kind of leafKinds) {
				const entry = view.container.querySelector(`.kind-${kind}`)!
				expect(entry).toHaveTextContent(NODE_KIND_LABELS[kind])
				expect(entry.querySelector(".legend-silhouette stop")).toHaveAttribute("stop-color", "var(--node-surface-top)")
			}
		})
	})
})
