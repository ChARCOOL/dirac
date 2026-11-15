import { strict as assert } from "node:assert"
import { parseArchitectureSelection } from "./selection"
import { CardStatus, DiracMessageType, type DiracMessage } from "@shared/ExtensionMessage"
import { convertDiracMessageToProto, convertProtoToDiracMessage } from "@shared/proto-conversions/dirac-message"
import { DiracMessage as WireMessage } from "@shared/proto/dirac/ui"

describe("Persisted architecture card references", () => {
	for (const selection of [
		{ taskId: "owner", name: "tools", mode: "latest" },
		{ taskId: "owner", name: "tools", mode: "exact", version: 1 },
		{ taskId: "owner", name: "tools", mode: "comparison", startVersion: 2, endVersion: 1 },
	])
		it(`round trips ${selection.mode} through JSON persistence and protobuf without resolving latest`, () => {
			const reference = parseArchitectureSelection(selection)
			const message: DiracMessage = {
				id: "card",
				ts: 1,
				content: {
					type: DiracMessageType.CARD,
					card: {
						id: "card",
						header: "Architecture",
						renderType: "text",
						status: CardStatus.SUCCESS,
						architectureReference: reference,
					},
				},
			}
			const saved = JSON.parse(JSON.stringify(message))
			const wire = convertDiracMessageToProto(saved)
			const restored = convertProtoToDiracMessage(WireMessage.decode(WireMessage.encode(wire).finish()))
			assert.equal(restored.content.type, DiracMessageType.CARD)
			if (restored.content.type === DiracMessageType.CARD)
				assert.deepEqual(restored.content.card.architectureReference, selection)
		})

	it("corrupt optional navigation does not prevent ordinary transcript conversion", () => {
		const message: DiracMessage = {
			id: "card",
			ts: 1,
			content: {
				type: DiracMessageType.CARD,
				card: {
					id: "card",
					header: "Retained",
					renderType: "text",
					status: CardStatus.SUCCESS,
					architectureReference: { taskId: "../owner", name: "tools", mode: "latest" },
				},
			},
		}
		const restored = convertProtoToDiracMessage(convertDiracMessageToProto(message))
		assert.equal(restored.content.type, DiracMessageType.CARD)
		if (restored.content.type === DiracMessageType.CARD) {
			assert.equal(restored.content.card.header, "Retained")
			assert.equal(restored.content.card.architectureReference, undefined)
		}
	})

	for (const patch of [
		{ taskId: "../task" },
		{ name: "a/b" },
		{ mode: "unknown" },
		{ mode: "exact" },
		{ mode: "exact", version: 0 },
		{ mode: "exact", version: 2_147_483_648 },
		{ mode: "comparison", startVersion: 1 },
		{ command: "execute" },
		{ version: 1 },
	]) {
		it(`rejects malformed selection ${JSON.stringify(patch)}`, () => {
			assert.throws(() => parseArchitectureSelection({ taskId: "owner", name: "tools", mode: "latest", ...patch }))
		})
	}
})
