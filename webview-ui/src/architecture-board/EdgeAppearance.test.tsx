import { render } from "@testing-library/react"
import { renderToStaticMarkup } from "react-dom/server"
import { Position, type EdgeProps } from "@xyflow/react"
import { describe, expect, it, vi } from "vitest"
import type { EdgeKind } from "@shared/architecture"
import { ArchitectureEdgeView } from "./FlowElements"
import type { BoardEdge } from "./flowGraph"
import { BoardStyleContext } from "./styles/StyleContext"
import { boardStyles } from "./styles/catalog"

const viewport = vi.hoisted(() => ({ zoom: 1 }))
vi.mock("@xyflow/react", async (importOriginal) => ({
	...(await importOriginal<typeof import("@xyflow/react")>()),
	useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
		selector({ transform: [0, 0, viewport.zoom] }),
	EdgeLabelRenderer: () => null,
}))

function edgeProps(kind: EdgeKind): EdgeProps<BoardEdge> {
	return {
		id: "connection",
		type: "architecture",
		source: "source",
		target: "target",
		sourceX: 0,
		sourceY: 0,
		targetX: 200,
		targetY: 0,
		sourcePosition: Position.Right,
		targetPosition: Position.Left,
		selected: false,
		selectable: true,
		deletable: false,
		data: {
			semantic: { id: "connection", kind, source: "source", target: "target" },
			lane: 0,
			route: [
				{ x: 0, y: 0 },
				{ x: 200, y: 0 },
			],
		},
	}
}

const kinds: EdgeKind[] = ["api_call", "data_flow", "dependency", "aggregation", "transition", "message"]
const cases = boardStyles.flatMap((style) => kinds.flatMap((kind) => [0.5, 1, 2].map((zoom) => ({ style, kind, zoom }))))
const states = [
	{ name: "idle", selected: false, emphasized: false, dimmed: false, extraWidth: 0, opacity: "var(--board-edge-idle-opacity)" },
	{ name: "highlighted", selected: false, emphasized: true, dimmed: false, extraWidth: 0.4, opacity: "1" },
	{ name: "selected", selected: true, emphasized: true, dimmed: false, extraWidth: 1.1, opacity: "1" },
	{ name: "dimmed", selected: false, emphasized: false, dimmed: true, extraWidth: 0, opacity: "0.13" },
]

describe("Relationship emphasis", () => {
	it.each(cases)("keeps $style.id $kind light until selected at zoom $zoom", ({ style, kind, zoom }) => {
		viewport.zoom = zoom
		const props = edgeProps(kind)
		const view = render(<svg />)
		expect(style.edgeWidth).toBeGreaterThan(0)
		expect(style.edgeWidth).toBeLessThanOrEqual(1.1)
		for (const state of states) {
			const element = (
				<svg>
					<BoardStyleContext.Provider value={style}>
						<ArchitectureEdgeView {...props} selected={state.selected} data={{ ...props.data!, ...state }} />
					</BoardStyleContext.Provider>
				</svg>
			)
			view.rerender(element)
			// jsdom's CSS parser coerces var(...) opacity to "NaN". Check React's
			// serialized declarations instead, including the aggregation diamond.
			const opacities = [...renderToStaticMarkup(element).matchAll(/opacity:([^;"\s]+)/g)].map((match) => match[1])
			expect(opacities).toEqual(Array(kind === "aggregation" ? 2 : 1).fill(state.opacity))
			const line = view.container.querySelector<SVGPathElement>(".react-flow__edge-path")!
			expect(Number.parseFloat(line.style.strokeWidth) * zoom).toBeCloseTo(style.edgeWidth + state.extraWidth)
			expect(line.style.stroke).toBe(`var(--board-edge-${kind})`)
			const dash = kind === "dependency" ? style.dependencyDash : kind === "data_flow" ? style.dataDash : kind === "message" ? style.messageDash : []
			expect(line.style.strokeDasharray).toBe(dash.map((length) => length / zoom).join(" "))
			const hitArea = view.container.querySelector(".react-flow__edge-interaction")!
			expect(Number(hitArea.getAttribute("stroke-width")) * zoom).toBeCloseTo(28)
			if (kind === "aggregation") {
				const diamond = view.container.querySelector<SVGPathElement>("path[transform]")!
				expect(Number(diamond.getAttribute("stroke-width"))).toBeCloseTo(style.edgeWidth + state.extraWidth)
				expect(diamond.getAttribute("transform")).toContain(`scale(${1 / zoom})`)
				continue
			}
			const marker = view.container.querySelector("marker")!
			const arrow = marker.querySelector("path")!
			expect(arrow.getAttribute("fill")).toBe(kind === "transition" ? "none" : `var(--board-edge-${kind})`)
			if (kind === "transition") {
				expect(arrow.getAttribute("stroke")).toBe("var(--board-edge-transition)")
				expect(arrow.getAttribute("d")).not.toContain("Z")
			}
			expect(Number(marker.getAttribute("markerWidth")) * zoom).toBeCloseTo(state.selected ? 10 : 8)
			expect(Number(marker.getAttribute("markerHeight")) * zoom).toBeCloseTo(state.selected ? 8 : 6.4)
		}
	})

	it.each(["data_flow", "transition", "message"] as const)("gives the separate %s terminal arrow on a gapped route the same opacity as its line", (kind) => {
		viewport.zoom = 1
		const props = edgeProps(kind)
		const view = render(<svg />)
		for (const state of states) {
			const element = (
				<svg>
					<ArchitectureEdgeView
						{...props}
						selected={state.selected}
						data={{
							...props.data!,
							...state,
							decorations: {
								jumps: [],
								gaps: [
									{ segment: 0, at: 100, across: 0, jump: { segment: 0, from: 0, to: 0, radius: 6, side: 1 } },
								],
							},
						}}
					/>
				</svg>
			)
			view.rerender(element)
			const opacities = [...renderToStaticMarkup(element).matchAll(/opacity:([^;"\s]+)/g)].map((match) => match[1])
			expect(opacities).toEqual([state.opacity, state.opacity])
			const line = view.container.querySelector<SVGPathElement>(".react-flow__edge-path")!
			const terminal = view.container.querySelector<SVGPathElement>('path[stroke="none"][marker-end]')!
			expect(line).not.toHaveAttribute("marker-end")
			expect(terminal).toBeInTheDocument()
		}
	})
})
