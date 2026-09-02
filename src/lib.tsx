/**
 * Library entry. Two ways in:
 *
 *   import { Graphiplay } from "graphiplay"          // React component
 *   Graphiplay.mount(el, { endpoint })               // CDN / vanilla — global `Graphiplay`
 *
 * One playground per page: state lives in module-level effector stores and IndexedDB.
 */
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "@/app/App"
import type { StartOptions } from "@/models"
import "@/styles/global.css"

export type { StartOptions as GraphiplayOptions }
export type { ThemeSetting } from "@/models"

export interface GraphiplayProps extends StartOptions {
    /**
     * Fire ⌘K / ⌘↵ / ⌘B… wherever the focus is on the page. Off by default: shortcuts
     * only work while the focus is inside the playground.
     */
    globalShortcuts?: boolean
}

/** React component. Options are read once, on mount. */
export function Graphiplay({ globalShortcuts, ...options }: GraphiplayProps) {
    return <App options={options} globalShortcuts={globalShortcuts} />
}

export interface GraphiplayInstance {
    /** Tear the playground down and empty the container. */
    unmount: () => void
}

/** Render into `container` (an element or a CSS selector). Returns a handle to unmount. */
export function mount(
    container: HTMLElement | string,
    options: GraphiplayProps = {},
): GraphiplayInstance {
    const el = typeof container === "string" ? document.querySelector(container) : container
    if (!(el instanceof HTMLElement)) {
        throw new Error(`Graphiplay.mount: container not found (${String(container)})`)
    }
    const root = createRoot(el)
    root.render(
        <StrictMode>
            <Graphiplay {...options} />
        </StrictMode>,
    )
    return { unmount: () => root.unmount() }
}

export const version: string = __GRAPHIPLAY_VERSION__
