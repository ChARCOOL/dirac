import { describe, expect, it } from "vitest"
import type { ArchitectureDiagram } from "@shared/architecture"
import type { LayoutOutput } from "./layoutGraph"
import { restoreUnchangedGroupSizes, toFlowGraph } from "./flowGraph"

const diagram: ArchitectureDiagram = {
	title: "Frames",
	summary: "",
	nodes: [
		{ id: "outer", kind: "group", label: "Outer" },
		{ id: "inner", kind: "group", label: "Inner", parentId: "outer" },
		{ id: "leaf", kind: "component", label: "Leaf", parentId: "inner" },
		{ id: "workspace", kind: "component", label: "Workspace" },
	],
	edges: [],
}
const layout: LayoutOutput = {
	positions: { outer: { x: 0, y: 0 }, inner: { x: 32, y: 80 }, leaf: { x: 32, y: 80 }, workspace: { x: 900, y: 0 } },
	sizes: {
		outer: { width: 700, height: 500 },
		inner: { width: 500, height: 300 },
		leaf: { width: 248, height: 96 },
		workspace: { width: 248, height: 96 },
	},
	routes: {},
}
const nodes = () =>
	toFlowGraph(diagram).nodes.map((node) => ({ ...node, position: layout.positions[node.id], measured: layout.sizes[node.id] }))

describe("Saved frame recovery", () => {
	it("does not shrink unchanged frames when an external node or the whole subsystem moves", () => {
		const moved = nodes().map((node) => ({
			...node,
			position: node.parentId ? node.position : { x: node.position.x + 50, y: 30 },
		}))
		const recovered = restoreUnchangedGroupSizes(moved, layout)
		expect(recovered.find((node) => node.id === "outer")!.style).toMatchObject(layout.sizes.outer)
		expect(recovered.find((node) => node.id === "inner")!.style).toMatchObject(layout.sizes.inner)
		expect(recovered.map((node) => node.position)).toEqual(moved.map((node) => node.position))
	})
	it("never imports a different placement's frame sizes when any descendant moved", () => {
		const moved = nodes().map((node) => (node.id === "leaf" ? { ...node, position: { x: 100, y: 100 } } : node))
		expect(restoreUnchangedGroupSizes(moved, layout)).toEqual(moved)
	})
	it("requires measured leaf dimensions to match as well as positions", () => {
		const resized = nodes().map((node) => (node.id === "leaf" ? { ...node, measured: { width: 248, height: 120 } } : node))
		expect(restoreUnchangedGroupSizes(resized, layout)).toEqual(resized)
	})
})
