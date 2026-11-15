import { strict as assert } from "node:assert"
import Mutex from "p-mutex"
import { TaskStatus } from "@shared/ExtensionMessage"
import { submitContextualInput, type TaskContextualInputContext } from "../TaskContextualInput"

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

function fixture() {
	const mutex = new Mutex()
	const writing = deferred()
	const releaseWrite = deferred()
	let responses = 0
	const ctx: TaskContextualInputContext = {
		taskState: {
			abort: false,
			status: TaskStatus.EXECUTING_TOOL,
			waitingCardIds: [],
			waitingForFollowUp: false,
			lastMessageTs: 1,
			steeringMessages: [],
		},
		messageStateHandler: {
			appendDurableUserMessage: async (_message, assertCurrent) => {
				assertCurrent()
				writing.resolve()
				await releaseWrite.promise
			},
		},
		taskMessenger: { generateId: () => "feedback" },
		withStateLock: (action) => mutex.withLock(action),
		postStateToWebview: () => {},
		canAcceptSteering: () => true,
		submitResponse: async () => {
			responses++
		},
	}
	return { ctx, writing, releaseWrite, responses: () => responses }
}

const input = { text: "Contextual review", references: ["source:comment"] }

// A stalled optional input must not prevent the existing cancellation/chat state transitions.
describe("Contextual input state-lock isolation", () => {
	it("allows cancellation under the real task mutex while persistence is stalled", async () => {
		const { ctx, writing, releaseWrite, responses } = fixture()
		const sending = submitContextualInput(ctx, input, { kind: "steering" }, () => {})
		await writing.promise
		try {
			await ctx.withStateLock(() => {
				ctx.taskState.abort = true
			})
			assert.equal(ctx.taskState.steeringMessages.length, 0)
		} finally {
			releaseWrite.resolve()
		}
		const result = await sending
		assert.equal(result.persisted, true)
		assert.match(result.warning!, /cancelled/)
		assert.equal(responses(), 0)
		assert.equal(ctx.taskState.steeringMessages.length, 0)
	})

	it("does not release a replacement follow-up after a late write", async () => {
		const { ctx, writing, releaseWrite, responses } = fixture()
		ctx.taskState.waitingForFollowUp = true
		const sending = submitContextualInput(ctx, input, { kind: "followup" }, () => {})
		await writing.promise
		ctx.taskState.lastMessageTs = 2
		releaseWrite.resolve()
		assert.match((await sending).warning!, /follow-up changed/)
		assert.equal(responses(), 0)
		assert.equal(ctx.taskState.steeringMessages.length, 0)
	})

	it("does not answer another card or consume the user's response after a late write", async () => {
		const { ctx, writing, releaseWrite, responses } = fixture()
		ctx.taskState.waitingCardIds = ["board"]
		ctx.taskState.lastWaitingCardId = "board"
		const sending = submitContextualInput(ctx, input, { kind: "interaction", cardId: "board" }, () => {})
		await writing.promise
		ctx.taskState.lastWaitingCardId = "approval"
		ctx.taskState.waitingCardIds = ["approval"]
		releaseWrite.resolve()
		assert.match((await sending).warning!, /interaction changed/)
		assert.equal(responses(), 0)
	})

	it("does not hold the task mutex during UI publication", async () => {
		const { ctx, releaseWrite } = fixture()
		const publishing = deferred()
		const releasePublication = deferred()
		ctx.postStateToWebview = async () => {
			publishing.resolve()
			await releasePublication.promise
		}
		releaseWrite.resolve()
		const sending = submitContextualInput(ctx, input, { kind: "steering" }, () => {})
		await publishing.promise
		try {
			await ctx.withStateLock(() => {
				ctx.taskState.abort = true
			})
		} finally {
			releasePublication.resolve()
		}
		assert.deepEqual(await sending, { persisted: true })
		assert.equal(ctx.taskState.steeringMessages.length, 1)
	})

	it("does not enqueue input or wake a waiter when persistence rejects", async () => {
		const { ctx, responses } = fixture()
		ctx.messageStateHandler.appendDurableUserMessage = async () => {
			throw new Error("disk full")
		}
		await assert.rejects(
			submitContextualInput(ctx, input, { kind: "steering" }, () => {}),
			/disk full/,
		)
		assert.equal(ctx.taskState.steeringMessages.length, 0)
		assert.equal(responses(), 0)
	})
})
