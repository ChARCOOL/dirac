import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ArchitectureBoardView } from "@shared/proto/dirac/architecture"
import type { ReviewComment } from "@shared/architecture"
import { Board } from "./Board"
import { BoardClient } from "./boardClient"
import { Inspector, type BoardTarget } from "./Inspector"
import { CommentBadges, countTargetComments } from "./CommentBadges"
vi.mock("./boardClient", () => ({ BoardClient: { read: vi.fn(), mutateComment: vi.fn() } }))
vi.mock("./DiagramCanvas", () => ({
	DiagramCanvas: (props: Parameters<typeof Inspector>[0]) => {
		const [target, select] = useState<BoardTarget>()
		return <Inspector {...props} target={target} select={select} />
	},
}))
const diagram = {
	title: "Tools",
	summary: "Summary",
	nodes: [{ id: "a", kind: "component", label: "Node A" }],
	edges: [{ id: "e", kind: "dependency", source: "a", target: "a" }],
}
const comment: ReviewComment = { id: "c", target: { kind: "diagram" }, text: "Saved feedback", sent: false }
const view = (versions: number[], comments: Record<number, ReviewComment[]> = {}): ArchitectureBoardView => ({
	selection:
		versions.length === 2
			? { taskId: "owner", name: "tools", mode: "comparison", startVersion: versions[0], endVersion: versions[1] }
			: { taskId: "owner", name: "tools", mode: "latest" },
	panes: versions.map((version) => ({
		name: "tools",
		version,
		title: "Tools",
		summary: "Summary",
		diagramJson: JSON.stringify(diagram),
		commentsJson: JSON.stringify(comments[version] ?? []),
	})),
})
const changeView = async (next: ArchitectureBoardView) => {
	vi.mocked(BoardClient.read).mockResolvedValueOnce(next)
	await act(async () => {
		window.dispatchEvent(new MessageEvent("message", { data: { type: "architecture_board_changed", taskId: "owner" } }))
	})
}
describe("Local board review workflow", () => {
	beforeEach(() => {
		vi.mocked(BoardClient.read).mockReset()
		vi.mocked(BoardClient.mutateComment).mockReset()
	})
	it("shows saved-but-unconsumed feedback guidance until a refresh confirms consumption", async () => {
		const saved = view([1], { 1: [{ ...comment, sent: true }] })
		saved.panes[0].feedbackWarning =
			"Feedback is saved but consumption is not confirmed. Resume the owning conversation; do not resend."
		vi.mocked(BoardClient.read).mockResolvedValueOnce(saved)
		render(<Board taskId="owner" />)
		expect(await screen.findByText(saved.panes[0].feedbackWarning)).toBeInTheDocument()
		expect(BoardClient.mutateComment).not.toHaveBeenCalled()
		await changeView(view([1], { 1: [{ ...comment, sent: true }] }))
		expect(screen.queryByText(saved.panes[0].feedbackWarning)).not.toBeInTheDocument()
	})

	it("keeps general/node/edge drafts through selection and latest advancement, counts only displayed pending comments and links back", async () => {
		vi.mocked(BoardClient.read).mockResolvedValueOnce(view([1], { 1: [comment] }))
		render(<Board taskId="owner" />)
		await screen.findByText("Version 1")
		fireEvent.change(screen.getByLabelText("General comment"), { target: { value: "General draft" } })
		fireEvent.change(screen.getByLabelText("Inspect element"), { target: { value: "node:a" } })
		fireEvent.change(screen.getByLabelText("Node comment"), { target: { value: "Node draft" } })
		fireEvent.change(screen.getByLabelText("Inspect element"), { target: { value: "edge:e" } })
		fireEvent.change(screen.getByLabelText("Edge comment"), { target: { value: "Edge draft" } })
		expect(BoardClient.mutateComment).not.toHaveBeenCalled()
		const next = view([2])
		next.panes[0].pendingReviewsJson = '[{"version":1,"count":1}]'
		await changeView(next)
		expect(screen.getByText(/Pending comments in displayed scope: 0/)).toBeInTheDocument()
		expect(screen.getByLabelText("General comment")).toHaveValue("")
		vi.mocked(BoardClient.read).mockResolvedValueOnce(view([1], { 1: [comment] }))
		fireEvent.click(screen.getByRole("button", { name: "tools v1 (1 pending)" }))
		await waitFor(() => expect(screen.getByLabelText("General comment")).toHaveValue("General draft"))
		expect(BoardClient.read).toHaveBeenLastCalledWith("owner", false, {
			taskId: "owner",
			name: "tools",
			version: 1,
			mode: "exact",
		})
		fireEvent.change(screen.getByLabelText("Inspect element"), { target: { value: "node:a" } })
		expect(screen.getByLabelText("Node comment")).toHaveValue("Node draft")
		fireEvent.change(screen.getByLabelText("Inspect element"), { target: { value: "edge:e" } })
		expect(screen.getByLabelText("Edge comment")).toHaveValue("Edge draft")
	})
	it("saves comparison comments only to their pane, retains failed text, and distinguishes committed comments from drafts", async () => {
		vi.mocked(BoardClient.read).mockResolvedValueOnce(view([2, 1], { 1: [comment, { ...comment, id: "sent", sent: true }] }))
		render(<Board taskId="owner" />)
		const left = within(await screen.findByRole("region", { name: "Left version 2" }))
		const right = within(screen.getByRole("region", { name: "Right version 1" }))
		expect(screen.getByText(/Pending comments in displayed scope: 1/)).toBeInTheDocument()
		fireEvent.change(left.getByLabelText("General comment"), { target: { value: "Left only" } })
		vi.mocked(BoardClient.mutateComment).mockRejectedValueOnce(new Error("disk full"))
		fireEvent.click(left.getByRole("button", { name: "Save comment" }))
		await left.findByText("Comment not saved: disk full")
		expect(left.getByLabelText("General comment")).toHaveValue("Left only")
		vi.mocked(BoardClient.mutateComment).mockResolvedValueOnce([{ ...comment, text: "Left only" }])
		fireEvent.click(left.getByRole("button", { name: "Retry comment save" }))
		await waitFor(() => expect(left.getByLabelText("General comment")).toHaveValue(""))
		expect(BoardClient.mutateComment).toHaveBeenLastCalledWith(
			expect.objectContaining({ identity: { taskId: "owner", name: "tools", version: 2 } }),
		)
		expect(right.queryByText("Left only")).toBeNull()
		expect(screen.getByText(/Pending comments in displayed scope: 2/)).toBeInTheDocument()
		expect(right.getAllByRole("button", { name: "Edit comment" })).toHaveLength(1)
		expect(right.getByText(/Submitted comments are immutable/)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Send Feedback · 2" })).toBeEnabled()
	})
	it("edits and deletes only pending comments, renders text safely and never counts drafts", async () => {
		vi.mocked(BoardClient.read).mockResolvedValueOnce(view([1], { 1: [comment] }))
		render(<Board taskId="owner" />)
		fireEvent.click(await screen.findByRole("button", { name: "Edit comment" }))
		fireEvent.change(screen.getByLabelText("Edit general comment"), { target: { value: "<script>unsafe()</script>" } })
		vi.mocked(BoardClient.mutateComment).mockResolvedValueOnce([{ ...comment, text: "<script>unsafe()</script>" }])
		fireEvent.click(screen.getByRole("button", { name: "Save comment" }))
		await screen.findByText("<script>unsafe()</script>")
		expect(document.querySelector("script")).toBeNull()
		expect(BoardClient.mutateComment).toHaveBeenCalledWith({
			identity: { taskId: "owner", name: "tools", version: 1 },
			operation: "edit_comment",
			commentId: "c",
			text: "<script>unsafe()</script>",
		})
		vi.mocked(BoardClient.mutateComment).mockResolvedValueOnce([])
		fireEvent.click(screen.getByRole("button", { name: "Delete comment" }))
		await waitFor(() => expect(screen.queryByText("<script>unsafe()</script>")).toBeNull())
		expect(screen.getByText(/Pending comments in displayed scope: 0/)).toBeInTheDocument()
	})
	it("does not present corrupt review state as empty saved comments and shows non-color status badges", async () => {
		const broken = view([1])
		broken.panes[0].commentsJson = undefined
		broken.panes[0].reviewError = "Corrupt review"
		vi.mocked(BoardClient.read).mockResolvedValueOnce(broken)
		render(<Board taskId="owner" />)
		await screen.findByText(/Corrupt review/)
		fireEvent.change(screen.getByLabelText("General comment"), { target: { value: "Keep draft" } })
		expect(screen.getByRole("button", { name: "Save comment" })).toBeDisabled()
		expect(screen.getByText(/Pending comments in displayed scope: unavailable/)).toBeInTheDocument()
		const counts = countTargetComments(
			[comment, { ...comment, id: "sent", sent: true }, { ...comment, id: "node", target: { kind: "node", id: "a" } }],
			{ kind: "diagram" },
		)
		render(<CommentBadges counts={counts} />)
		expect(screen.getByText("Pending: 1")).toBeInTheDocument()
		expect(screen.getByText("Submitted: 1")).toBeInTheDocument()
	})
})
