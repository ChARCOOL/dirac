import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReviewComment } from "@shared/architecture"
import { CommentReviews } from "./CommentReviews"
import { BoardClient } from "./boardClient"
vi.mock("./boardClient", () => ({ BoardClient: { mutateComment: vi.fn() } }))
const identity = { taskId: "owner", name: "tools", version: 1 }
const target = { kind: "node", id: "a" } as const
const old: ReviewComment = { id: "c", target, text: "Saved", sent: false }
const create = () => {
	const reviews = new CommentReviews()
	reviews.hydrate(identity, [old], reviews.readEpoch())
	return reviews
}
describe("Local comment composers and saves", () => {
	beforeEach(() => {
		vi.mocked(BoardClient.mutateComment).mockReset()
	})
	it("retains separate version/target/name drafts and never sends composer text automatically", () => {
		const reviews = create()
		for (const owner of [identity, { ...identity, version: 2 }, { ...identity, name: "another" }]) {
			reviews.hydrate(owner, [], reviews.readEpoch())
			reviews.compose(owner, target, `${owner.name} ${owner.version} node`)
			reviews.compose(owner, { kind: "edge", id: "a" }, "Edge draft")
			reviews.compose(owner, { kind: "diagram" }, "General draft")
		}
		expect(reviews.getSnapshot()).toHaveLength(3)
		for (const entry of reviews.getSnapshot()) expect(entry.drafts).toHaveLength(3)
		expect(BoardClient.mutateComment).not.toHaveBeenCalled()
		reviews.hydrate(identity, [], reviews.readEpoch())
		expect(reviews.get(identity)!.drafts[0].text).toBe("tools 1 node")
	})
	it("keeps failed saves editable, retries the same comment ID and clears only the acknowledged draft", async () => {
		const reviews = create()
		reviews.compose(identity, target, "New")
		reviews.compose(identity, { kind: "diagram" }, "Unfinished")
		const draft = reviews.get(identity)!.drafts[0]
		vi.mocked(BoardClient.mutateComment).mockRejectedValueOnce(new Error("disk full"))
		await reviews.save(identity, draft.id)
		expect(reviews.get(identity)!.drafts[0]).toMatchObject({ text: "New", status: "error", error: "disk full" })
		expect(reviews.get(identity)!.comments).toEqual([old])
		vi.mocked(BoardClient.mutateComment).mockResolvedValueOnce([old, { id: draft.id, target, text: "New", sent: false }])
		await reviews.save(identity, draft.id)
		expect(BoardClient.mutateComment).toHaveBeenNthCalledWith(2, {
			identity,
			operation: "add_comment",
			comment: { id: draft.id, target, text: "New" },
		})
		expect(reviews.get(identity)!.drafts.map((entry) => entry.text)).toEqual(["Unfinished"])
		expect(reviews.get(identity)!.comments).toHaveLength(2)
	})
	it("blocks duplicate saves and in-flight edits/discards while preserving other version drafts", async () => {
		const reviews = create()
		reviews.compose(identity, target, "New")
		const draft = reviews.get(identity)!.drafts[0]
		let finish!: (comments: ReviewComment[]) => void
		vi.mocked(BoardClient.mutateComment).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		const saving = reviews.save(identity, draft.id)
		await reviews.save(identity, draft.id)
		reviews.compose(identity, target, "Should not replace in-flight")
		reviews.discard(identity, draft.id)
		expect(reviews.get(identity)!.drafts[0].text).toBe("New")
		expect(BoardClient.mutateComment).toHaveBeenCalledTimes(1)
		finish([old])
		await saving
	})
	it("does not let stale board reads overwrite acknowledged mutations, even when a read starts during a save", async () => {
		const reviews = create()
		reviews.compose(identity, target, "Edited", old)
		const before = reviews.readEpoch()
		let finish!: (comments: ReviewComment[]) => void
		vi.mocked(BoardClient.mutateComment).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve
				}),
		)
		const saving = reviews.save(identity, old.id)
		const during = reviews.readEpoch()
		reviews.hydrate(identity, [], during)
		expect(reviews.get(identity)!.comments).toEqual([old])
		finish([{ ...old, text: "Edited" }])
		await saving
		for (const epoch of [before, during]) reviews.hydrate(identity, [old], epoch)
		expect(reviews.get(identity)!.comments![0].text).toBe("Edited")
	})
	it("retains failed deletions and supports retry without falsely removing a committed comment", async () => {
		const reviews = create()
		vi.mocked(BoardClient.mutateComment).mockRejectedValueOnce(new Error("denied"))
		reviews.delete(identity, old)
		await vi.waitFor(() => expect(reviews.get(identity)!.drafts[0].status).toBe("error"))
		expect(reviews.get(identity)!.comments).toEqual([old])
		vi.mocked(BoardClient.mutateComment).mockResolvedValueOnce([])
		await reviews.save(identity, old.id)
		expect(reviews.get(identity)!.comments).toEqual([])
	})
	it("does not edit or delete submitted comments, and retains drafts when reviews become unavailable", async () => {
		const reviews = create()
		const sent = { ...old, sent: true }
		reviews.hydrate(identity, [sent], reviews.readEpoch())
		reviews.compose(identity, target, "Forbidden", sent)
		reviews.delete(identity, sent)
		expect(reviews.get(identity)!.drafts).toEqual([])
		reviews.compose(identity, target, "Correction")
		reviews.hydrate(identity, undefined, reviews.readEpoch())
		await reviews.save(identity, reviews.get(identity)!.drafts[0].id)
		expect(reviews.get(identity)!.drafts[0].text).toBe("Correction")
		expect(BoardClient.mutateComment).not.toHaveBeenCalled()
	})
})
