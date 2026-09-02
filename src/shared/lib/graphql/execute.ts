import { type Client, createClient } from "graphql-ws"

import type { ExecutionResult } from "@/shared/types"

export interface ExecuteParams {
    url: string
    query: string
    variables?: Record<string, unknown>
    operationName?: string | null
    headers: Record<string, string>
    signal?: AbortSignal
}

export interface HttpResult {
    status: number
    durationMs: number
    size: number
    body: unknown
    text: string
}

export async function executeHttp(params: ExecuteParams): Promise<HttpResult> {
    const started = performance.now()
    const res = await fetch(params.url, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            accept: "application/graphql-response+json, application/json",
            ...params.headers,
        },
        body: JSON.stringify({
            query: params.query,
            variables: params.variables ?? {},
            operationName: params.operationName ?? undefined,
        }),
        signal: params.signal,
    })
    const text = await res.text()
    const durationMs = performance.now() - started
    let body: unknown
    try {
        body = JSON.parse(text)
    } catch {
        body = { __raw: text }
    }
    return { status: res.status, durationMs, size: new Blob([text]).size, body, text }
}

export type SubscriptionTransport = "ws" | "sse"

export interface SubscribeParams extends ExecuteParams {
    transport: SubscriptionTransport
    wsUrl?: string
    onNext: (result: ExecutionResult) => void
    onError: (error: Error) => void
    onComplete: () => void
}

export function deriveWsUrl(httpUrl: string): string {
    try {
        const u = new URL(httpUrl)
        u.protocol = u.protocol === "https:" ? "wss:" : "ws:"
        return u.toString()
    } catch {
        return httpUrl.replace(/^http/, "ws")
    }
}

const wsClients = new Map<string, Client>()

function getWsClient(url: string, headers: Record<string, string>): Client {
    const key = `${url}::${JSON.stringify(headers)}`
    let client = wsClients.get(key)
    if (!client) {
        client = createClient({
            url,
            connectionParams: headers,
            lazy: true,
            retryAttempts: 2,
        })
        wsClients.set(key, client)
    }
    return client
}

export function subscribe(params: SubscribeParams): () => void {
    if (params.transport === "sse") return subscribeSse(params)
    const url = params.wsUrl || deriveWsUrl(params.url)
    const client = getWsClient(url, params.headers)
    const unsubscribe = client.subscribe<ExecutionResult>(
        {
            query: params.query,
            variables: params.variables ?? {},
            operationName: params.operationName ?? undefined,
        },
        {
            next: v => params.onNext(v as ExecutionResult),
            error: e => {
                const err =
                    e instanceof Error
                        ? e
                        : Array.isArray(e)
                          ? new Error(e.map((x: { message?: string }) => x.message).join("\n"))
                          : new Error(
                                typeof e === "object" && e && "reason" in e
                                    ? String(
                                          (e as CloseEvent).reason ||
                                              `WebSocket closed (${(e as CloseEvent).code})`,
                                      )
                                    : String(e),
                            )
                params.onError(err)
            },
            complete: params.onComplete,
        },
    )
    return unsubscribe
}

function subscribeSse(params: SubscribeParams): () => void {
    const controller = new AbortController()
    ;(async () => {
        try {
            const res = await fetch(params.url, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "text/event-stream",
                    ...params.headers,
                },
                body: JSON.stringify({
                    query: params.query,
                    variables: params.variables ?? {},
                    operationName: params.operationName ?? undefined,
                }),
                signal: controller.signal,
            })
            if (!res.ok || !res.body) {
                throw new Error(`HTTP ${res.status} ${res.statusText}`)
            }
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ""
            while (true) {
                const { value, done } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                let idx: number
                while ((idx = buffer.indexOf("\n\n")) !== -1) {
                    const chunk = buffer.slice(0, idx)
                    buffer = buffer.slice(idx + 2)
                    let event = "message"
                    const dataLines: string[] = []
                    for (const line of chunk.split("\n")) {
                        if (line.startsWith("event:")) event = line.slice(6).trim()
                        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim())
                    }
                    if (event === "complete") {
                        params.onComplete()
                        controller.abort()
                        return
                    }
                    if (dataLines.length) {
                        try {
                            params.onNext(JSON.parse(dataLines.join("\n")))
                        } catch {
                            params.onNext({ data: dataLines.join("\n") })
                        }
                    }
                }
            }
            params.onComplete()
        } catch (e) {
            if ((e as Error).name !== "AbortError") params.onError(e as Error)
        }
    })()
    return () => controller.abort()
}
