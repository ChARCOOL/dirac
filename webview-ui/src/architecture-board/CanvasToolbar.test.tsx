import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CanvasToolbar } from "./CanvasToolbar"

vi.mock("@xyflow/react", () => ({
	useReactFlow: () => ({}),
	useViewport: () => ({ zoom: 0.3 }),
}))

function fixture() {
	const fit = vi.fn()
	const arrange = vi.fn()
	const view = render(
		<CanvasToolbar
			diagram={{ title: "Runtime", summary: "Summary", nodes: [], edges: [] }}
			presentationControls={
				<select aria-label="Diagram style">
					<option>Earth</option>
				</select>
			}
			arranging={false}
			initialized
			labels={false}
			fit={fit}
			arrange={arrange}
			cancel={vi.fn()}
			toggleLabels={vi.fn()}
			jump={vi.fn()}
			persist={vi.fn()}
		/>,
	)
	return { ...view, fit, arrange }
}

describe("Canvas presentation controls", () => {
	it("keeps Fit separate from Redraw and removes duplicate information controls", () => {
		const view = fixture()
		expect(view.getByRole("textbox", { name: "Find an element" })).toBeInTheDocument()
		expect(view.getByRole("combobox", { name: "Diagram style" })).toBeInTheDocument()
		expect(view.queryByLabelText("About this diagram")).not.toBeInTheDocument()
		expect(view.queryByRole("button", { name: "Details & comments" })).not.toBeInTheDocument()
		fireEvent.click(view.getByRole("button", { name: "Fit" }))
		expect(view.fit).toHaveBeenCalledOnce()
		expect(view.arrange).not.toHaveBeenCalled()
		const menu = view.getByLabelText("Layout options").closest("details")!
		menu.open = true
		const redraw = view.getByRole("button", { name: "Redraw" })
		expect(redraw).toHaveAttribute("title", expect.stringContaining("Replaces manual positioning"))
		fireEvent.click(redraw)
		expect(view.arrange).toHaveBeenCalledOnce()
		expect(menu.open).toBe(false)
		expect(view.getByLabelText("Layout options")).toHaveFocus()
	})

	it("dismisses layout options with Escape and outside pointer actions", () => {
		const view = fixture()
		const summary = view.getByLabelText("Layout options")
		const menu = summary.closest("details")!
		menu.open = true
		fireEvent.keyDown(summary, { key: "Escape" })
		expect(menu.open).toBe(false)
		expect(summary).toHaveFocus()
		menu.open = true
		fireEvent.pointerDown(document.body)
		expect(menu.open).toBe(false)
		expect(view.arrange).not.toHaveBeenCalled()
	})
})
