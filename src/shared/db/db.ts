import Dexie, { type EntityTable, type Transaction } from "dexie"

import { DEFAULT_URL, normalizeEndpointUrl } from "@/shared/lib/graphql"
import type { Collection, CollectionItem, Endpoint, HistoryEntry, Tab } from "@/shared/types"

interface KeyValue {
    key: string
    value: unknown
}

/** Per-workspace kv keys — one value per endpoint URL. */
export const workspaceKey = (
    name: "settings" | "tabOrder" | "activeTabId" | "schemaCache",
    url: string,
) => `${name}:${url}`

class GraphiplayDB extends Dexie {
    endpoints!: EntityTable<Endpoint, "id">
    tabs!: EntityTable<Tab, "id">
    collections!: EntityTable<Collection, "id">
    collectionItems!: EntityTable<CollectionItem, "id">
    history!: EntityTable<HistoryEntry, "id">
    kv!: EntityTable<KeyValue, "key">

    constructor() {
        super("graphiplay")
        this.version(1).stores({
            endpoints: "id, url, updatedAt",
            tabs: "id, updatedAt",
            collections: "id, order, updatedAt",
            collectionItems: "id, collectionId, order, updatedAt",
            history: "id, createdAt, endpointUrl",
            kv: "key",
        })
        // v2: tabs and collections are scoped to an endpoint URL (a "workspace").
        this.version(2)
            .stores({
                endpoints: "id, url, updatedAt",
                tabs: "id, endpointUrl, updatedAt",
                collections: "id, endpointUrl, order, updatedAt",
                collectionItems: "id, collectionId, order, updatedAt",
                history: "id, createdAt, endpointUrl",
                kv: "key",
            })
            .upgrade(migrateToWorkspaces)
    }
}

// Everything that existed before belongs to whichever endpoint was active at the time.
async function migrateToWorkspaces(tx: Transaction) {
    const kvTable = tx.table<KeyValue, string>("kv")
    const settings = (await kvTable.get("endpoint"))?.value as
        { url?: string; wsUrl?: string; transport?: string } | undefined
    const url = normalizeEndpointUrl(settings?.url ?? DEFAULT_URL)

    await tx
        .table("tabs")
        .toCollection()
        .modify((t: Tab) => {
            t.endpointUrl ??= url
        })
    await tx
        .table("collections")
        .toCollection()
        .modify((c: Collection) => {
            c.endpointUrl ??= url
        })

    for (const name of ["tabOrder", "activeTabId"] as const) {
        const row = await kvTable.get(name)
        if (!row) continue
        await kvTable.put({ key: workspaceKey(name, url), value: row.value })
        await kvTable.delete(name)
    }

    // Headers, ws URL and transport become per-workspace settings.
    const headers = (await kvTable.get("persistentHeaders"))?.value ?? []
    await kvTable.put({
        key: workspaceKey("settings", url),
        value: { wsUrl: settings?.wsUrl ?? "", transport: settings?.transport ?? "ws", headers },
    })
    await kvTable.delete("persistentHeaders")

    const cache = await kvTable.get("schemaCache")
    if (cache) {
        const cachedUrl = (cache.value as { url?: string } | undefined)?.url
        if (cachedUrl)
            await kvTable.put({
                key: workspaceKey("schemaCache", normalizeEndpointUrl(cachedUrl)),
                value: cache.value,
            })
        await kvTable.delete("schemaCache")
    }
}

export const db = new GraphiplayDB()

export const kv = {
    async get<T>(key: string, fallback: T): Promise<T> {
        const row = await db.kv.get(key)
        return row ? (row.value as T) : fallback
    },
    async set(key: string, value: unknown) {
        await db.kv.put({ key, value })
    },
}
