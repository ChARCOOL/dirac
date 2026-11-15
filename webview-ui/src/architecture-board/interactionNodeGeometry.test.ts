import { describe, expect, it } from "vitest"
import type { ArchitectureDiagram } from "@shared/architecture"
import { boardGeometry, boardNodeSizes } from "./styles/boardGeometry"
import { dockShapeRoutes, envelopeRoutes } from "./routePorts"
import { measureLayout } from "./layoutQuality"
import { toFlowGraph } from "./flowGraph"

const diagram: ArchitectureDiagram = {
	title: "Interaction docking",
	summary: "Actor communication and state transitions retain their own silhouettes.",
	nodes: [
		{ id: "actor", kind: "actor", label: "Human" },
		{ id: "state", kind: "state", label: "Feedback pending" },
	],
	edges: [{ id: "message", source: "actor", target: "state", kind: "message" }],
}

describe("Interaction node geometry", () => {
	it("uses canonical square actors and compact state cards in the flow graph", () => {
		const graph = toFlowGraph(diagram)
		expect(graph.nodes.find((node) => node.id === "actor")?.style).toEqual(boardNodeSizes.actor)
		expect(graph.nodes.find((node) => node.id === "state")?.style).toEqual(boardNodeSizes.state)
	})

	it("docks and restores a circular actor route without moving nodes", () => {
		const layout = {
			positions: { actor: { x: 0, y: 0 }, state: { x: 300, y: 0 } },
			sizes: { actor: boardNodeSizes.actor, state: boardNodeSizes.state },
			routes: { message: [{ x: 168, y: 42 }, { x: 300, y: 42 }] },
		}
		const docked = dockShapeRoutes(diagram, layout)
		expect(docked.routes.message[0]).toEqual(boardGeometry.port("actor", boardNodeSizes.actor, "right", 42))
		expect(docked.routes.message[0].x).toBeLessThan(168)
		expect(docked.positions).toEqual(layout.positions)
		expect(measureLayout(diagram, docked).invalid).toBeUndefined()
		expect(envelopeRoutes(diagram, docked)).toEqual(layout.routes)
	})

	it("does not turn an actor into an ellipse in a rectangular legend envelope", () => {
		const size = { width: 248, height: 102 }
		expect(boardGeometry.shape("actor", size).outline).toContain("A 51 51")
		const point = boardGeometry.port("actor", size, "left", 51)
		expect(point).toEqual({ x: 73, y: 51 })
	})
})
