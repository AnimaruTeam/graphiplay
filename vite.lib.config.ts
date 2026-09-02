import react from "@vitejs/plugin-react"
import { URL, fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import dts from "vite-plugin-dts"

import pkg from "./package.json"

/**
 * Library build, two flavours picked by LIB_FORMAT:
 *   es   → dist/graphiplay.js       ESM for bundlers, React is a peer dependency
 *   iife → dist/graphiplay.min.js   self-contained script for CDN <script> tags, global `Graphiplay`
 * Both emit dist/graphiplay.css.
 */
const format = (process.env.LIB_FORMAT ?? "es") as "es" | "iife"
const cdn = format === "iife"

export default defineConfig({
    plugins: [
        react(),
        ...(cdn ? [] : [dts({ tsconfigPath: "./tsconfig.json", exclude: ["src/main.tsx"] })]),
    ],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    define: {
        __GRAPHIPLAY_VERSION__: JSON.stringify(pkg.version),
        // The IIFE bundle inlines React; make it the production build.
        ...(cdn ? { "process.env.NODE_ENV": '"production"' } : {}),
    },
    build: {
        outDir: "dist",
        emptyOutDir: !cdn,
        sourcemap: true,
        cssCodeSplit: false,
        lib: {
            entry: fileURLToPath(new URL("./src/lib.tsx", import.meta.url)),
            name: "Graphiplay",
            formats: [format],
            fileName: () => (cdn ? "graphiplay.min.js" : "graphiplay.js"),
            cssFileName: "graphiplay",
        },
        minify: cdn ? "esbuild" : false,
        rollupOptions: cdn
            ? {}
            : {
                  external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"],
                  output: {
                      globals: { react: "React", "react-dom": "ReactDOM" },
                  },
              },
    },
})
