import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "@/app/App"
import { $resolvedTheme } from "@/models"
import "@/styles/global.css"
import "@/styles/standalone.css"

/**
 * What the browser's own bars should be painted with — mirrors `--surface` in global.css and
 * the pre-paint script in index.html. Not `--bg`: the status bar and the toolbar sit directly
 * against the top bar and the phone rail, and those are surfaces.
 */
const CHROME_BG = { light: "#ffffff", dark: "#1a1a1d" }

// Mirror the theme on <html> for the pre-paint script in index.html, and follow it with
// `theme-color` so Safari paints the status bar and toolbars to match the app instead of
// its own default. Only the standalone page does this — the embeddable library never
// touches the host document.
$resolvedTheme.watch(t => {
    document.documentElement.dataset.theme = t
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", CHROME_BG[t])
    try {
        localStorage.setItem("gp-theme", t)
    } catch {
        /* private mode */
    }
})

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <App globalShortcuts />
    </StrictMode>,
)
