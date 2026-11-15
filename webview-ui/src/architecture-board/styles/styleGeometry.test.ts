import { describe, expect, it } from "vitest"
import { Position } from "@xyflow/react"
import type { ArchitectureDiagram, NodeKind } from "@shared/architecture"
import { boardStyles } from "./catalog"
import soft from "./soft/style"
import { boardGeometry, boardNodeSizes } from "./boardGeometry"
import { polygonShape } from "./polygonShape"
import { applyLayoutPorts, fixedLayoutFromNodes, toFlowGraph } from "../flowGraph"
import { dockShapeRoutes, envelopeRoutes } from "../routePorts"
import { measureLayout } from "../layoutQuality"
import { NODE_KIND_LABELS } from "../nodeShapes"
import type { PortSide } from "./types"

const size = { width: 248, height: 102 }
const kinds = Object.keys(NODE_KIND_LABELS) as NodeKind[]
const sides: PortSide[] = ["left", "right", "top", "bottom"]

describe("Style silhouettes and docking", () => {
	it.each(boardStyles)("keeps every $id port finite and inside its envelope, including corners", (style) => {
		for (const kind of kinds) {
			for (const side of sides) {
				const bounds = kind === "actor" ? boardNodeSizes.actor : size
				const length = side === "top" || side === "bottom" ? bounds.width : bounds.height
				for (const offset of [0, 1, 5, 12, length / 2, length - 12, length - 1, length]) {
					const point = style.geometry.port(kind, bounds, side, offset)
					expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true)
					expect(point.x).toBeGreaterThanOrEqual(-1e-8)
					expect(point.x).toBeLessThanOrEqual(bounds.width + 1e-8)
					expect(point.y).toBeGreaterThanOrEqual(-1e-8)
					expect(point.y).toBeLessThanOrEqual(bounds.height + 1e-8)
					if (side === "top" || side === "bottom") expect(point.x).toBe(offset)
					else expect(point.y).toBe(offset)
				}
			}
		}
	})

	it("keeps state corners short and actor geometry circular at every admitted port", () => {
		expect(boardNodeSizes.state).toEqual({ width: 224, height: 112 })
		expect(boardNodeSizes.actor).toEqual({ width: 168, height: 168 })
		expect(boardGeometry.shape("state", boardNodeSizes.state).outline).toContain("M 16 0 H 208 Q")
		expect(boardGeometry.shape("state", boardNodeSizes.state).detail).toBeUndefined()
		expect(boardGeometry.port("state", boardNodeSizes.state, "left", 0)).toEqual({ x: 16, y: 0 })
		expect(boardGeometry.port("state", boardNodeSizes.state, "left", 4)).toEqual({ x: 4, y: 4 })
		for (const side of sides) {
			const [start, end] = boardGeometry.portSpan("actor", side, boardNodeSizes.actor)
			for (const offset of [start, 84, end]) {
				const point = boardGeometry.port("actor", boardNodeSizes.actor, side, offset)
				expect((point.x - 84) ** 2 + (point.y - 84) ** 2).toBeCloseTo(84 ** 2)
			}
		}
	})

	it("projects onto the quadratic fillet, not an invisible square or circular approximation", () => {
		const shape = polygonShape(
			[
				{ x: 0, y: 0 },
				{ x: 20, y: 0 },
				{ x: 20, y: 20 },
				{ x: 0, y: 20 },
			],
			4,
		)
		expect(shape.port("left", 0)).toEqual({ x: 4, y: 0 })
		expect(shape.port("left", 1).x).toBeCloseTo(1)
		expect(shape.port("right", 1).x).toBeCloseTo(19)
		expect(shape.port("top", 1).y).toBeCloseTo(1)
		expect(shape.port("bottom", 1).y).toBeCloseTo(19)
	})

	it.each(boardStyles)("shares silhouettes and docking in $id without changing layout", (style) => {
		expect(style.geometry).toBe(boardGeometry)
		for (const kind of kinds) {
			expect(style.geometry.shape(kind, size)).toEqual(boardGeometry.shape(kind, size))
			for (const side of sides) {
				const offset = (side === "top" || side === "bottom" ? size.width : size.height) / 2
				expect(style.geometry.port(kind, size, side, offset)).toEqual(boardGeometry.port(kind, size, side, offset))
			}
		}
		expect(style.geometry.shape("class", size).detail).toBe(`M 0 ${size.height * 0.3} H ${size.width}`)
		expect(style.geometry.port("api_endpoint", size, "left", size.height / 2)).toEqual({
			x: size.width * 0.18,
			y: size.height / 2,
		})
		expect(style.geometry.port("group", size, "left", 0)).toEqual({ x: 16, y: 0 })
	})

	it("docks an inward group connection onto the same curved frame used by its handle and recovers it", () => {
		const diagram: ArchitectureDiagram = {
			title: "Group docking",
			summary: "",
			nodes: [
				{ id: "g", kind: "group", label: "Frame" },
				{ id: "a", kind: "function", label: "Inside", parentId: "g" },
			],
			edges: [{ id: "ga", source: "g", target: "a", kind: "api_call" }],
		}
		const layout = {
			positions: { g: { x: 0, y: 0 }, a: { x: 40, y: 70 } },
			sizes: { g: { width: 200, height: 150 }, a: { width: 80, height: 40 } },
			routes: {
				ga: [
					{ x: 5, y: 0 },
					{ x: 5, y: 90 },
					{ x: 40, y: 90 },
				],
			},
		}
		const docked = dockShapeRoutes(diagram, layout, soft.geometry)
		expect(docked.routes.ga[0]).toEqual(soft.geometry.port("group", layout.sizes.g, "top", 5))
		expect(docked.routes.ga[0].y).toBeGreaterThan(0)
		expect(docked.positions).toEqual(layout.positions)
		expect(envelopeRoutes(diagram, docked)).toEqual(layout.routes)
		expect(measureLayout(diagram, docked, soft.geometry).invalid).toBeUndefined()
		const graph = toFlowGraph(diagram)
		const nodes = applyLayoutPorts(
			graph.nodes.map((node) => {
				const id = node.id as "g" | "a"
				return { ...node, position: layout.positions[id], measured: layout.sizes[id], style: layout.sizes[id] }
			}),
			docked,
		)
		expect(nodes[0].data.ports[0]).toMatchObject({ side: Position.Top, offset: 2.5 })
		expect(fixedLayoutFromNodes(nodes, graph.edges).routes.ga[0]).toEqual(layout.routes.ga[0])
	})
})
