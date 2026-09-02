import { createEffect, createEvent, createStore, sample } from "effector"
import { nanoid } from "nanoid"

import { db, kv, workspaceKey } from "@/shared/db"
import { debounce } from "@/shared/lib/effector"
import { DEFAULT_URL, createHeader, guessTitle } from "@/shared/lib/graphql"
import type { HeaderEntry, Tab } from "@/shared/types"

import { $workspaceUrl, workspaceSwitched } from "./endpoint"

/** Demo-endpoint welcome tab; not user content, so library options may replace it. */
export const WELCOME_QUERY = `# Welcome to Graphiplay ✦
#
# ⌘/Ctrl + Enter  →  run operation
# ⌘/Ctrl + S      →  save to collection
# Shift + Alt + F →  prettify
#
# Pick an operation on the left, or start typing —
# autocomplete works once the schema is loaded.

query Countries {
  countries(filter: { continent: { eq: "EU" } }) {
    code
    name
    emoji
    capital
    currency
  }
}
`

export const createTab = (endpointUrl: string, partial: Partial<Tab> = {}): Tab => {
    const now = Date.now()
    return {
        id: partial.id ?? nanoid(10),
        endpointUrl,
        title: partial.title ?? guessTitle(partial.query ?? "", "Untitled"),
        query: partial.query ?? "",
        variables: partial.variables ?? "{}",
        headers: partial.headers ?? [],
        disabledPersistentHeaders: partial.disabledPersistentHeaders ?? [],
        collectionItemId: partial.collectionItemId,
        createdAt: partial.createdAt ?? now,
        updatedAt: now,
    }
}

export const tabAdded = createEvent<Partial<Tab> | void>()
export const tabDuplicated = createEvent<string>()
export const tabClosed = createEvent<string>()
export const tabActivated = createEvent<string>()
export const tabUpdated = createEvent<{ id: string; patch: Partial<Tab> }>()
export const tabRenamed = createEvent<{ id: string; title: string }>()
/** Move tab `id` so it lands at the position currently occupied by tab `before` (or at the end). */
export const tabMoved = createEvent<{ id: string; before: string | null }>()
export const otherTabsClosed = createEvent<string>()
export const allTabsClosed = createEvent()

export const tabHeaderAdded = createEvent<string>()
export const tabHeaderChanged = createEvent<{
    tabId: string
    id: string
    patch: Partial<HeaderEntry>
}>()
export const tabHeaderRemoved = createEvent<{ tabId: string; id: string }>()
/** Switch a persistent (endpoint-level) header on or off for one tab. */
export const tabPersistentHeaderToggled = createEvent<{
    tabId: string
    id: string
    enabled: boolean
}>()

/** Tabs of the current workspace only — see `$workspaceUrl`. */
export const $tabs = createStore<Tab[]>([])
export const $activeTabId = createStore<string | null>(null)
export const $activeTab = sample({
    source: { tabs: $tabs, id: $activeTabId },
    fn: ({ tabs, id }) => tabs.find(t => t.id === id) ?? tabs[0] ?? null,
})

const touch = (t: Tab, patch: Partial<Tab>): Tab => ({ ...t, ...patch, updatedAt: Date.now() })

// Title follows the operation name while it is still the auto-derived one (i.e. the user
// hasn't renamed it and the tab isn't linked to a collection item, which owns its name).
const applyPatch = (t: Tab, patch: Partial<Tab>): Tab => {
    if (patch.query === undefined || patch.title !== undefined || t.collectionItemId)
        return touch(t, patch)
    const auto = t.title === guessTitle(t.query, "Untitled")
    return touch(t, auto ? { ...patch, title: guessTitle(patch.query, "Untitled") } : patch)
}

// New tabs go first; the created tab (with its id) is what activation keys off.
// Every new tab is stamped with the workspace it was created in.
const tabCreated = sample({
    clock: tabAdded,
    source: $workspaceUrl,
    fn: (url, partial) => createTab(url, partial ?? {}),
})
const tabCloned = sample({
    clock: tabDuplicated,
    source: $tabs,
    fn: (tabs, id) => {
        const src = tabs.find(t => t.id === id)
        return src
            ? {
                  after: id,
                  tab: createTab(src.endpointUrl, {
                      query: src.query,
                      variables: src.variables,
                      headers: src.headers.map(h => ({ ...h })),
                      disabledPersistentHeaders: [...(src.disabledPersistentHeaders ?? [])],
                      title: `${src.title} copy`,
                  }),
              }
            : null
    },
})

// Closing always leaves at least one tab; the replacement belongs to the current workspace.
// Tabs and the active id are computed together so activation never sees a stale list.
type CloseAction = { kind: "one"; id: string } | { kind: "others"; id: string } | { kind: "all" }
const tabsPruned = sample({
    clock: [
        tabClosed.map((id): CloseAction => ({ kind: "one", id })),
        otherTabsClosed.map((id): CloseAction => ({ kind: "others", id })),
        allTabsClosed.map((): CloseAction => ({ kind: "all" })),
    ],
    source: { tabs: $tabs, active: $activeTabId, url: $workspaceUrl },
    fn: ({ tabs, active, url }, action) => {
        let next: Tab[]
        if (action.kind === "one") next = tabs.filter(t => t.id !== action.id)
        else if (action.kind === "others") next = tabs.filter(t => t.id === action.id)
        else next = []
        if (!next.length) next = [createTab(url, { query: "" })]
        return { tabs: next, active: next.some(t => t.id === active) ? active : next[0].id }
    },
})

$tabs
    .on(tabCreated, (tabs, tab) => [tab, ...tabs])
    .on(tabCloned, (tabs, clone) => {
        if (!clone) return tabs
        const idx = tabs.findIndex(t => t.id === clone.after)
        return [...tabs.slice(0, idx + 1), clone.tab, ...tabs.slice(idx + 1)]
    })
    .on(tabsPruned, (_, { tabs }) => tabs)
    .on(tabUpdated, (tabs, { id, patch }) =>
        tabs.map(t => (t.id === id ? applyPatch(t, patch) : t)),
    )
    .on(tabRenamed, (tabs, { id, title }) => tabs.map(t => (t.id === id ? touch(t, { title }) : t)))
    .on(tabMoved, (tabs, { id, before }) => {
        if (id === before) return tabs
        const moved = tabs.find(t => t.id === id)
        if (!moved) return tabs
        const rest = tabs.filter(t => t.id !== id)
        const idx = before ? rest.findIndex(t => t.id === before) : -1
        if (idx === -1) return [...rest, moved]
        return [...rest.slice(0, idx), moved, ...rest.slice(idx)]
    })
    .on(tabHeaderAdded, (tabs, tabId) =>
        tabs.map(t => (t.id === tabId ? touch(t, { headers: [...t.headers, createHeader()] }) : t)),
    )
    .on(tabHeaderChanged, (tabs, { tabId, id, patch }) =>
        tabs.map(t =>
            t.id === tabId
                ? touch(t, { headers: t.headers.map(h => (h.id === id ? { ...h, ...patch } : h)) })
                : t,
        ),
    )
    .on(tabHeaderRemoved, (tabs, { tabId, id }) =>
        tabs.map(t =>
            t.id === tabId ? touch(t, { headers: t.headers.filter(h => h.id !== id) }) : t,
        ),
    )
    .on(tabPersistentHeaderToggled, (tabs, { tabId, id, enabled }) =>
        tabs.map(t => {
            if (t.id !== tabId) return t
            const disabled = (t.disabledPersistentHeaders ?? []).filter(x => x !== id)
            return touch(t, { disabledPersistentHeaders: enabled ? disabled : [...disabled, id] })
        }),
    )

// Activation rules
$activeTabId
    .on(tabCreated, (_, tab) => tab.id)
    .on(tabCloned, (id, clone) => clone?.tab.id ?? id)
    .on(tabActivated, (_, id) => id)
    .on(tabsPruned, (_, { active }) => active)

// --- persistence -------------------------------------------------------------
// Each workspace keeps its own tab rows plus its own order / active-tab entries in kv.

export const loadTabsFx = createEffect(async (url: string) => {
    const [tabs, active, order] = await Promise.all([
        db.tabs.where("endpointUrl").equals(url).toArray(),
        kv.get<string | null>(workspaceKey("activeTabId", url), null),
        kv.get<string[]>(workspaceKey("tabOrder", url), []),
    ])
    const sorted = order.length
        ? [...tabs].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
        : tabs.sort((a, b) => a.updatedAt - b.updatedAt)
    // A never-visited workspace starts with a single tab; the demo endpoint gets the welcome query.
    const fallback =
        url === DEFAULT_URL
            ? createTab(url, { query: WELCOME_QUERY, title: "Countries" })
            : createTab(url, { query: "" })
    return { url, tabs: sorted.length ? sorted : [fallback], active }
})

// Drop results of a load that was overtaken by another switch.
const tabsLoaded = sample({
    clock: loadTabsFx.doneData,
    source: $workspaceUrl,
    filter: (current, { url }) => url === current,
    fn: (_, result) => result,
})
$tabs.on(tabsLoaded, (_, { tabs }) => tabs)
$activeTabId.on(tabsLoaded, (_, { tabs, active }) =>
    tabs.some(t => t.id === active) ? active : (tabs[0]?.id ?? null),
)

// The workspace is derived from the tabs themselves rather than `$workspaceUrl`, so a
// debounced write that lands after a switch still goes to the workspace it came from.
const persistTabsFx = createEffect(async (tabs: Tab[]) => {
    const url = tabs[0]?.endpointUrl
    if (url === undefined) return
    const own = tabs.filter(t => t.endpointUrl === url)
    await db.transaction("rw", db.tabs, db.kv, async () => {
        const ids = new Set(own.map(t => t.id))
        const existing = await db.tabs.where("endpointUrl").equals(url).primaryKeys()
        const stale = existing.filter(id => !ids.has(id))
        if (stale.length) await db.tabs.bulkDelete(stale)
        await db.tabs.bulkPut(own)
        await db.kv.put({ key: workspaceKey("tabOrder", url), value: own.map(t => t.id) })
    })
})
const persistActiveFx = createEffect(({ url, id }: { url: string; id: string | null }) =>
    kv.set(workspaceKey("activeTabId", url), id),
)

const $loaded = createStore(false).on(loadTabsFx.done, () => true)

sample({
    clock: debounce($tabs, 300),
    filter: $loaded,
    target: persistTabsFx,
})

// Flush pending edits of the workspace we are leaving before its tabs get replaced.
sample({
    clock: workspaceSwitched,
    source: $tabs,
    filter: $loaded,
    target: persistTabsFx,
})

sample({
    clock: $activeTabId,
    source: { url: $workspaceUrl, id: $activeTabId },
    filter: $loaded,
    target: persistActiveFx,
})
