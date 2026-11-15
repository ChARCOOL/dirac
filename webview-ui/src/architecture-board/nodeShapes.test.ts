import { describe, expect, it } from "vitest"
import type { ArchitectureDiagram, NodeKind } from "@shared/architecture"
import { NODE_KIND_LABELS, nodeShape, shapePort, terminalSide } from "./nodeShapes"
import { dockShapeRoutes, envelopeRoutes } from "./routePorts"
import { measureLayout } from "./layoutQuality"
import { applyLayoutPorts, fixedLayoutFromNodes, toFlowGraph } from "./flowGraph"
import { Position } from "@xyflow/react"

const size = { width: 248, height: 80 }

describe("Architectural silhouettes and docking", () => {
	it("gives every leaf kind a different outline or structural compartment without using color", () => {
		const kinds = Object.keys(NODE_KIND_LABELS).filter((kind) => kind !== "group") as NodeKind[]
		expect(new Set(kinds.map((kind) => JSON.stringify(nodeShape(kind, size)))).size).toBe(kinds.length)
	})
	it("puts capsule, cylinder, notch and tab ports on their actual silhouettes", () => {
		expect(shapePort("function", size, "left", 40)).toEqual({ x: 0, y: 40 })
		expect(shapePort("function", size, "right", 16).x).toBeCloseTo(240)
		expect(shapePort("database", size, "top", 124)).toEqual({ x: 124, y: 0 })
		expect(shapePort("database", size, "top", 0)).toEqual({ x: 0, y: 27 })
		expect(shapePort("database", size, "left", 0)).toEqual({ x: 124, y: 0 })
		expect(shapePort("api_endpoint", size, "left", 40)).toEqual({ x: size.width * 0.18, y: 40 })
		expect(shapePort("component", size, "left", 40)).toEqual({ x: 8, y: 40 })
		expect(shapePort("component", size, "left", 25)).toEqual({ x: 0, y: 25 })
		expect(shapePort("component", size, "top", 4)).toEqual({ x: 4, y: size.height * 0.29 - 4 })
		expect(shapePort("service", size, "top", 6)).toEqual({ x: 6, y: 20 })
	})
	it("projects and recovers envelope ports without moving nodes or losing orthogonality", () => {
		const diagram: ArchitectureDiagram = {
			title: "Docking",
			summary: "",
			nodes: [
				{ id: "a", kind: "component", label: "A" },
				{ id: "b", kind: "function", label: "B" },
			],
			edges: [{ id: "ab", source: "a", target: "b", kind: "api_call" }],
		}
		const original = {
			positions: { a: { x: 0, y: 0 }, b: { x: 300, y: 0 } },
			sizes: { a: size, b: size },
			routes: {
				ab: [
					{ x: 248, y: 16 },
					{ x: 300, y: 16 },
				],
			},
		}
		const docked = dockShapeRoutes(diagram, original)
		expect(docked.routes.ab.at(-1)).toEqual({ x: 308, y: 16 })
		expect(docked.positions).toEqual(original.positions)
		expect(measureLayout(diagram, docked).invalid).toBeUndefined()
		expect(envelopeRoutes(diagram, docked)).toEqual(original.routes)
		const graph = toFlowGraph(diagram)
		const nodes = applyLayoutPorts(
			// Reproduce the fixture's rendered dimensions, not the current default style sizes.
			graph.nodes.map((node) => ({
				...node,
				position: original.positions[node.id as "a" | "b"],
				style: size,
				measured: size,
			})),
			docked,
		)
		expect(nodes[1].data.ports[0]).toMatchObject({ side: Position.Left, offset: 20 })
		expect(terminalSide(docked.routes.ab.at(-1)!, docked.routes.ab[0])).toBe("left")
		expect(fixedLayoutFromNodes(nodes, graph.edges).routes.ab.at(-1)).toEqual({ x: 300, y: 16 })
	})
})
