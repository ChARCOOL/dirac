import "elkjs/lib/elk-worker.min.js"
import type { ElkNode } from "elkjs/lib/elk-api"
import type { LayoutInput, LayoutOutput } from "./layoutGraph"
import { arrangeCandidates } from "./layoutCandidates"
import { routeLayout } from "./routeLayout"
import { measureLayout } from "./layoutQuality"
import { resolveBoardStyle } from "./styles/catalog"

interface ElkRequest {
	id: number
	cmd: "register" | "layout"
	algorithms?: string[]
	graph?: ElkNode
}
interface ElkReply {
	data?: ElkNode
	error?: { message?: string } | string
}
interface LayoutWorkerScope {
	onmessage: (event: MessageEvent<LayoutInput | ElkRequest>) => void
	postMessage: (reply: ElkReply | { result: LayoutOutput } | { error: string }) => void
}
const scope = self as unknown as LayoutWorkerScope

// elk-worker installs a synchronous native dispatcher. Adapt that protocol locally so
// candidate construction, geometry checks and cleanup stay in this SAME killable worker.
// Do not instantiate elk.bundled here: its in-process Worker shim is unavailable in workers.
const dispatchElk = scope.onmessage
const publish = scope.postMessage.bind(scope)
let reply: ElkReply
scope.postMessage = (message) => {
	reply = message as ElkReply
}
function callElk(request: ElkRequest): ElkReply {
	dispatchElk.call(scope, { data: request } as MessageEvent<ElkRequest>)
	if (reply.error) throw new Error(typeof reply.error === "string" ? reply.error : (reply.error.message ?? String(reply.error)))
	return reply
}

scope.onmessage = (event) => {
	try {
		const input = event.data as LayoutInput
		const { geometry } = resolveBoardStyle(input.styleId)
		let result: LayoutOutput
		if (input.fixedLayout) {
			const routed = routeLayout(input.diagram, input.fixedLayout, true, geometry)
			const quality = measureLayout(input.diagram, routed.layout, geometry)
			if (quality.invalid) throw new Error(quality.invalid)
			result = {
				...routed.layout,
				diagnostics: { selected: "fixed", candidates: [{ id: "fixed", ...routed.metrics, ...quality }] },
			}
		} else {
			callElk({ id: 0, cmd: "register", algorithms: ["layered"] })
			result = arrangeCandidates(input, (graph) => callElk({ id: 1, cmd: "layout", graph }).data!)
		}
		publish({ result })
	} catch (error) {
		publish({ error: error instanceof Error ? error.message : String(error) })
	}
}
