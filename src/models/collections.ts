import { attach, createEffect, createEvent, createStore, sample } from "effector"
import { nanoid } from "nanoid"

import { db } from "@/shared/db"
import { guessTitle, parseOperations } from "@/shared/lib/graphql"
import type { Collection, CollectionItem, HeaderEntry, OperationKind, Tab } from "@/shared/types"

import { $workspaceUrl } from "./endpoint"
import { $tabs, tabUpdated } from "./tabs"
import { toastShown } from "./ui"

export const COLLECTION_COLORS = [
    "#8b7cff",
    "#5ee2ff",
    "#ff7ac6",
    "#62e6a2",
    "#ffd166",
    "#ff9a62",
    "#c084fc",
    "#38bdf8",
]

export const collectionCreated = createEvent<{ name: string; color?: string }>()
export const collectionRenamed = createEvent<{ id: string; name: string }>()
export const collectionRecolored = createEvent<{ id: string; color: string }>()
export const collectionDeleted = createEvent<string>()

export interface SaveItemPayload {
    id?: string
    collectionId: string
    name: string
    query: string
    variables: string
    headers: HeaderEntry[]
}
export const itemSaved = createEvent<SaveItemPayload>()
export const itemRenamed = createEvent<{ id: string; name: string }>()
export const itemDeleted = createEvent<string>()
export const itemMoved = createEvent<{ id: string; collectionId: string }>()

/** Collections of the current workspace only — see `$workspaceUrl`. */
export const $collections = createStore<Collection[]>([])
export const $items = createStore<CollectionItem[]>([])
export const $itemsByCollection = $items.map(items => {
    const map: Record<string, CollectionItem[]> = {}
    for (const it of items) (map[it.collectionId] ??= []).push(it)
    for (const k in map) map[k].sort((a, b) => a.order - b.order)
    return map
})

export const loadCollectionsFx = createEffect(async (url: string) => {
    const collections = await db.collections.where("endpointUrl").equals(url).sortBy("order")
    const ids = collections.map(c => c.id)
    const items = ids.length
        ? await db.collectionItems.where("collectionId").anyOf(ids).sortBy("order")
        : []
    return { url, collections, items }
})
// Re-read the current workspace after any mutation.
const reloadFx = attach({
    source: $workspaceUrl,
    effect: loadCollectionsFx,
    mapParams: (_: void, url) => url,
})

// Drop results of a load that was overtaken by another switch.
const collectionsLoaded = sample({
    clock: loadCollectionsFx.doneData,
    source: $workspaceUrl,
    filter: (current, { url }) => url === current,
    fn: (_, result) => result,
})
$collections.on(collectionsLoaded, (_, { collections }) => collections)
$items.on(collectionsLoaded, (_, { items }) => items)

const createCollectionFx = attach({
    source: $workspaceUrl,
    effect: async (endpointUrl: string, { name, color }: { name: string; color?: string }) => {
        const count = await db.collections.where("endpointUrl").equals(endpointUrl).count()
        const now = Date.now()
        const id = nanoid(10)
        await db.collections.add({
            id,
            endpointUrl,
            name: name.trim() || "Untitled collection",
            color: color ?? COLLECTION_COLORS[count % COLLECTION_COLORS.length],
            order: count,
            createdAt: now,
            updatedAt: now,
        })
        return id
    },
})

const updateCollectionFx = createEffect(
    async ({ id, ...patch }: { id: string } & Partial<Collection>) => {
        await db.collections.update(id, { ...patch, updatedAt: Date.now() })
    },
)

const deleteCollectionFx = createEffect(async (id: string) => {
    await db.transaction("rw", db.collections, db.collectionItems, async () => {
        await db.collectionItems.where("collectionId").equals(id).delete()
        await db.collections.delete(id)
    })
})

const saveItemFx = createEffect(async (p: SaveItemPayload) => {
    const now = Date.now()
    const kind: OperationKind = parseOperations(p.query)[0]?.kind ?? "query"
    if (p.id) {
        await db.collectionItems.update(p.id, {
            name: p.name,
            kind,
            query: p.query,
            variables: p.variables,
            headers: p.headers,
            collectionId: p.collectionId,
            updatedAt: now,
        })
        return p.id
    }
    const count = await db.collectionItems.where("collectionId").equals(p.collectionId).count()
    const id = nanoid(10)
    await db.collectionItems.add({
        id,
        collectionId: p.collectionId,
        name: p.name.trim() || "Untitled",
        kind,
        query: p.query,
        variables: p.variables,
        headers: p.headers,
        order: count,
        createdAt: now,
        updatedAt: now,
    })
    return id
})

const updateItemFx = createEffect(
    async ({ id, ...patch }: { id: string } & Partial<CollectionItem>) => {
        await db.collectionItems.update(id, { ...patch, updatedAt: Date.now() })
    },
)

const deleteItemFx = createEffect((id: string) => db.collectionItems.delete(id))

sample({ clock: collectionCreated, target: createCollectionFx })
sample({ clock: collectionRenamed, target: updateCollectionFx })
sample({ clock: collectionRecolored, target: updateCollectionFx })
sample({ clock: collectionDeleted, target: deleteCollectionFx })
sample({ clock: itemSaved, target: saveItemFx })
sample({ clock: itemRenamed, target: updateItemFx })
sample({ clock: itemMoved, target: updateItemFx })
sample({ clock: itemDeleted, target: deleteItemFx })

sample({
    clock: [
        createCollectionFx.done,
        updateCollectionFx.done,
        deleteCollectionFx.done,
        saveItemFx.done,
        updateItemFx.done,
        deleteItemFx.done,
    ],
    target: reloadFx,
})

export const collectionCreatedDone = createCollectionFx.doneData
export const itemSavedDone = saveItemFx.doneData
export const itemSaveFailed = saveItemFx.failData

// --- "put this tab into collection X" (drag & drop, context menu) -----------

/** Save the tab into the collection, or move its linked item there if it is already saved. */
export const tabSavedToCollection = createEvent<{ tabId: string; collectionId: string }>()
/** Same, but into a brand-new collection created on the fly. */
export const tabSavedToNewCollection = createEvent<{ tabId: string; name?: string }>()

interface PlaceTabParams {
    tab: Tab
    collectionId: string
    items: CollectionItem[]
}

const placeTabFx = createEffect(async ({ tab, collectionId, items }: PlaceTabParams) => {
    const collection = await db.collections.get(collectionId)
    if (!collection) throw new Error("Collection no longer exists")
    const linked = tab.collectionItemId ? items.find(i => i.id === tab.collectionItemId) : undefined
    if (linked) {
        if (linked.collectionId === collectionId)
            return { kind: "noop" as const, name: linked.name, collection }
        const order = await db.collectionItems.where("collectionId").equals(collectionId).count()
        await updateItemFx({ id: linked.id, collectionId, order })
        return { kind: "moved" as const, name: linked.name, collection }
    }
    const name = tab.title === "Untitled" ? guessTitle(tab.query) : tab.title
    const id = await saveItemFx({
        collectionId,
        name,
        query: tab.query,
        variables: tab.variables,
        headers: tab.headers,
    })
    tabUpdated({ id: tab.id, patch: { collectionItemId: id, title: name } })
    return { kind: "saved" as const, name, collection }
})

const placeTabPrepared = sample({
    clock: tabSavedToCollection,
    source: { tabs: $tabs, items: $items },
    fn: ({ tabs, items }, { tabId, collectionId }): PlaceTabParams | null => {
        const tab = tabs.find(t => t.id === tabId)
        return tab && tab.query.trim() ? { tab, collectionId, items } : null
    },
})
sample({
    clock: placeTabPrepared,
    filter: (p): p is PlaceTabParams => p !== null,
    target: placeTabFx,
})

interface PlaceInNewParams {
    tab: Tab
    name: string | undefined
}
const placeInNewFx = createEffect(async ({ tab, name }: PlaceInNewParams) => {
    const collectionId = await createCollectionFx({ name: name ?? "My collection" })
    await placeTabFx({ tab, collectionId, items: [] })
})
const placeInNewPrepared = sample({
    clock: tabSavedToNewCollection,
    source: $tabs,
    fn: (tabs, { tabId, name }): PlaceInNewParams | null => {
        const tab = tabs.find(t => t.id === tabId)
        return tab && tab.query.trim() ? { tab, name } : null
    },
})
sample({
    clock: placeInNewPrepared,
    filter: (p): p is PlaceInNewParams => p !== null,
    target: placeInNewFx,
})

sample({
    clock: placeTabFx.doneData,
    filter: r => r.kind !== "noop",
    fn: r => ({
        title: r.kind === "moved" ? "Moved to collection" : "Saved to collection",
        description: `${r.name} → ${r.collection.name}`,
        tone: "success" as const,
    }),
    target: toastShown,
})
sample({
    clock: [placeTabFx.failData, placeInNewFx.failData],
    fn: e => ({
        title: "Could not save to collection",
        description: e.message,
        tone: "error" as const,
    }),
    target: toastShown,
})
