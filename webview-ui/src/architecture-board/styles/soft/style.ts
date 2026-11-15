import type { BoardStyle } from "../types"
import { boardGeometry } from "../boardGeometry"

export default {
	id: "soft",
	label: "Soft",
	order: 3,
	geometry: boardGeometry,
	edgeWidth: 1.05,
	dataDash: [1, 7],
	dependencyDash: [7, 5],
	messageDash: [8, 4, 1, 4],
} satisfies BoardStyle
