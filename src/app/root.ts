import { createContext, useContext } from "react"

/**
 * The element every instance renders into (`.graphiplay`). Overlays portal into it,
 * cursor classes go on it and the theme attribute lives on it — nothing leaks to
 * <body> or <html>, so the playground can be embedded into any page.
 */
export const RootContext = createContext<HTMLElement | null>(null)

export const useRoot = () => useContext(RootContext)

/** Root class name, also used as a global selector in `global.css`. */
export const ROOT_CLASS = "graphiplay"
