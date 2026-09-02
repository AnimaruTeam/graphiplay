import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "@/app/App"
import { $resolvedTheme } from "@/models"
import "@/styles/global.css"
import "@/styles/standalone.css"

// Mirror the theme on <html> for the pre-paint script in index.html and the
// `theme-color` meta tags. Only the standalone page does this — the embeddable
// library never touches the host document.
$resolvedTheme.watch(t => {
    document.documentElement.dataset.theme = t
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
