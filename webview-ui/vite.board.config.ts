import { defineConfig } from "vite"
import react from "@vitejs/plugin-react-swc"
import { resolve } from "node:path"

// A separate build, not an import in the inline chat application.
export default defineConfig({
	plugins: [react()],
	// Library-mode Vite leaves NODE_ENV untouched; this is a browser application with no Node globals.
	define: { __PLATFORM__: JSON.stringify("vscode"), "process.env.NODE_ENV": JSON.stringify("production") },
	resolve: { alias: { "@": resolve(__dirname, "src"), "@shared": resolve(__dirname, "../src/shared") } },
	build: {
		outDir: "build/architecture-board",
		emptyOutDir: true,
		lib: {
			entry: resolve(__dirname, "src/architecture-board/main.tsx"),
			formats: ["es"],
			fileName: () => "board.js",
			cssFileName: "board",
		},
		rollupOptions: { output: { inlineDynamicImports: true } },
	},
})
