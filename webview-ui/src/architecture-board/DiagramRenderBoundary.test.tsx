import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DiagramRenderBoundary } from "./DiagramRenderBoundary"

describe("Diagram renderer isolation", () => {
	it("retains textual semantics and supports a local retry without affecting another pane", () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {})
		let broken = true
		function Canvas() {
			if (broken) throw new Error("Renderer fault")
			return <p>Recovered canvas</p>
		}
		try {
			render(
				<>
					<DiagramRenderBoundary
						diagram={{
							title: "Tools",
							summary: "Saved summary",
							nodes: [{ id: "task", kind: "class", label: "Task", description: "Orchestrates" }],
							edges: [],
						}}>
						<Canvas />
					</DiagramRenderBoundary>
					<p>Other pane</p>
				</>,
			)
			expect(screen.getByRole("alert")).toHaveTextContent("class: Task — Orchestrates")
			expect(screen.getByText("Other pane")).toBeInTheDocument()
			broken = false
			fireEvent.click(screen.getByText("Retry renderer"))
			expect(screen.getByText("Recovered canvas")).toBeInTheDocument()
		} finally {
			log.mockRestore()
		}
	})
})
