import { describe, expect, it } from "vitest"
import type { BoardEdge, BoardNode } from "../flowGraph"
import { createExportSnapshot, imageDimensions, snapshotBounds } from "./exportSnapshot"

function node(id = "source", overrides: Partial<BoardNode> = {}): BoardNode {
	return {
		id,
		type: "architecture",
		position: { x: 10, y: 20 },
		style: { width: 120, height: 80 },
		data: {
			semantic: { id, kind: "component", label: id, change: "modified", code: [{ path: "src/service.ts", line: 10 }] },
			ports: [],
			comments: { pending: 2, sent: 1 },
			dimmed: true,
		},
		selected: true,
		draggable: true,
		focusable: true,
		...overrides,
	}
}

function edge(): BoardEdge {
	return {
		id: "link",
		type: "architecture",
		source: "source",
		target: "target",
		selected: true,
		focusable: true,
		data: {
			semantic: { id: "link", source: "source", target: "target", kind: "dependency", label: "Calls", change: "added" },
			lane: 2,
			route: [
				{ x: 130, y: 60 },
				{ x: 240, y: 60 },
			],
			decorations: { jumps: [{ segment: 0, from: 40, to: 48, radius: 4, side: 1 }], gaps: [] },
			showLabel: true,
			emphasized: true,
			dimmed: true,
			comments: { pending: 1, sent: 3 },
		},
	}
}

describe("createExportSnapshot", () => {
	it("removes interaction and review state without changing authored content or the live graph", () => {
		const nodes = [node(), node("target", { position: { x: 240, y: 20 } })]
		const edges = [edge()]
		const original = structuredClone({ nodes, edges })

		const snapshot = createExportSnapshot(nodes, edges, true)

		for (const [index, exported] of snapshot.nodes.entries()) {
			expect(exported).toMatchObject({ selected: false, dragging: false, draggable: false, focusable: false })
			expect(exported.data.dimmed).toBe(false)
			expect(exported.data.comments).toBeUndefined()
			expect(exported.data.semantic).toEqual(nodes[index].data.semantic)
			expect(exported.position).toEqual(nodes[index].position)
			expect(exported.style).toEqual(nodes[index].style)
		}
		expect(snapshot.edges[0]).toMatchObject({ selected: false, focusable: false })
		expect(snapshot.edges[0].data).toEqual({
			...edges[0].data,
			showLabel: true,
			emphasized: false,
			dimmed: false,
			comments: undefined,
		})
		expect({ nodes, edges }).toEqual(original)
	})

	it("isolates nested geometry and semantic data in both directions", () => {
		const nodes = [node(), node("target")]
		const edges = [edge()]
		const snapshot = createExportSnapshot(nodes, edges, true)

		nodes[0].position.x = 999
		nodes[0].style!.width = 999
		nodes[0].data.semantic.code![0].line = 99
		edges[0].data!.route![0].x = 999
		edges[0].data!.decorations!.jumps[0].radius = 99
		edges[0].data!.semantic.label = "Live edit"
		nodes.push(node("later"))
		edges.length = 0

		expect(snapshot.nodes).toHaveLength(2)
		expect(snapshot.edges).toHaveLength(1)
		expect(snapshot.nodes[0].position).toEqual({ x: 10, y: 20 })
		expect(snapshot.nodes[0].style).toEqual({ width: 120, height: 80 })
		expect(snapshot.nodes[0].data.semantic.code![0].line).toBe(10)
		expect(snapshot.edges[0].data!.route![0]).toEqual({ x: 130, y: 60 })
		expect(snapshot.edges[0].data!.decorations!.jumps[0].radius).toBe(4)
		expect(snapshot.edges[0].data!.semantic.label).toBe("Calls")

		snapshot.nodes[1].position.y = -100
		snapshot.nodes[1].data.semantic.label = "Export-only edit"
		expect(nodes[1].position.y).toBe(20)
		expect(nodes[1].data.semantic.label).toBe("target")
	})

	it.each([true, false])("applies Labels=%s to every edge without changing semantic labels", (labels) => {
		const first = edge()
		const second = edge()
		second.id = "second"
		second.data!.semantic.id = "second"
		second.data!.showLabel = false

		const snapshot = createExportSnapshot([node(), node("target")], [first, second], labels)

		expect(snapshot.edges.map((item) => item.data!.showLabel)).toEqual([labels, labels])
		expect(snapshot.edges.map((item) => item.data!.semantic.label)).toEqual(["Calls", "Calls"])
		expect(first.data!.showLabel).toBe(true)
		expect(second.data!.showLabel).toBe(false)
	})

	it("rejects an empty diagram", () => {
		expect(() => createExportSnapshot([], [], true)).toThrow("There are no diagram elements to copy.")
	})

	it("rejects a dragging node even when it is not the first node", () => {
		expect(() => createExportSnapshot([node(), node("target", { dragging: true })], [], true)).toThrow(
			"Finish moving elements before copying the image.",
		)
	})

	it.each(["missing data", "missing route", "empty route"])("rejects an unrouted edge with %s", (missing) => {
		const unrouted = edge()
		if (missing === "missing data") delete unrouted.data
		else if (missing === "empty route") unrouted.data!.route = []
		else delete unrouted.data!.route
		expect(() => createExportSnapshot([node(), node("target")], [edge(), unrouted], true)).toThrow(
			"Wait for diagram routing to finish before copying the image.",
		)
	})

	it("allows a nonempty diagram without edges", () => {
		expect(createExportSnapshot([node()], [], false).edges).toEqual([])
	})
})

describe("snapshotBounds", () => {
	it("accumulates nested parent offsets and includes negative node and absolute route coordinates", () => {
		const group = node("group", { position: { x: -200, y: -100 }, style: { width: 300, height: 200 } })
		group.data.semantic.kind = "group"
		const nested = node("nested", { parentId: "group", position: { x: 250, y: 150 }, style: { width: 100, height: 100 } })
		nested.data.semantic.kind = "group"
		const child = node("source", { parentId: "nested", position: { x: 80, y: 90 }, style: { width: 120, height: 80 } })
		const routed = edge()
		routed.data!.route = [
			{ x: 250, y: 180 },
			{ x: -250, y: 180 },
			{ x: -250, y: -150 },
			{ x: 300, y: -150 },
		]

		expect(snapshotBounds({ nodes: [group, nested, child], edges: [] })).toEqual({
			x: -200,
			y: -100,
			width: 450,
			height: 320,
		})
		expect(snapshotBounds({ nodes: [group, nested, child], edges: [routed] })).toEqual({
			x: -250,
			y: -150,
			width: 550,
			height: 370,
		})
	})

	it("uses the full node rectangle, not just its origin", () => {
		expect(snapshotBounds({ nodes: [node("only", { position: { x: -40, y: -30 } })], edges: [] })).toEqual({
			x: -40,
			y: -30,
			width: 120,
			height: 80,
		})
	})
})

describe("imageDimensions", () => {
	it("rounds up padded dimensions and translates negative bounds at fixed 2× resolution", () => {
		expect(imageDimensions({ x: -100.5, y: -40.25, width: 120.2, height: 80.8 })).toEqual({
			width: 185,
			height: 145,
			pixelRatio: 2,
			viewport: { x: 132.5, y: 72.25, zoom: 1 },
		})
	})

	it.each(["x", "y", "width", "height"] as const)("rejects nonfinite %s", (coordinate) => {
		for (const value of [NaN, Infinity, -Infinity]) {
			expect(() => imageDimensions({ x: 0, y: 0, width: 100, height: 100, [coordinate]: value })).toThrow(
				"The diagram has invalid image bounds.",
			)
		}
	})

	it.each(["width", "height"] as const)("rejects negative raw %s before padding", (dimension) => {
		for (const value of [-1, -64, -65]) {
			expect(() => imageDimensions({ x: 0, y: 0, width: 100, height: 100, [dimension]: value })).toThrow(
				"The diagram has invalid image bounds.",
			)
		}
	})

	it.each([
		"width",
		"height",
	] as const)("allows exactly 8192 physical pixels in %s but refuses to downscale beyond it", (dimension) => {
		const bounds = { x: 0, y: 0, width: 100, height: 100, [dimension]: 4032 }
		expect(imageDimensions(bounds)[dimension]).toBe(4096)
		expect(() => imageDimensions({ ...bounds, [dimension]: 4032.1 })).toThrow(/too large.*8192px.*nothing was cropped/)
	})

	it("allows exactly 16 megapixels but rejects a rounded-up overflow below the per-side limit", () => {
		expect(imageDimensions({ x: 0, y: 0, width: 1936, height: 1936 })).toMatchObject({
			width: 2000,
			height: 2000,
			pixelRatio: 2,
		})
		expect(() => imageDimensions({ x: 0, y: 0, width: 1936.1, height: 1936 })).toThrow(/too large.*16 megapixels/)
	})
})
