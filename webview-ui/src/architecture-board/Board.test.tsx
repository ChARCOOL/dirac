import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ComponentProps } from "react"
import type { DiagramCanvas } from "./DiagramCanvas"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Board } from "./Board"
import { BoardClient } from "./boardClient"

vi.mock("./boardClient", () => ({ BoardClient: { read: vi.fn(), requestView: vi.fn(), requestStyle: vi.fn() } }))
vi.mock("./DiagramCanvas", () => ({
	DiagramCanvas: ({
		fullscreen,
		presentationControls,
		utilityControls,
		overviewRequest,
	}: ComponentProps<typeof DiagramCanvas>) => (
		<>
			{presentationControls}
			{utilityControls}
			<p data-fullscreen={fullscreen} data-overview-request={overviewRequest}>
				Canvas
			</p>
		</>
	),
}))
const view = (version: number) => ({
	selection: { taskId: "owner", name: "tools", mode: "latest" },
	panes: [
		{
			name: "tools",
			version,
			title: `<script>Title ${version}</script>`,
			summary: `Summary ${version}`,
			diagramJson: JSON.stringify({ title: `Title ${version}`, summary: `Summary ${version}`, nodes: [], edges: [] }),
			commentsJson: "[]",
		},
	],
})

describe("Textual architecture board", () => {
	beforeEach(() => {
		vi.mocked(BoardClient.read).mockReset()
		vi.mocked(BoardClient.requestView).mockReset()
		vi.mocked(BoardClient.requestStyle).mockReset()
	})
	afterEach(() => {
		document.body.className = ""
	})
	it.each([
		undefined,
		"auto",
		"current",
		"removed-style",
	])("follows appearance for preference %s without saving a default", async (initialStyle) => {
		document.body.className = "vscode-light"
		vi.mocked(BoardClient.read).mockResolvedValue(view(1))
		render(<Board taskId="owner" initialStyle={initialStyle} />)
		await screen.findByText("Version 1")
		const picker = screen.getByRole("combobox", { name: "Diagram style" })
		expect(picker).toHaveValue("linen")
		await act(async () => {
			document.body.className = "vscode-dark"
		})
		expect(picker).toHaveValue("earth")
		expect(BoardClient.requestStyle).not.toHaveBeenCalled()
		expect(BoardClient.read).toHaveBeenCalledTimes(1)
	})
	it.each(["earth", "linen", "soft"])("preserves explicit %s across appearance changes", async (initialStyle) => {
		document.body.className = "vscode-light"
		vi.mocked(BoardClient.read).mockResolvedValue(view(1))
		render(<Board taskId="owner" initialStyle={initialStyle} />)
		await screen.findByText("Version 1")
		const picker = screen.getByRole("combobox", { name: "Diagram style" })
		expect(picker).toHaveValue(initialStyle)
		await act(async () => {
			document.body.className = "vscode-dark"
		})
		expect(picker).toHaveValue(initialStyle)
	})
	it("persists a deliberate choice and resumes defaults when the host resets the preference", async () => {
		document.body.className = "vscode-light"
		vi.mocked(BoardClient.read).mockResolvedValue(view(1))
		render(<Board taskId="owner" />)
		await screen.findByText("Version 1")
		const picker = screen.getByRole("combobox", { name: "Diagram style" })
		expect(Array.from((picker as HTMLSelectElement).options, (option) => option.value).sort()).toEqual([
			"earth",
			"linen",
			"soft",
		])
		fireEvent.change(picker, { target: { value: "soft" } })
		expect(BoardClient.requestStyle).toHaveBeenLastCalledWith("soft")
		await act(async () => {
			document.body.className = "vscode-dark"
		})
		expect(picker).toHaveValue("soft")
		await act(async () => {
			window.dispatchEvent(new MessageEvent("message", { data: { type: "architecture_board_style_state", style: "auto" } }))
		})
		expect(picker).toHaveValue("earth")
		await act(async () => {
			document.body.className = "vscode-light"
		})
		expect(picker).toHaveValue("linen")
		expect(BoardClient.read).toHaveBeenCalledTimes(1)
	})
	it("renders semantic text safely, refreshes only its owner, and ignores stale responses", async () => {
		vi.mocked(BoardClient.read).mockResolvedValueOnce(view(1))
		render(<Board taskId="owner" />)
		expect(await screen.findByText("Version 1")).toBeInTheDocument()
		expect(document.querySelector("script")).toBeNull()
		await act(async () => {
			window.dispatchEvent(new MessageEvent("message", { data: { type: "architecture_board_changed", taskId: "other" } }))
		})
		expect(BoardClient.read).toHaveBeenCalledTimes(1)
		let old!: (value: ReturnType<typeof view>) => void
		vi.mocked(BoardClient.read).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					old = resolve
				}),
		)
		fireEvent.click(screen.getByLabelText("Board options"))
		fireEvent.click(screen.getByRole("button", { name: "Reload board", exact: true }))
		vi.mocked(BoardClient.read).mockResolvedValueOnce(view(3))
		await act(async () => {
			window.dispatchEvent(new MessageEvent("message", { data: { type: "architecture_board_changed", taskId: "owner" } }))
		})
		expect(await screen.findByText("Version 3")).toBeInTheDocument()
		await act(async () => {
			old(view(2))
		})
		expect(screen.queryByText("Version 2")).toBeNull()
	})
	it("keeps comparison versions fixed and changes only the explicitly chosen side", async () => {
		vi.mocked(BoardClient.read).mockResolvedValue({
			selection: { taskId: "owner", name: "tools", mode: "comparison", startVersion: 2, endVersion: 1 },
			latestVersion: 3,
			panes: [...view(2).panes, ...view(1).panes],
		})
		render(<Board taskId="owner" />)
		const left = within(await screen.findByRole("region", { name: "Left version 2" }))
		const right = within(screen.getByRole("region", { name: "Right version 1" }))
		expect(BoardClient.read).toHaveBeenCalledTimes(1)
		expect(screen.queryByRole("button", { name: "View latest", exact: true })).toBeNull()
		fireEvent.click(right.getByRole("button", { name: "v3 available" }))
		await waitFor(() =>
			expect(BoardClient.read).toHaveBeenLastCalledWith("owner", false, {
				taskId: "owner",
				name: "tools",
				mode: "comparison",
				startVersion: 2,
				endVersion: 3,
			}),
		)
		fireEvent.click(left.getByLabelText("Version 2 options"))
		expect(left.queryByRole("button", { name: "Follow latest" })).toBeNull()
		fireEvent.change(left.getByLabelText("Version to open"), { target: { value: "1" } })
		fireEvent.submit(left.getByRole("button", { name: "Open version" }).closest("form")!)
		await waitFor(() =>
			expect(BoardClient.read).toHaveBeenLastCalledWith("owner", false, {
				taskId: "owner",
				name: "tools",
				mode: "comparison",
				startVersion: 1,
				endVersion: 1,
			}),
		)
		expect(screen.getByRole("button", { name: "Send Feedback", exact: true })).toBeDisabled()
	})
	it.each([undefined, 1, 2])("shows an update only for a known newer version: %s", async (latestVersion) => {
		vi.mocked(BoardClient.read).mockResolvedValue({
			...view(1),
			latestVersion,
			selection: { taskId: "owner", name: "tools", mode: "exact", version: 1 },
		})
		render(<Board taskId="owner" />)
		await screen.findByText("Version 1")
		const update = screen.queryByRole("button", { name: "v2 available" })
		if (latestVersion === 2) {
			expect(update).toBeInTheDocument()
			fireEvent.click(update!)
			await waitFor(() =>
				expect(BoardClient.read).toHaveBeenLastCalledWith("owner", false, {
					taskId: "owner",
					name: "tools",
					mode: "exact",
					version: 2,
				}),
			)
		} else expect(update).toBeNull()
	})
	it("keeps following latest and version lookup inside version navigation", async () => {
		vi.mocked(BoardClient.read).mockResolvedValue({
			...view(1),
			selection: { taskId: "owner", name: "tools", mode: "exact", version: 1 },
			latestVersionError: "Latest unavailable",
		})
		render(<Board taskId="owner" />)
		fireEvent.click(await screen.findByLabelText("Version 1 options"))
		expect(screen.getByText(/Could not check for updates: Latest unavailable/)).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Follow latest" }))
		await waitFor(() =>
			expect(BoardClient.read).toHaveBeenLastCalledWith("owner", false, { taskId: "owner", name: "tools", mode: "latest" }),
		)
	})
	it("requests diagram overview explicitly without reloading semantic content", async () => {
		vi.mocked(BoardClient.read).mockResolvedValue(view(1))
		render(<Board taskId="owner" />)
		await screen.findByText("Version 1")
		expect(screen.getByText("Canvas")).toHaveAttribute("data-overview-request", "0")
		fireEvent.click(screen.getByRole("button", { name: "Diagram & comments" }))
		expect(screen.getByText("Canvas")).toHaveAttribute("data-overview-request", "1")
		expect(BoardClient.read).toHaveBeenCalledTimes(1)
	})
	it("offers native Zen Mode only when the host supports it, without reloading the diagram", async () => {
		vi.mocked(BoardClient.read).mockResolvedValue(view(1))
		const { rerender } = render(<Board taskId="owner" />)
		await screen.findByText("Version 1")
		expect(screen.queryByRole("button", { name: "Go Fullscreen" })).toBeNull()
		fireEvent.keyDown(screen.getByRole("button", { name: "Diagram & comments", exact: true }), { key: "Escape" })
		expect(BoardClient.requestView).not.toHaveBeenCalled()
		rerender(<Board taskId="owner" nativeZenMode />)
		expect(BoardClient.requestView).toHaveBeenLastCalledWith("ready")
		const toggle = screen.getByRole("button", { name: "Go Fullscreen" })
		expect(toggle).toHaveTextContent("Go Fullscreen")
		expect(toggle).toHaveClass("fullscreen-button")
		expect(toggle.title).toContain("No settings are changed")
		fireEvent.click(toggle)
		expect(BoardClient.requestView).toHaveBeenLastCalledWith("enter_zen")
		// The return control appears only after host confirmation, not optimistically on click.
		expect(toggle).toHaveTextContent("Go Fullscreen")
		expect(screen.getByText("Canvas")).toHaveAttribute("data-fullscreen", "false")
		await act(async () => {
			window.dispatchEvent(new MessageEvent("message", { data: { type: "architecture_board_view_state", active: true } }))
		})
		expect(screen.getByRole("button", { name: "Press Esc to return" })).toBe(toggle)
		expect(screen.getByText("Canvas")).toHaveAttribute("data-fullscreen", "true")
		fireEvent.keyDown(toggle, { key: "Escape", isComposing: true })
		fireEvent.keyDown(toggle, { key: "Escape", repeat: true })
		expect(BoardClient.requestView).toHaveBeenCalledTimes(2)
		fireEvent.keyDown(toggle, { key: "Escape" })
		expect(BoardClient.requestView).toHaveBeenLastCalledWith("exit_zen")
		expect(toggle).toHaveTextContent("Press Esc to return")
		await act(async () => {
			window.dispatchEvent(new MessageEvent("message", { data: { type: "architecture_board_view_state", active: false } }))
		})
		expect(toggle).toHaveTextContent("Go Fullscreen")
		expect(screen.getByText("Canvas")).toHaveAttribute("data-fullscreen", "false")
		expect(BoardClient.read).toHaveBeenCalledTimes(1)
		await act(async () => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: { type: "architecture_board_view_error", error: "Native command failed" },
				}),
			)
		})
		expect(screen.getByRole("alert")).toHaveTextContent("Native command failed")
		expect(screen.getByText("Version 1")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))
		expect(screen.queryByRole("alert")).toBeNull()
	})
	it("handles Escape from the page background before native forwarding, then re-enters in one click", async () => {
		vi.mocked(BoardClient.read).mockResolvedValue(view(1))
		const nativeForward = vi.fn()
		window.addEventListener("keydown", nativeForward)
		const { unmount } = render(<Board taskId="owner" nativeZenMode />)
		await screen.findByText("Version 1")
		await act(async () => {
			window.dispatchEvent(new MessageEvent("message", { data: { type: "architecture_board_view_state", active: true } }))
		})
		fireEvent.keyDown(document.body, { key: "Escape" })
		expect(BoardClient.requestView).toHaveBeenLastCalledWith("exit_zen")
		expect(nativeForward).not.toHaveBeenCalled()
		await act(async () => {
			window.dispatchEvent(new MessageEvent("message", { data: { type: "architecture_board_view_state", active: false } }))
		})
		fireEvent.click(screen.getByRole("button", { name: "Go Fullscreen" }))
		expect(BoardClient.requestView).toHaveBeenLastCalledWith("enter_zen")
		expect(BoardClient.read).toHaveBeenCalledTimes(1)
		unmount()
		fireEvent.keyDown(document.body, { key: "Escape" })
		expect(nativeForward).toHaveBeenCalledOnce()
		window.removeEventListener("keydown", nativeForward)
	})
	it("offers local retry when storage/renderer transport fails", async () => {
		vi.mocked(BoardClient.read).mockRejectedValueOnce(new Error("missing version"))
		render(<Board taskId="owner" />)
		expect(await screen.findByRole("alert")).toHaveTextContent("missing version")
		vi.mocked(BoardClient.read).mockResolvedValueOnce(view(1))
		fireEvent.click(screen.getByText("Retry"))
		expect(await screen.findByText("Version 1")).toBeInTheDocument()
		expect(screen.queryByRole("alert")).toBeNull()
	})
})
