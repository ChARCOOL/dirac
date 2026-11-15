import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReviewComment } from "@shared/architecture"
import type { ArchitectureBoardView, ArchitectureFeedbackResult } from "@shared/proto/dirac/architecture"
import { CommentReviews } from "./CommentReviews"
import { BoardClient } from "./boardClient"
import { SendFeedback } from "./SendFeedback"

vi.mock("./boardClient", () => ({ BoardClient: { mutateComment: vi.fn(), submitFeedback: vi.fn() } }))
const identity = { taskId: "owner", name: "tools", version: 1 }
const target = { kind: "diagram" } as const
const comment: ReviewComment = { id: "saved", target, text: "Saved", sent: false }
const view = (versions: number[]): ArchitectureBoardView => ({
	panes: versions.map((version) => ({ name: "tools", version, title: "Tools", summary: "Review", diagramJson: "{}" })),
})
const create = () => {
	const reviews = new CommentReviews()
	for (const version of [1, 2, 3]) reviews.hydrate({ ...identity, version }, [comment], reviews.readEpoch())
	return reviews
}
const deferred = <T,>() => {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

describe("Explicit feedback submission", () => {
	beforeEach(() => {
		vi.mocked(BoardClient.mutateComment).mockReset()
		vi.mocked(BoardClient.submitFeedback).mockReset()
	})
	it("waits for in-flight saves, freezes the batch and excludes unfinished composers", async () => {
		const reviews = create()
		reviews.compose(identity, target, "Saving")
		const draft = reviews.get(identity)!.drafts[0]
		const saved = deferred<ReviewComment[]>()
		vi.mocked(BoardClient.mutateComment).mockReturnValueOnce(saved.promise)
		const saving = reviews.save(identity, draft.id)
		reviews.compose(identity, { kind: "node", id: "a" }, "Unfinished")
		const accepted = deferred<ArchitectureFeedbackResult>()
		vi.mocked(BoardClient.submitFeedback).mockReturnValueOnce(accepted.promise)
		const submitting = reviews.submit([identity])
		expect(BoardClient.submitFeedback).not.toHaveBeenCalled()
		expect(reviews.get(identity)!.frozen).toBe(true)
		reviews.compose(identity, target, "Forbidden edit", comment)
		reviews.delete(identity, comment)
		await expect(reviews.submit([identity])).rejects.toThrow(/wait/)
		saved.resolve([comment, { ...comment, id: draft.id, text: "Saving" }])
		await saving
		await vi.waitFor(() => expect(BoardClient.submitFeedback).toHaveBeenCalledWith([identity]))
		expect(BoardClient.mutateComment).toHaveBeenCalledTimes(1)
		accepted.resolve({ submittedCount: 2 })
		await submitting
		expect(reviews.get(identity)!.comments!.every((entry) => entry.sent)).toBe(true)
		expect(reviews.get(identity)!.drafts.map((entry) => entry.text)).toEqual(["Unfinished"])
		expect(reviews.get({ ...identity, version: 2 })!.comments![0].sent).toBe(false)
		expect(reviews.get(identity)!.frozen).toBe(false)
	})
	it("retains failed saves and pending edits without submitting their old saved content", async () => {
		const reviews = create()
		reviews.compose(identity, target, "Edited", comment)
		await expect(reviews.submit([identity])).rejects.toThrow(/Finish or discard/)
		vi.mocked(BoardClient.mutateComment).mockRejectedValueOnce(new Error("disk full"))
		const saving = reviews.save(identity, comment.id)
		const submitting = reviews.submit([identity])
		await saving
		await expect(submitting).rejects.toThrow(/failed saves/)
		expect(reviews.get(identity)!.drafts[0]).toMatchObject({ text: "Edited", status: "error" })
		expect(BoardClient.submitFeedback).not.toHaveBeenCalled()
		expect(reviews.get(identity)!.frozen).toBe(false)
	})
	it("retains pending comments on failure and ignores stale reads after confirmed acceptance", async () => {
		const reviews = create()
		vi.mocked(BoardClient.submitFeedback).mockRejectedValueOnce(new Error("Resume owner"))
		await expect(reviews.submit([identity])).rejects.toThrow(/Resume/)
		expect(reviews.get(identity)!.comments![0].sent).toBe(false)
		const epoch = reviews.readEpoch()
		vi.mocked(BoardClient.submitFeedback).mockResolvedValueOnce({ submittedCount: 1, warning: "Persisted; refresh review" })
		expect((await reviews.submit([identity])).warning).toMatch(/Persisted/)
		reviews.hydrate(identity, [comment], epoch)
		expect(reviews.get(identity)!.comments![0].sent).toBe(true)
	})
	it("deduplicates identical comparison versions and blocks duplicate clicks until acceptance", async () => {
		const reviews = create()
		const accepted = deferred<ArchitectureFeedbackResult>()
		vi.mocked(BoardClient.submitFeedback).mockReturnValueOnce(accepted.promise)
		const refresh = vi.fn().mockResolvedValue(undefined)
		render(<SendFeedback taskId="owner" view={view([1, 1])} reviews={reviews} disabled={false} refresh={refresh} />)
		const button = screen.getByRole("button", { name: "Send Feedback · 1" })
		fireEvent.click(button)
		fireEvent.click(button)
		await waitFor(() => expect(BoardClient.submitFeedback).toHaveBeenCalledTimes(1))
		expect(BoardClient.submitFeedback).toHaveBeenCalledWith([identity])
		expect(screen.getByRole("button", { name: "Submitting feedback…" })).toBeDisabled()
		await act(async () => accepted.resolve({ submittedCount: 1 }))
		expect(await screen.findByText(/1 comment\(s\) submitted/)).toBeInTheDocument()
		expect(refresh).toHaveBeenCalledTimes(1)
		expect(screen.getByRole("button", { name: "Send Feedback" })).toBeDisabled()
	})
	it("submits a captured comparison scope even if the panel navigates while accepting", async () => {
		const reviews = create()
		const accepted = deferred<ArchitectureFeedbackResult>()
		vi.mocked(BoardClient.submitFeedback).mockReturnValueOnce(accepted.promise)
		const props = { taskId: "owner", reviews, disabled: false, refresh: vi.fn().mockResolvedValue(undefined) }
		const { rerender } = render(<SendFeedback {...props} view={view([2, 1])} />)
		fireEvent.click(screen.getByRole("button", { name: "Send Feedback · 2" }))
		rerender(<SendFeedback {...props} view={view([3])} />)
		await waitFor(() => expect(BoardClient.submitFeedback).toHaveBeenCalledWith([{ ...identity, version: 2 }, identity]))
		await act(async () => accepted.resolve({ submittedCount: 2 }))
		expect(reviews.get({ ...identity, version: 3 })!.comments![0].sent).toBe(false)
		expect(screen.getByRole("button", { name: "Send Feedback · 1" })).toBeEnabled()
	})
	it("disables unavailable or stale reviews, reports failures and refreshes before retry", async () => {
		const reviews = create()
		const props = { taskId: "owner", reviews, view: view([1]), refresh: vi.fn().mockResolvedValue(undefined) }
		const { rerender } = render(<SendFeedback {...props} disabled />)
		expect(screen.getByRole("button", { name: "Send Feedback · 1" })).toBeDisabled()
		rerender(<SendFeedback {...props} disabled={false} />)
		vi.mocked(BoardClient.submitFeedback).mockRejectedValueOnce(new Error("Unrelated permission"))
		fireEvent.click(screen.getByRole("button", { name: "Send Feedback · 1" }))
		expect(await screen.findByRole("alert")).toHaveTextContent(/not confirmed.*Unrelated permission/)
		expect(props.refresh).toHaveBeenCalledTimes(1)
		expect(reviews.get(identity)!.comments![0].sent).toBe(false)
		act(() => reviews.hydrate(identity, undefined, reviews.readEpoch()))
		expect(screen.getByRole("button", { name: "Send Feedback" })).toBeDisabled()
		expect(screen.getByRole("button", { name: "Dismiss" })).toBeEnabled()
	})
})
