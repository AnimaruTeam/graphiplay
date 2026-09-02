import { attach, combine, createEffect, createEvent, createStore, sample } from "effector"
import { nanoid } from "nanoid"

import { db, kv, workspaceKey } from "@/shared/db"
import {
    DEFAULT_URL,
    type SubscriptionTransport,
    createHeader,
    normalizeEndpointUrl,
} from "@/shared/lib/graphql"
import type { Endpoint, HeaderEntry } from "@/shared/types"

/** Everything that is specific to one endpoint URL (besides tabs and collections). */
export interface WorkspaceSettings {
    wsUrl: string
    transport: SubscriptionTransport
    headers: HeaderEntry[]
}

const DEFAULT_WORKSPACE: WorkspaceSettings = { wsUrl: "", transport: "ws", headers: [] }

/** The URL input is a draft; `$url` follows every keystroke. */
export const urlChanged = createEvent<string>()
/** Apply the draft: the typed URL becomes the current workspace (Enter / blur in the URL bar). */
export const urlCommitted = createEvent()
export const wsUrlChanged = createEvent<string>()
export const transportChanged = createEvent<SubscriptionTransport>()

export const persistentHeaderAdded = createEvent()
export const persistentHeaderChanged = createEvent<{ id: string; patch: Partial<HeaderEntry> }>()
export const persistentHeaderRemoved = createEvent<string>()
export const persistentHeadersReplaced = createEvent<HeaderEntry[]>()

export const endpointSelected = createEvent<string>()
export const endpointDeleted = createEvent<string>()
export const endpointSaved = createEvent<{ name?: string } | void>()
/** Host-provided endpoint (library options) — replaces whatever was persisted last time. */
export const endpointConfigured = createEvent<string>()

export const $url = createStore(DEFAULT_URL)
/**
 * The committed endpoint URL (normalized). Tabs, collections, persistent headers,
 * subscription settings and the schema cache are scoped to it — switching it swaps
 * the whole workspace.
 */
export const $workspaceUrl = createStore(DEFAULT_URL)
/** Fired with the new URL when the user moves to a different workspace. */
export const workspaceSwitched = createEvent<string>()
export const $wsUrl = createStore("")
export const $transport = createStore<SubscriptionTransport>("ws")
export const $persistentHeaders = createStore<HeaderEntry[]>([])
export const $endpoints = createStore<Endpoint[]>([])

$url.on(urlChanged, (_, v) => v)
$wsUrl.on(wsUrlChanged, (_, v) => v)
$transport.on(transportChanged, (_, v) => v)

sample({
    clock: urlCommitted,
    source: { url: $url, current: $workspaceUrl },
    filter: ({ url, current }) => normalizeEndpointUrl(url) !== current,
    fn: ({ url }) => normalizeEndpointUrl(url),
    target: workspaceSwitched,
})
$workspaceUrl.on(workspaceSwitched, (_, url) => url)
$url.on(endpointConfigured, (_, url) => url)
$workspaceUrl.on(endpointConfigured, (_, url) => normalizeEndpointUrl(url))

$persistentHeaders
    .on(persistentHeaderAdded, list => [...list, createHeader()])
    .on(persistentHeaderChanged, (list, { id, patch }) =>
        list.map(h => (h.id === id ? { ...h, ...patch } : h)),
    )
    .on(persistentHeaderRemoved, (list, id) => list.filter(h => h.id !== id))
    .on(persistentHeadersReplaced, (_, list) => list)

// --- persistence -------------------------------------------------------------

// A never-visited URL borrows the snapshot of a saved endpoint with the same URL, if any.
async function readWorkspaceSettings(
    url: string,
    endpoints: Endpoint[],
): Promise<WorkspaceSettings> {
    const stored = await kv.get<WorkspaceSettings | null>(workspaceKey("settings", url), null)
    if (stored) return stored
    const saved = endpoints.find(e => normalizeEndpointUrl(e.url) === url)
    return saved
        ? {
              ...DEFAULT_WORKSPACE,
              wsUrl: saved.wsUrl ?? "",
              headers: saved.headers.map(h => ({ ...h })),
          }
        : DEFAULT_WORKSPACE
}

export const loadEndpointFx = createEffect(async () => {
    const [{ url }, endpoints] = await Promise.all([
        kv.get<{ url: string }>("endpoint", { url: DEFAULT_URL }),
        db.endpoints.orderBy("updatedAt").reverse().toArray(),
    ])
    return { url, endpoints }
})

$url.on(loadEndpointFx.doneData, (_, { url }) => url)
$workspaceUrl.on(loadEndpointFx.doneData, (_, { url }) => normalizeEndpointUrl(url))
$endpoints.on(loadEndpointFx.doneData, (_, { endpoints }) => endpoints)

/** Per-workspace part of the endpoint state; orchestrated by models/workspace. */
export const loadWorkspaceSettingsFx = attach({
    source: $endpoints,
    effect: async (endpoints, url: string) => ({
        url,
        settings: await readWorkspaceSettings(url, endpoints),
    }),
})

// Drop results of a load that was overtaken by another switch.
const settingsLoaded = sample({
    clock: loadWorkspaceSettingsFx.doneData,
    source: $workspaceUrl,
    filter: (current, { url }) => url === current,
    fn: (_, { settings }) => settings,
})
$wsUrl.on(settingsLoaded, (_, s) => s.wsUrl)
$transport.on(settingsLoaded, (_, s) => s.transport)
$persistentHeaders.on(settingsLoaded, (_, s) => s.headers)

const saveUrlFx = createEffect((url: string) => kv.set("endpoint", { url }))
const saveWorkspaceFx = createEffect(
    ({ url, settings }: { url: string; settings: WorkspaceSettings }) =>
        kv.set(workspaceKey("settings", url), settings),
)

// Pin whatever a fresh workspace started with (possibly a saved-endpoint snapshot),
// so it no longer depends on that endpoint entry staying around.
sample({
    clock: settingsLoaded,
    source: $workspaceUrl,
    fn: (url, settings) => ({ url, settings }),
    target: saveWorkspaceFx,
})

// Only the committed URL is persisted, so a half-typed draft doesn't survive a reload.
sample({
    clock: $workspaceUrl,
    filter: loadEndpointFx.pending.map(p => !p),
    target: saveUrlFx,
})

// While a switch is in flight the stores still hold the previous workspace — don't
// write them under the new URL. (`$settingsLoaded` covers the first boot.)
const $settingsLoaded = createStore(false).on(loadWorkspaceSettingsFx.done, () => true)
const $settingsLoading = combine(
    $settingsLoaded,
    loadWorkspaceSettingsFx.pending,
    (loaded, pending) => !loaded || pending,
)
sample({
    clock: [$wsUrl, $transport, $persistentHeaders],
    source: {
        url: $workspaceUrl,
        wsUrl: $wsUrl,
        transport: $transport,
        headers: $persistentHeaders,
    },
    filter: $settingsLoading.map(p => !p),
    fn: ({ url, ...settings }) => ({ url, settings }),
    target: saveWorkspaceFx,
})

// --- saved endpoints ---------------------------------------------------------

const upsertEndpointFx = createEffect(async (e: Endpoint) => {
    await db.endpoints.put(e)
    return db.endpoints.orderBy("updatedAt").reverse().toArray()
})

const deleteEndpointFx = createEffect(async (id: string) => {
    await db.endpoints.delete(id)
    return db.endpoints.orderBy("updatedAt").reverse().toArray()
})

sample({
    clock: endpointSaved,
    source: {
        url: $workspaceUrl,
        wsUrl: $wsUrl,
        headers: $persistentHeaders,
        endpoints: $endpoints,
    },
    fn: ({ url, wsUrl, headers, endpoints }, payload): Endpoint => {
        const existing = endpoints.find(e => e.url === url)
        const now = Date.now()
        return {
            id: existing?.id ?? nanoid(10),
            url,
            wsUrl,
            name: (payload && payload.name) || existing?.name || prettyName(url),
            headers,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        }
    },
    target: upsertEndpointFx,
})

sample({ clock: endpointDeleted, target: deleteEndpointFx })

$endpoints.on([upsertEndpointFx.doneData, deleteEndpointFx.doneData], (_, list) => list)

// Selecting a saved endpoint just switches to its workspace; headers / ws settings
// come from that workspace (falling back to the saved snapshot on first visit).
sample({
    clock: endpointSelected,
    source: $endpoints,
    fn: (list, id) => list.find(e => e.id === id) ?? null,
}).watch(e => {
    if (!e) return
    urlChanged(e.url)
    urlCommitted()
})

function prettyName(url: string): string {
    try {
        return new URL(url).host
    } catch {
        return url
    }
}
