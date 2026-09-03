import { createEffect, createEvent, createStore, sample } from "effector"
import { nanoid } from "nanoid"

import {
    type SubscriptionTransport,
    executeHttp,
    mergeHeaders,
    parseOperations,
    persistentHeadersForTab,
    safeParseJson,
    subscribe,
} from "@/shared/lib/graphql"
import type { ExecutionResult, HeaderEntry, ResponseState, Tab } from "@/shared/types"

import { $persistentHeaders, $transport, $workspaceUrl, $wsUrl } from "./endpoint"
import { historyAdded } from "./history"
import { $activeTab, $tabs } from "./tabs"

const IDLE: ResponseState = {
    status: "idle",
    body: "",
    httpStatus: null,
    durationMs: null,
    size: null,
}

export const runRequested = createEvent<{ tabId?: string; operationName?: string | null } | void>()
export const stopRequested = createEvent<string>()
export const responseCleared = createEvent<string>()

export const $responses = createStore<Record<string, ResponseState>>({})
export const $activeResponse = sample({
    source: { responses: $responses, tab: $activeTab },
    fn: ({ responses, tab }) => (tab ? (responses[tab.id] ?? IDLE) : IDLE),
})

const responseSet = createEvent<{ tabId: string; state: ResponseState }>()
const responsePatched = createEvent<{ tabId: string; patch: Partial<ResponseState> }>()
const eventAppended = createEvent<{ tabId: string; event: string }>()

$responses
    .on(responseSet, (map, { tabId, state }) => ({ ...map, [tabId]: state }))
    .on(responsePatched, (map, { tabId, patch }) => ({
        ...map,
        [tabId]: { ...(map[tabId] ?? IDLE), ...patch },
    }))
    .on(eventAppended, (map, { tabId, event }) => {
        const prev = map[tabId] ?? IDLE
        const events = [...(prev.events ?? []), event]
        return { ...map, [tabId]: { ...prev, events, body: events.join("\n\n") } }
    })
    .on(responseCleared, (map, tabId) => ({ ...map, [tabId]: IDLE }))

const controllers = new Map<string, () => void>()

interface RunParams {
    tab: Tab
    url: string
    wsUrl: string
    transport: SubscriptionTransport
    persistentHeaders: HeaderEntry[]
    operationName: string | null | undefined
}

const runFx = createEffect(
    async ({ tab, url, wsUrl, transport, persistentHeaders, operationName }: RunParams) => {
        controllers.get(tab.id)?.()
        controllers.delete(tab.id)

        const vars = safeParseJson(tab.variables)
        if (!vars.ok) {
            responseSet({
                tabId: tab.id,
                state: { ...IDLE, status: "error", error: `Invalid variables JSON: ${vars.error}` },
            })
            return
        }
        const ops = parseOperations(tab.query)
        const target =
            ops.length <= 1 ? ops[0] : (ops.find(o => o.name === operationName) ?? ops[0])
        const opName = ops.length > 1 ? (target?.name ?? null) : null
        const headers = mergeHeaders(persistentHeadersForTab(persistentHeaders, tab), tab.headers)
        const kind = target?.kind ?? "query"
        const started = performance.now()

        const record = (ok: boolean, status: number | null) =>
            historyAdded({
                id: nanoid(10),
                endpointUrl: url,
                operationName: target?.name ?? null,
                kind,
                query: tab.query,
                variables: tab.variables,
                headers: tab.headers,
                status,
                durationMs: performance.now() - started,
                ok,
                createdAt: Date.now(),
            })

        if (kind === "subscription") {
            responseSet({
                tabId: tab.id,
                state: { ...IDLE, status: "streaming", events: [], body: "" },
            })
            let count = 0
            const stop = subscribe({
                url,
                wsUrl,
                transport,
                query: tab.query,
                variables: vars.value,
                operationName: opName,
                headers,
                onNext: (result: ExecutionResult) => {
                    count += 1
                    eventAppended({ tabId: tab.id, event: JSON.stringify(result, null, 2) })
                },
                onError: e => {
                    controllers.delete(tab.id)
                    responsePatched({
                        tabId: tab.id,
                        patch: {
                            status: "error",
                            error: e.message,
                            durationMs: performance.now() - started,
                        },
                    })
                    record(false, null)
                },
                onComplete: () => {
                    controllers.delete(tab.id)
                    responsePatched({
                        tabId: tab.id,
                        patch: {
                            status: "success",
                            durationMs: performance.now() - started,
                            size: count,
                        },
                    })
                    record(true, null)
                },
            })
            controllers.set(tab.id, stop)
            return
        }

        const controller = new AbortController()
        const abort = () => controller.abort()
        controllers.set(tab.id, abort)
        // A newer run (or stopRequested) replaces/removes our entry; once that happens this run
        // must not touch the response state or the controllers map.
        const isCurrent = () => controllers.get(tab.id) === abort
        responseSet({ tabId: tab.id, state: { ...IDLE, status: "loading" } })
        try {
            const res = await executeHttp({
                url,
                query: tab.query,
                variables: vars.value,
                operationName: opName,
                headers,
                signal: controller.signal,
            })
            if (!isCurrent()) return
            const body = res.body as ExecutionResult
            const ok =
                res.status < 400 &&
                !(
                    body &&
                    typeof body === "object" &&
                    "errors" in body &&
                    Array.isArray(body.errors) &&
                    body.errors.length &&
                    !body.data
                )
            responseSet({
                tabId: tab.id,
                state: {
                    status: ok ? "success" : "error",
                    body: JSON.stringify(res.body, null, 2),
                    httpStatus: res.status,
                    durationMs: res.durationMs,
                    size: res.size,
                    headers: res.headers,
                },
            })
            record(ok, res.status)
        } catch (e) {
            const err = e as Error
            if (!isCurrent()) return
            if (err.name === "AbortError") {
                responseSet({ tabId: tab.id, state: { ...IDLE, status: "idle" } })
                return
            }
            responseSet({
                tabId: tab.id,
                state: {
                    ...IDLE,
                    status: "error",
                    error:
                        err.message === "Failed to fetch"
                            ? "Network error — check the URL, CORS policy and that the server is reachable."
                            : err.message,
                    durationMs: performance.now() - started,
                },
            })
            record(false, null)
        } finally {
            if (isCurrent()) controllers.delete(tab.id)
        }
    },
)

sample({
    clock: runRequested,
    source: {
        tabs: $tabs,
        active: $activeTab,
        url: $workspaceUrl,
        wsUrl: $wsUrl,
        transport: $transport,
        persistentHeaders: $persistentHeaders,
    },
    fn: ({ tabs, active, url, wsUrl, transport, persistentHeaders }, payload): RunParams | null => {
        const tab =
            payload && payload.tabId ? (tabs.find(t => t.id === payload.tabId) ?? null) : active
        if (!tab) return null
        return {
            tab,
            url: url.trim(),
            wsUrl: wsUrl.trim(),
            transport,
            persistentHeaders,
            operationName: payload ? payload.operationName : undefined,
        }
    },
}).watch(params => {
    if (params) runFx(params)
})

sample({
    clock: stopRequested,
    source: $responses,
    fn: (map, tabId) => ({ tabId, hadEvents: (map[tabId]?.events?.length ?? 0) > 0 }),
}).watch(({ tabId, hadEvents }) => {
    controllers.get(tabId)?.()
    controllers.delete(tabId)
    responsePatched({ tabId, patch: { status: hadEvents ? "success" : "idle" } })
})

export const $running = $responses.map(map => {
    const out: Record<string, boolean> = {}
    for (const [id, r] of Object.entries(map))
        out[id] = r.status === "loading" || r.status === "streaming"
    return out
})
