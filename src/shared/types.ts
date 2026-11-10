export type OperationKind = "query" | "mutation" | "subscription"

export interface HeaderEntry {
    id: string
    key: string
    value: string
    enabled: boolean
}

export interface Endpoint {
    id: string
    url: string
    wsUrl?: string
    name: string
    headers: HeaderEntry[]
    createdAt: number
    updatedAt: number
}

export interface Tab {
    id: string
    /** Workspace (endpoint URL) the tab belongs to. */
    endpointUrl: string
    title: string
    query: string
    variables: string
    headers: HeaderEntry[]
    /** Ids of persistent headers that are switched off for this tab only. */
    disabledPersistentHeaders?: string[]
    collectionItemId?: string
    createdAt: number
    updatedAt: number
}

export interface Collection {
    id: string
    /** Workspace (endpoint URL) the collection belongs to. */
    endpointUrl: string
    name: string
    color: string
    order: number
    createdAt: number
    updatedAt: number
}

export interface CollectionItem {
    id: string
    collectionId: string
    name: string
    kind: OperationKind
    query: string
    variables: string
    headers: HeaderEntry[]
    order: number
    createdAt: number
    updatedAt: number
}

export interface HistoryEntry {
    id: string
    endpointUrl: string
    operationName: string | null
    kind: OperationKind
    query: string
    variables: string
    headers: HeaderEntry[]
    status: number | null
    durationMs: number
    ok: boolean
    createdAt: number
}

export interface ExecutionResult {
    data?: unknown
    errors?: unknown[]
    extensions?: unknown
}

export interface BodyCompression {
    /** gzip, br, zstd… — "compressed" when the server hides its Content-Encoding header. */
    encoding: string
    /** Decoded size in bytes. */
    size: number
    /** Size on the wire; null when the browser doesn't tell. */
    encodedSize: number | null
}

/** What the server did with an Automatic Persisted Query. */
export type PersistedQueryOutcome =
    /** It knew the hash and ran the stored query: one request, no query text sent. */
    | "hit"
    /** It didn't know the hash, so the query text went in a second request and got stored. */
    | "registered"
    /** It has persisted queries switched off. */
    | "unsupported"
    /** It answered with an error instead of running anything (the body says why). */
    | "rejected"

export interface PersistedQuery {
    /** SHA-256 (hex) of the query text exactly as sent. */
    hash: string
    /** null until the server answers, and when the request never got through. */
    outcome: PersistedQueryOutcome | null
    /** HTTP requests it took: 2 when the server asked for the query text. */
    requests: number
}

export interface ResponseState {
    status: "idle" | "loading" | "success" | "error" | "streaming"
    body: string
    httpStatus: number | null
    durationMs: number | null
    size: number | null
    error?: string
    events?: string[]
    /** Headers the server sent back; empty for subscriptions and failed requests. */
    headers?: Record<string, string>
    requestCompression?: BodyCompression | null
    responseCompression?: BodyCompression | null
    /** Set when the operation went out as an Automatic Persisted Query. */
    persistedQuery?: PersistedQuery | null
}

export interface UiSettings {
    sidebarWidth: number
    responseWidth: number
    activePanel: PanelKind
    sidebarCollapsed: boolean
    editorBottomTab: "variables" | "headers"
}

export type PanelKind = "schema" | "builder" | "operations" | "collections" | "history" | "headers"
