import { attach, combine, createEffect, createEvent, createStore, sample } from "effector"
import {
    type GraphQLSchema,
    type IntrospectionQuery,
    buildClientSchema,
    printSchema,
} from "graphql"

import { kv, workspaceKey } from "@/shared/db"
import { introspectEndpoint, mergeHeaders } from "@/shared/lib/graphql"

import { $persistentHeaders, $workspaceUrl } from "./endpoint"
import { toastShown } from "./ui"

export const fetchSchema = createEvent()
export const schemaCleared = createEvent()

export const $schema = createStore<GraphQLSchema | null>(null)
export const $sdl = createStore("")
export const $schemaError = createStore<string | null>(null)
export const $schemaFetchedAt = createStore<number | null>(null)
export const $schemaUrl = createStore<string | null>(null)

const introspectFx = createEffect(
    async ({ url, headers }: { url: string; headers: Record<string, string> }) => {
        const result = await introspectEndpoint(url, headers)
        return { ...result, url, fetchedAt: Date.now() }
    },
)

export const fetchSchemaFx = attach({
    source: { url: $workspaceUrl, headers: $persistentHeaders },
    effect: introspectFx,
    mapParams: (_: void, { url, headers }) => ({ url: url.trim(), headers: mergeHeaders(headers) }),
})

export const $schemaLoading = fetchSchemaFx.pending

sample({ clock: fetchSchema, target: fetchSchemaFx })

// An introspection that finishes after the user moved to another endpoint is still
// cached (see below) but must not show up in the current workspace.
const schemaFetched = sample({
    clock: fetchSchemaFx.doneData,
    source: $workspaceUrl,
    filter: (current, { url }) => url === current,
    fn: (_, result) => result,
})

$schema.on(schemaFetched, (_, { schema }) => schema).reset(schemaCleared)
$sdl.on(schemaFetched, (_, { schema }) => printSchema(schema)).reset(schemaCleared)
$schemaError
    .on(fetchSchemaFx.failData, (_, e) => e.message)
    .on(schemaFetched, () => null)
    .reset(schemaCleared)
$schemaFetchedAt.on(schemaFetched, (_, { fetchedAt }) => fetchedAt).reset(schemaCleared)
$schemaUrl.on(schemaFetched, (_, { url }) => url).reset(schemaCleared)

// Cache introspection per endpoint so the schema is instantly available on reload
// and when switching back to a workspace.
interface CachedSchema {
    url: string
    fetchedAt: number
    introspection: IntrospectionQuery
}

const cacheSchemaFx = createEffect((c: CachedSchema) =>
    kv.set(workspaceKey("schemaCache", c.url), c),
)
sample({
    clock: fetchSchemaFx.doneData,
    fn: ({ url, fetchedAt, introspection }): CachedSchema => ({ url, fetchedAt, introspection }),
    target: cacheSchemaFx,
})

/** Orchestrated by models/workspace (boot and every switch). */
export const loadCachedSchemaFx = createEffect(async (url: string) => {
    const cached = await kv.get<CachedSchema | null>(workspaceKey("schemaCache", url), null)
    try {
        return {
            url,
            cached: cached ? { ...cached, schema: buildClientSchema(cached.introspection) } : null,
        }
    } catch {
        return { url, cached: null }
    }
})

// Drop results of a load that was overtaken by another switch.
const cacheLoaded = sample({
    clock: loadCachedSchemaFx.doneData,
    source: $workspaceUrl,
    filter: (current, { url }) => url === current,
    fn: (_, { cached }) => cached,
})
const cacheHit = sample({
    clock: cacheLoaded,
    filter: (c): c is NonNullable<typeof c> => c !== null,
})

$schema.on(cacheHit, (_, c) => c.schema)
$sdl.on(cacheHit, (_, c) => printSchema(c.schema))
$schemaError.on(cacheHit, () => null)
$schemaFetchedAt.on(cacheHit, (_, c) => c.fetchedAt)
$schemaUrl.on(cacheHit, (_, c) => c.url)

// Nothing cached for this endpoint: drop the previous workspace's schema and introspect.
sample({
    clock: cacheLoaded,
    filter: c => c === null,
    target: [schemaCleared, fetchSchema],
})

// --- polling -----------------------------------------------------------------
// Periodically re-introspects in the background. Unlike a manual reload it does
// not flip `$schemaLoading`, and it only swaps the schema when the SDL differs.

/** Poll interval options in seconds. */
export const SCHEMA_POLL_INTERVALS = [10, 30, 60, 300] as const
export type SchemaPollInterval = (typeof SCHEMA_POLL_INTERVALS)[number]

export const schemaPollingToggled = createEvent<boolean | void>()
export const schemaPollIntervalChanged = createEvent<SchemaPollInterval>()
const schemaPollTicked = createEvent()

export const $schemaPolling = createStore(false)
export const $schemaPollInterval = createStore<SchemaPollInterval>(30)

$schemaPolling.on(schemaPollingToggled, (v, next) => (typeof next === "boolean" ? next : !v))
$schemaPollInterval.on(schemaPollIntervalChanged, (_, v) => v)

const pollSchemaFx = attach({
    source: { url: $workspaceUrl, headers: $persistentHeaders, sdl: $sdl },
    effect: createEffect(
        async ({
            url,
            headers,
            sdl,
        }: {
            url: string
            headers: Record<string, string>
            sdl: string
        }) => {
            const result = await introspectEndpoint(url, headers)
            const nextSdl = printSchema(result.schema)
            return { ...result, sdl: nextSdl, url, fetchedAt: Date.now(), changed: nextSdl !== sdl }
        },
    ),
    mapParams: (_: void, { url, headers, sdl }) => ({
        url: url.trim(),
        headers: mergeHeaders(headers),
        sdl,
    }),
})

// Skip a tick while another introspection is in flight, the URL is empty, or the tab is hidden.
sample({
    clock: schemaPollTicked,
    source: { url: $workspaceUrl, fetching: fetchSchemaFx.pending, polling: pollSchemaFx.pending },
    filter: ({ url, fetching, polling }) =>
        !!url.trim() && !fetching && !polling && document.visibilityState === "visible",
    target: pollSchemaFx,
})

$schema.on(pollSchemaFx.doneData, (s, r) => (r.changed ? r.schema : s))
$sdl.on(pollSchemaFx.doneData, (s, r) => (r.changed ? r.sdl : s))
$schemaError.on(pollSchemaFx.failData, (_, e) => e.message).on(pollSchemaFx.done, () => null)
$schemaFetchedAt.on(pollSchemaFx.doneData, (_, { fetchedAt }) => fetchedAt)
$schemaUrl.on(pollSchemaFx.doneData, (_, { url }) => url)

sample({
    clock: pollSchemaFx.doneData,
    filter: ({ changed }) => changed,
    fn: ({ url, fetchedAt, introspection }): CachedSchema => ({ url, fetchedAt, introspection }),
    target: cacheSchemaFx,
})
sample({
    clock: pollSchemaFx.failData,
    fn: e => ({ title: "Schema polling failed", description: e.message, tone: "error" as const }),
    target: toastShown,
})

let pollTimer: ReturnType<typeof setInterval> | undefined
combine($schemaPolling, $schemaPollInterval, (enabled, interval) => (enabled ? interval : 0)).watch(
    interval => {
        clearInterval(pollTimer)
        if (interval > 0) pollTimer = setInterval(schemaPollTicked, interval * 1000)
    },
)

interface PollingSettings {
    enabled: boolean
    interval: SchemaPollInterval
}

export const loadSchemaPollingFx = createEffect(() =>
    kv.get<Partial<PollingSettings>>("schemaPolling", {}),
)
$schemaPolling.on(loadSchemaPollingFx.doneData, (s, p) => p.enabled ?? s)
$schemaPollInterval.on(loadSchemaPollingFx.doneData, (s, p) => p.interval ?? s)

const savePollingFx = createEffect((p: PollingSettings) => kv.set("schemaPolling", p))
const $pollingLoaded = createStore(false).on(loadSchemaPollingFx.done, () => true)
sample({
    clock: [$schemaPolling, $schemaPollInterval],
    source: { enabled: $schemaPolling, interval: $schemaPollInterval },
    filter: $pollingLoaded,
    target: savePollingFx,
})
