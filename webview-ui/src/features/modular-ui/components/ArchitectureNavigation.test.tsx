import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CardStatus } from "@shared/ExtensionMessage"
import { BoardClient } from "@/architecture-board/boardClient"
import { ModularCardHeader } from "./ModularCardHeader"

vi.mock("@/shared/api/grpc-client", () => ({ FileServiceClient: {} }))
vi.mock("@/architecture-board/boardClient", () => ({ BoardClient: { open: vi.fn() } }))

describe("Persistent architecture navigation", () => {
	for (const status of [CardStatus.WAITING_FOR_INPUT, CardStatus.SUCCESS, CardStatus.CANCELLED, CardStatus.SKIPPED]) {
		it(`opens from a collapsed ${status} card without answering or toggling it`, async () => {
			vi.mocked(BoardClient.open).mockResolvedValue({})
			const onAction = vi.fn(),
				toggle = vi.fn()
			const selection = { taskId: "old-task", name: "tools", mode: "latest" as const }
			render(
				<ModularCardHeader
					card={{ id: "card", header: "Architecture", renderType: "text", status, architectureReference: selection }}
					contentId="body"
					isCollapsed
					onToggleCollapse={toggle}
					onAction={onAction}
				/>,
			)
			fireEvent.click(screen.getByRole("button", { name: "Open diagram" }))
			await waitFor(() => expect(BoardClient.open).toHaveBeenCalledWith(selection))
			expect(onAction).not.toHaveBeenCalled()
			expect(toggle).not.toHaveBeenCalled()
		})
	}
	it("reports navigation errors locally, keeping the action available for retry", async () => {
		vi.mocked(BoardClient.open).mockRejectedValue(new Error("owner deleted"))
		render(
			<ModularCardHeader
				card={{
					id: "card",
					header: "Architecture",
					renderType: "text",
					status: CardStatus.SUCCESS,
					architectureReference: { taskId: "old", name: "tools", mode: "comparison", startVersion: 1, endVersion: 2 },
				}}
				contentId="body"
				isCollapsed
				onToggleCollapse={vi.fn()}
			/>,
		)
		fireEvent.click(screen.getByRole("button", { name: "Open comparison" }))
		expect(await screen.findByRole("alert")).toHaveTextContent("owner deleted")
		expect(screen.getByRole("button", { name: "Open comparison" })).toBeEnabled()
	})
})
