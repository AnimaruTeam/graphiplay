import type { Extension } from "@codemirror/state"
import { ViewPlugin, closeHoverTooltips, hasHoverTooltips } from "@codemirror/view"

/**
 * Escape dismisses an open hover tooltip right away. Listens on the window rather than
 * through a keymap: hovering shows docs without focusing the editor, and the key is left
 * unhandled so it still closes the completion popup, a modal or the search panel.
 */
export const closeTooltipsOnEscape: Extension = ViewPlugin.define(view => {
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || !hasHoverTooltips(view.state)) return
        view.dispatch({ effects: closeHoverTooltips })
    }
    window.addEventListener("keydown", onKeyDown, true)
    return { destroy: () => window.removeEventListener("keydown", onKeyDown, true) }
})
