import { createEffect, createEvent, createStore, sample } from "effector"
import { nanoid } from "nanoid"

import { kv } from "@/shared/db"
import type { ActiveOperation } from "@/shared/lib/codemirror"
import { debounce } from "@/shared/lib/effector"
import type { PanelKind } from "@/shared/types"

// --- panels & layout ---------------------------------------------------------

export const panelSelected = createEvent<PanelKind>()
export const sidebarToggled = createEvent()
/** Explicit close (mobile "Query" tab / entering the phone layout), unlike the toggle. */
export const sidebarClosed = createEvent()
export const sidebarWidthChanged = createEvent<number>()
export const responseWidthChanged = createEvent<number>()
export const bottomTabChanged = createEvent<"variables" | "headers">()
export const bottomCollapsedToggled = createEvent()
export const bottomHeightChanged = createEvent<number>()

export const DEFAULT_BOTTOM_HEIGHT = 200

export const $activePanel = createStore<PanelKind>("schema")
export const $sidebarCollapsed = createStore(false)
export const $sidebarWidth = createStore(340)
export const $responseWidth = createStore(0.45)
export const $bottomTab = createStore<"variables" | "headers">("variables")
export const $bottomCollapsed = createStore(false)
export const $bottomHeight = createStore(DEFAULT_BOTTOM_HEIGHT)

$sidebarCollapsed.on(sidebarToggled, v => !v).on(sidebarClosed, () => true)
// Selecting the already-active panel collapses the sidebar; anything else opens it.
const panelToggled = sample({
    clock: panelSelected,
    source: { collapsed: $sidebarCollapsed, active: $activePanel },
    fn: ({ collapsed, active }, next) => ({
        active: next,
        collapsed: !collapsed && active === next,
    }),
})
$activePanel.on(panelToggled, (_, { active }) => active)
$sidebarCollapsed.on(panelToggled, (_, { collapsed }) => collapsed)
$sidebarWidth.on(sidebarWidthChanged, (_, w) => Math.min(640, Math.max(240, w)))
$responseWidth.on(responseWidthChanged, (_, w) => Math.min(0.75, Math.max(0.2, w)))
$bottomTab.on(bottomTabChanged, (_, t) => t)
$bottomCollapsed.on(bottomCollapsedToggled, v => !v)
$bottomHeight.on(bottomHeightChanged, (_, h) => Math.min(600, Math.max(100, Math.round(h))))

interface Layout {
    activePanel: PanelKind
    sidebarCollapsed: boolean
    sidebarWidth: number
    responseWidth: number
    bottomTab: "variables" | "headers"
    bottomCollapsed: boolean
    bottomHeight: number
}

export const loadLayoutFx = createEffect(() => kv.get<Partial<Layout>>("layout", {}))
$activePanel.on(loadLayoutFx.doneData, (s, l) => l.activePanel ?? s)
$sidebarCollapsed.on(loadLayoutFx.doneData, (s, l) => l.sidebarCollapsed ?? s)
$sidebarWidth.on(loadLayoutFx.doneData, (s, l) => l.sidebarWidth ?? s)
$responseWidth.on(loadLayoutFx.doneData, (s, l) => l.responseWidth ?? s)
$bottomTab.on(loadLayoutFx.doneData, (s, l) => l.bottomTab ?? s)
$bottomCollapsed.on(loadLayoutFx.doneData, (s, l) => l.bottomCollapsed ?? s)
$bottomHeight.on(loadLayoutFx.doneData, (s, l) => l.bottomHeight ?? s)

const $layout = sample({
    source: {
        activePanel: $activePanel,
        sidebarCollapsed: $sidebarCollapsed,
        sidebarWidth: $sidebarWidth,
        responseWidth: $responseWidth,
        bottomTab: $bottomTab,
        bottomCollapsed: $bottomCollapsed,
        bottomHeight: $bottomHeight,
    },
    fn: (l): Layout => l,
})
const saveLayoutFx = createEffect((l: Layout) => kv.set("layout", l))
const $layoutLoaded = createStore(false).on(loadLayoutFx.done, () => true)
sample({ clock: debounce($layout, 200), filter: $layoutLoaded, target: saveLayoutFx })

// --- theme -------------------------------------------------------------------

export type ThemeSetting = "light" | "dark" | "system"
export type ResolvedTheme = "light" | "dark"

export const themeChanged = createEvent<ThemeSetting>()
const systemThemeChanged = createEvent<ResolvedTheme>()

const media =
    typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null
const systemTheme = (): ResolvedTheme => (media?.matches ? "dark" : "light")
media?.addEventListener("change", () => systemThemeChanged(systemTheme()))

export const $theme = createStore<ThemeSetting>("system")
const $systemTheme = createStore<ResolvedTheme>(systemTheme()).on(systemThemeChanged, (_, t) => t)
export const $resolvedTheme = sample({
    source: { setting: $theme, system: $systemTheme },
    fn: ({ setting, system }): ResolvedTheme => (setting === "system" ? system : setting),
})

$theme.on(themeChanged, (_, t) => t)

export const loadThemeFx = createEffect(async () => kv.get<ThemeSetting>("theme", "system"))
$theme.on(loadThemeFx.doneData, (_, t) => t)
const saveThemeFx = createEffect((t: ThemeSetting) => kv.set("theme", t))
sample({ clock: themeChanged, target: saveThemeFx })

// --- docs navigation (schema explorer) --------------------------------------

export type DocsNode =
    | { kind: "root" }
    | { kind: "type"; name: string }
    | { kind: "field"; typeName: string; fieldName: string }
    | { kind: "sdl" }

export const docsPushed = createEvent<DocsNode>()
export const docsPopped = createEvent()
export const docsReset = createEvent()
export const docsJumped = createEvent<number>()
export const docsSearchChanged = createEvent<string>()

export const $docsStack = createStore<DocsNode[]>([{ kind: "root" }])
export const $docsSearch = createStore("")

$docsStack
    .on(docsPushed, (stack, node) => [...stack, node])
    .on(docsPopped, stack => (stack.length > 1 ? stack.slice(0, -1) : stack))
    .on(docsJumped, (stack, idx) => stack.slice(0, idx + 1))
    .reset(docsReset)
$docsSearch.on(docsSearchChanged, (_, v) => v).reset(docsReset)

export const $docsCurrent = $docsStack.map(s => s[s.length - 1])

// --- modals ------------------------------------------------------------------

export type Modal =
    | { kind: "saveToCollection"; tabId: string }
    | { kind: "newCollection" }
    | { kind: "renameCollection"; id: string }
    | { kind: "renameItem"; id: string }
    | { kind: "confirm"; title: string; message: string; onConfirm: () => void; danger?: boolean }
    | { kind: "endpointSettings" }
    | { kind: "shortcuts" }
    /** Large editor for a single header value; read-only when `onSave` is omitted. */
    | { kind: "headerValue"; header: string; value: string; onSave?: (value: string) => void }

export const modalOpened = createEvent<Modal>()
export const modalClosed = createEvent()
export const $modal = createStore<Modal | null>(null)
$modal.on(modalOpened, (_, m) => m).reset(modalClosed)

// --- toasts ------------------------------------------------------------------

export interface Toast {
    id: string
    title: string
    description?: string
    tone: "info" | "success" | "error"
}

export const toastShown = createEvent<Omit<Toast, "id">>()
export const toastDismissed = createEvent<string>()
export const $toasts = createStore<Toast[]>([])

const toastAdded = createEvent<Toast>()
sample({ clock: toastShown, fn: (t): Toast => ({ ...t, id: nanoid(6) }), target: toastAdded })
$toasts
    .on(toastAdded, (list, t) => [...list, t].slice(-4))
    .on(toastDismissed, (list, id) => list.filter(t => t.id !== id))
toastAdded.watch(t => setTimeout(() => toastDismissed(t.id), t.tone === "error" ? 6000 : 3200))

// --- tab drag & drop ---------------------------------------------------------

/** MIME type carried by a dragged tab; drop targets check for it. */
export const TAB_DRAG_TYPE = "application/x-graphiplay-tab"

export const tabDragStarted = createEvent<string>()
export const tabDragEnded = createEvent()
export const $draggingTabId = createStore<string | null>(null)
    .on(tabDragStarted, (_, id) => id)
    .reset(tabDragEnded)

// --- editor ↔ query builder --------------------------------------------------

/** Operation under the editor cursor (drives the run target and what the query builder edits). */
export const cursorOperationChanged = createEvent<ActiveOperation | null>()
export const $cursorOperation = createStore<ActiveOperation | null>(null).on(
    cursorOperationChanged,
    (_, op) => op,
)

/**
 * A text edit produced outside the editor (query builder). EditorPane applies it as a CodeMirror
 * transaction when the editor is mounted; `query` is the full fallback text.
 */
export const queryEditRequested = createEvent<{
    tabId: string
    change: { from: number; to: number; insert: string }
    query: string
    cursor?: number
}>()

// --- command palette ---------------------------------------------------------

export const paletteToggled = createEvent<boolean | void>()
export const $paletteOpen = createStore(false)
$paletteOpen.on(paletteToggled, (v, next) => (typeof next === "boolean" ? next : !v))
