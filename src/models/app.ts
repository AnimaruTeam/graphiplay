import { createEffect, createStore } from "effector"

import { createHeader } from "@/shared/lib/graphql"

import {
    $workspaceUrl,
    endpointConfigured,
    loadEndpointFx,
    persistentHeadersReplaced,
    wsUrlChanged,
} from "./endpoint"
import { loadHistoryFx } from "./history"
import { loadSchemaPollingFx } from "./schema"
import { $tabs, WELCOME_QUERY, tabAdded, tabClosed } from "./tabs"
import { type ThemeSetting, loadLayoutFx, loadThemeFx, themeChanged } from "./ui"
import { loadWorkspaceFx } from "./workspace"

/** Host-provided settings (library options). Everything is optional — persisted state fills the rest. */
export interface StartOptions {
    /** GraphQL endpoint to open. Overrides the last used one. */
    endpoint?: string
    /** Persistent headers for that endpoint (sent with every request and introspection). */
    headers?: Record<string, string>
    /** WebSocket URL for subscriptions (defaults to the endpoint with ws(s):// scheme). */
    wsUrl?: string
    /** "light" | "dark" | "system". Overrides the persisted choice. */
    theme?: ThemeSetting
    /** Opened in a new tab when the workspace has no operations yet. */
    defaultQuery?: string
    /** JSON string with variables for `defaultQuery`. */
    defaultVariables?: string
}

export const appStarted = createEffect(async (options: StartOptions | void) => {
    const o = options ?? {}
    // Endpoint settings decide which workspace to open, so they come first.
    await Promise.all([
        loadEndpointFx(),
        loadHistoryFx(),
        loadLayoutFx(),
        loadThemeFx(),
        loadSchemaPollingFx(),
    ])
    if (o.theme) themeChanged(o.theme)
    if (o.endpoint) endpointConfigured(o.endpoint)
    await loadWorkspaceFx($workspaceUrl.getState())
    if (o.wsUrl !== undefined) wsUrlChanged(o.wsUrl)
    if (o.headers) {
        persistentHeadersReplaced(Object.entries(o.headers).map(([k, v]) => createHeader(k, v)))
    }
    if (o.defaultQuery !== undefined) seedTab(o.defaultQuery, o.defaultVariables)
})

/** Put the host's query into the workspace unless the user already has something there. */
function seedTab(query: string, variables?: string) {
    const tabs = $tabs.getState()
    if (tabs.some(t => t.query.trim() !== "" && t.query !== WELCOME_QUERY)) return
    tabAdded({ query, variables: variables ?? "{}" })
    for (const t of tabs) tabClosed(t.id)
}

export const $appReady = createStore(false).on(appStarted.finally, () => true)
