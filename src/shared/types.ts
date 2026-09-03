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
}

export interface UiSettings {
    sidebarWidth: number
    responseWidth: number
    activePanel: PanelKind
    sidebarCollapsed: boolean
    editorBottomTab: "variables" | "headers"
}

export type PanelKind = "schema" | "builder" | "operations" | "collections" | "history" | "headers"
