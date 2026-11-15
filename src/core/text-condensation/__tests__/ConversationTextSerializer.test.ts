import { strict as assert } from "node:assert"
import type { ContextManager } from "@core/context/context-management/ContextManager"
import type { MessageStateHandler } from "@core/task/message-state"
import { describe, it } from "mocha"
import type { DiracStorageMessage } from "@shared/messages/content"
import { ConversationCondensationService } from "../ConversationCondensationService"
import { ConversationTextSerializer } from "../ConversationTextSerializer"
import type { TextCondenser, TextCondensationOptions, TextStream } from "../TextCondenser"

async function collectText(stream: TextStream): Promise<string> {
	let output = ""
	for await (const chunk of stream) output += chunk
	return output
}

function createService(
	history: DiracStorageMessage[],
	condenser: TextCondenser,
	deletedRange: [number, number] = [1, 1],
): ConversationCondensationService {
	return new ConversationCondensationService({
		messageState: { getApiConversationHistory: () => history } as Pick<MessageStateHandler, "getApiConversationHistory">,
		contextManager: {
			getTruncatedMessages(messages) {
				return [messages[0], messages.at(-1)]
			},
		} as Pick<ContextManager, "getTruncatedMessages">,
		getConversationHistoryDeletedRange: () => deletedRange,
		textCondenser: condenser,
	})
}

describe("ConversationTextSerializer", () => {
	it("serializes roles, text, structured tool calls and tool results without reasoning or provider metadata", () => {
		const serializer = new ConversationTextSerializer()
		const output = serializer.serialize([
			{ role: "user", content: "Please inspect the repository." },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "private reasoning", signature: "provider-signature" },
					{ type: "text", text: "I will inspect it.", signature: "provider-signature" },
					{
						type: "tool_use",
						id: "tool-1",
						name: "read_file",
						input: { z: { b: 2, a: 1 }, a: [2, 1] },
						call_id: "opaque-call-id",
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-1",
						is_error: true,
						content: [{ type: "text", text: "file contents" }],
					},
				],
			},
		] as DiracStorageMessage[])

		assert.ok(output.indexOf("=== MESSAGE 1: USER ===") < output.indexOf("=== MESSAGE 2: ASSISTANT ==="))
		assert.ok(output.indexOf("=== MESSAGE 2: ASSISTANT ===") < output.indexOf("=== MESSAGE 3: USER ==="))
		assert.match(output, /\[text length=30\]\nPlease inspect the repository\.\n\[\/text\]/)
		assert.match(output, /\{"id":"tool-1","input":\{"a":\[2,1\],"z":\{"a":1,"b":2\}\},"name":"read_file"\}/)
		assert.match(output, /\{"is_error":true,"tool_use_id":"tool-1"\}/)
		assert.ok(!output.includes("private reasoning"))
		assert.ok(!output.includes("provider-signature"))
		assert.ok(!output.includes("opaque-call-id"))
	})

	it("replaces binary images and documents with bounded placeholders", () => {
		const serializer = new ConversationTextSerializer()
		const output = serializer.serialize([
			{
				role: "user",
				content: [
					{ type: "image", source: { type: "base64", media_type: "image/png", data: "base64-image" } },
					{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "base64-document" } },
				],
			},
		] as DiracStorageMessage[])

		assert.ok(output.includes("[image omitted: media_type=image/png]"))
		assert.ok(output.includes("[document body omitted: media_type=application/pdf]"))
		assert.ok(!output.includes("base64-image"))
		assert.ok(!output.includes("base64-document"))
	})


	it("represents a tool result without content deterministically", () => {
		const serializer = new ConversationTextSerializer()
		const output = serializer.serialize([
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tool-1" }],
			},
		] as DiracStorageMessage[])

		assert.ok(output.includes("[no tool result content]"))
	})

	it("uses effective history, preserves prior summaries, and atomically collects condensation output", async () => {
		const history: DiracStorageMessage[] = [
			{ role: "user", content: "original request" },
			{ role: "assistant", content: "discarded intermediate work" },
			{ role: "user", content: "prior continuation summary" },
		]
		let receivedSource = ""
		const condenser: TextCondenser = {
			condense(input: TextStream, _options: TextCondensationOptions): TextStream {
				return (async function* () {
					receivedSource = await collectText(input)
					yield "complete "
					yield "summary"
				})()
			},
		}
		const service = createService(history, condenser)

		assert.equal(
			await service.condenseConversation("conversation_continuation", { historyScope: "effective" }),
			"complete summary",
		)
		assert.ok(receivedSource.includes("original request"))
		assert.ok(receivedSource.includes("prior continuation summary"))
		assert.ok(!receivedSource.includes("discarded intermediate work"))
		assert.deepEqual(history, [
			{ role: "user", content: "original request" },
			{ role: "assistant", content: "discarded intermediate work" },
			{ role: "user", content: "prior continuation summary" },
		])
	})

	it("appends intent after complete history even when repeated compactions hide multiple transcript ranges", async () => {
		const history: DiracStorageMessage[] = [
			{ role: "user", content: "original task request" },
			{ role: "assistant", content: "work before first compaction" },
			{ role: "user", content: "first continuation summary" },
			{ role: "assistant", content: "work between compactions" },
			{ role: "user", content: "second continuation summary" },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "condense-call",
						name: "condense",
						input: { context: "latest condensation request" },
					},
				],
			},
		]
		let receivedSource = ""
		const condenser: TextCondenser = {
			condense(input: TextStream): TextStream {
				return (async function* () {
					receivedSource = await collectText(input)
					yield "summary"
				})()
			},
		}
		const service = createService(history, condenser, [1, 4])

		assert.equal(
			await service.condenseConversation("conversation_continuation", {
				historyScope: "complete",
				additionalSourceText:
					'=== CONTINUATION OBJECTIVE ===\n{"intent":"Implement the schema switch."}',
			}),
			"summary",
		)
		for (const marker of [
			"original task request",
			"work before first compaction",
			"first continuation summary",
			"work between compactions",
			"second continuation summary",
			"latest condensation request",
		]) {
			assert.ok(receivedSource.includes(marker), `Missing complete-history marker: ${marker}`)
		}
		assert.ok(receivedSource.indexOf("CONTINUATION OBJECTIVE") > receivedSource.indexOf("latest condensation request"))
		assert.ok(receivedSource.includes("Implement the schema switch."))
	})


	it("does not return partial output when the condenser fails", async () => {
		const failure = new Error("condenser failed")
		const condenser: TextCondenser = {
			condense(): TextStream {
				return (async function* () {
					yield "partial"
					throw failure
				})()
			},
		}
		const service = createService([{ role: "user", content: "source" }], condenser)

		await assert.rejects(
			() => service.condenseConversation("conversation_continuation", { historyScope: "effective" }),
			failure,
		)
	})
})
