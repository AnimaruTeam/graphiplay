import react from "@vitejs/plugin-react"
import { URL, fileURLToPath } from "node:url"
import { defineConfig } from "vite"

import pkg from "./package.json"

/** Standalone playground page (index.html → site/). The library build is vite.lib.config.ts. */
export default defineConfig({
    plugins: [react()],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    define: { __GRAPHIPLAY_VERSION__: JSON.stringify(pkg.version) },
    build: { outDir: "site" },
})
