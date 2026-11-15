import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RelationshipLegend } from "./RelationshipLegend"

describe("Relationship vocabulary", () => {
	it("shows each present kind once without crowding the canvas with unused kinds", () => {
		const { container } = render(<RelationshipLegend kinds={["transition", "message", "transition"]} />)
		expect(screen.getByText("Transition")).toBeInTheDocument()
		expect(screen.getByText("Message")).toBeInTheDocument()
		expect(screen.queryByText("Calls")).not.toBeInTheDocument()
		expect(container.querySelectorAll("svg")).toHaveLength(2)
	})

	it("distinguishes state changes from messages without color", () => {
		const { container } = render(<RelationshipLegend />)
		const transition = container.querySelector(".edge-transition")!
		const message = container.querySelector(".edge-message")!
		expect(transition.querySelector("path")!.getAttribute("stroke-dasharray")).toBeNull()
		expect(transition.lastElementChild!.getAttribute("fill")).toBe("none")
		expect(message.querySelector("path")!.getAttribute("stroke-dasharray")!.split(" ")).toHaveLength(4)
		expect(message.lastElementChild!.getAttribute("fill")).toBe("currentColor")
	})

	it("omits an empty legend", () => {
		const { container } = render(<RelationshipLegend kinds={[]} />)
		expect(container).toBeEmptyDOMElement()
	})
})
