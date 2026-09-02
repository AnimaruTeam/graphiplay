import { useUnit } from "effector-react"
import {
    Copy,
    FolderHeart,
    FolderInput,
    FolderPlus,
    Pencil,
    Play,
    Plus,
    Square,
    Trash2,
    Unlink,
    X,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
    ContextMenu,
    IconButton,
    KindBadge,
    type MenuEntry,
    type MenuPosition,
    altKey,
    modKey,
} from "@/components"
import {
    $activeTabId,
    $collections,
    $items,
    $running,
    $tabs,
    TAB_DRAG_TYPE,
    allTabsClosed,
    itemDeleted,
    modalOpened,
    otherTabsClosed,
    panelSelected,
    runRequested,
    stopRequested,
    tabActivated,
    tabAdded,
    tabClosed,
    tabDragEnded,
    tabDragStarted,
    tabDuplicated,
    tabMoved,
    tabRenamed,
    tabSavedToCollection,
    tabUpdated,
    toastShown,
} from "@/models"
import { parseOperations } from "@/shared/lib/graphql"
import { useIsTouch } from "@/shared/lib/hooks"
import type { Tab } from "@/shared/types"

import styles from "./TabsBar.module.css"

interface MenuState {
    tabId: string
    position: MenuPosition
}

export function TabsBar() {
    const [
        tabs,
        activeId,
        activate,
        add,
        close,
        closeOthers,
        closeAll,
        duplicate,
        rename,
        move,
        update,
    ] = useUnit([
        $tabs,
        $activeTabId,
        tabActivated,
        tabAdded,
        tabClosed,
        otherTabsClosed,
        allTabsClosed,
        tabDuplicated,
        tabRenamed,
        tabMoved,
        tabUpdated,
    ])
    const [running, run, stop] = useUnit([$running, runRequested, stopRequested])
    const [collections, items, removeItem, placeInCollection] = useUnit([
        $collections,
        $items,
        itemDeleted,
        tabSavedToCollection,
    ])
    const [openModal, selectPanel, dragStarted, dragEnded, toast] = useUnit([
        modalOpened,
        panelSelected,
        tabDragStarted,
        tabDragEnded,
        toastShown,
    ])

    const scrollRef = useRef<HTMLDivElement>(null)
    const [menu, setMenu] = useState<MenuState | null>(null)
    const [renaming, setRenaming] = useState<string | null>(null)
    const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined) // undefined = no drop indicator

    const closeMenu = useCallback(() => setMenu(null), [])

    useEffect(() => {
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-tab="${activeId}"]`)
        el?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" })
    }, [activeId, tabs.length])

    const menuTab = menu ? tabs.find(t => t.id === menu.tabId) : undefined
    const menuItems = useMemo<MenuEntry[]>(() => {
        if (!menuTab) return []
        const tab = menuTab
        const linked = tab.collectionItemId
            ? items.find(i => i.id === tab.collectionItemId)
            : undefined
        const isRunning = !!running[tab.id]
        const hasQuery = tab.query.trim().length > 0

        const collectionEntries: MenuEntry[] = [
            ...collections.map(c => ({
                id: `c-${c.id}`,
                label: c.name,
                icon: <span className={styles.menuDot} style={{ background: c.color }} />,
                checked: linked?.collectionId === c.id,
                onSelect: () => placeInCollection({ tabId: tab.id, collectionId: c.id }),
            })),
            ...(collections.length ? (["separator"] as MenuEntry[]) : []),
            {
                id: "new-collection",
                label: "New collection…",
                icon: <FolderPlus />,
                onSelect: () => openModal({ kind: "saveToCollection", tabId: tab.id }),
            },
        ]

        return [
            {
                id: "run",
                label: isRunning ? "Stop" : "Run",
                icon: isRunning ? <Square /> : <Play />,
                hint: `${modKey} ↵`,
                disabled: !hasQuery && !isRunning,
                onSelect: () =>
                    isRunning ? stop(tab.id) : run({ tabId: tab.id, operationName: undefined }),
            },
            {
                id: "rename",
                label: "Rename",
                icon: <Pencil />,
                onSelect: () => setRenaming(tab.id),
            },
            {
                id: "duplicate",
                label: "Duplicate",
                icon: <Copy />,
                onSelect: () => duplicate(tab.id),
            },
            "separator",
            {
                id: "collection",
                label: linked ? "Move to collection" : "Save to collection",
                icon: linked ? <FolderInput /> : <FolderHeart />,
                hint: linked
                    ? collections.find(c => c.id === linked.collectionId)?.name
                    : undefined,
                disabled: !hasQuery,
                children: collectionEntries,
            },
            ...(linked
                ? ([
                      {
                          id: "unlink",
                          label: "Remove from collection",
                          icon: <Unlink />,
                          onSelect: () =>
                              openModal({
                                  kind: "confirm",
                                  title: `Remove “${linked.name}”?`,
                                  message:
                                      "The saved operation is deleted from its collection. The tab stays open.",
                                  danger: true,
                                  onConfirm: () => {
                                      removeItem(linked.id)
                                      update({ id: tab.id, patch: { collectionItemId: undefined } })
                                      toast({ title: "Removed from collection", tone: "info" })
                                  },
                              }),
                      },
                      {
                          id: "reveal",
                          label: "Show in collections",
                          icon: <FolderHeart />,
                          onSelect: () => selectPanel("collections"),
                      },
                  ] as MenuEntry[])
                : []),
            "separator",
            {
                id: "close",
                label: "Close",
                icon: <X />,
                hint: `${altKey} W`,
                onSelect: () => close(tab.id),
            },
            {
                id: "close-others",
                label: "Close others",
                disabled: tabs.length < 2,
                onSelect: () => closeOthers(tab.id),
            },
            {
                id: "close-all",
                label: "Close all",
                icon: <Trash2 />,
                danger: true,
                disabled: tabs.length < 2 && !tabs[0]?.query.trim(),
                onSelect: () => closeAll(),
            },
        ]
    }, [
        menuTab,
        items,
        collections,
        running,
        tabs,
        placeInCollection,
        openModal,
        stop,
        run,
        duplicate,
        removeItem,
        update,
        toast,
        selectPanel,
        close,
        closeOthers,
        closeAll,
    ])

    // --- drag & drop (reorder within the bar; collections panel handles drops there) ---
    const onDragStart = (tab: Tab, e: React.DragEvent) => {
        e.dataTransfer.setData(TAB_DRAG_TYPE, tab.id)
        e.dataTransfer.setData("text/plain", tab.title)
        e.dataTransfer.effectAllowed = "copyMove"
        dragStarted(tab.id)
    }
    const onDragEnd = () => {
        dragEnded()
        setDropBefore(undefined)
    }
    const onDragOverTab = (tab: Tab, e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(TAB_DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        const rect = e.currentTarget.getBoundingClientRect()
        const after = e.clientX > rect.left + rect.width / 2
        const idx = tabs.findIndex(t => t.id === tab.id)
        setDropBefore(after ? (tabs[idx + 1]?.id ?? null) : tab.id)
    }
    const onDropInBar = (e: React.DragEvent) => {
        const id = e.dataTransfer.getData(TAB_DRAG_TYPE)
        if (!id) return
        e.preventDefault()
        if (dropBefore !== undefined) move({ id, before: dropBefore })
        setDropBefore(undefined)
    }

    return (
        <div
            className={styles.bar}
            onDragOver={e => {
                if (e.dataTransfer.types.includes(TAB_DRAG_TYPE)) e.preventDefault()
            }}
            onDrop={onDropInBar}
        >
            <IconButton
                label={`New tab (${altKey}+T)`}
                size="sm"
                className={styles.add}
                onClick={() => add({ query: "" })}
            >
                <Plus />
            </IconButton>
            <div
                className={styles.scroll}
                ref={scrollRef}
                onDragLeave={e => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropBefore(undefined)
                }}
            >
                <AnimatePresence initial={false}>
                    {tabs.map(t => (
                        <TabChip
                            key={t.id}
                            tab={t}
                            active={t.id === activeId}
                            running={!!running[t.id]}
                            linked={
                                t.collectionItemId
                                    ? items.some(i => i.id === t.collectionItemId)
                                    : false
                            }
                            renaming={renaming === t.id}
                            dropBefore={dropBefore === t.id}
                            onActivate={() => activate(t.id)}
                            onClose={() => close(t.id)}
                            onRenameStart={() => setRenaming(t.id)}
                            onRenameEnd={title => {
                                setRenaming(null)
                                if (title !== null) rename({ id: t.id, title })
                            }}
                            onMenu={position => setMenu({ tabId: t.id, position })}
                            onDragStart={e => onDragStart(t, e)}
                            onDragEnd={onDragEnd}
                            onDragOver={e => onDragOverTab(t, e)}
                        />
                    ))}
                </AnimatePresence>
                {/* drop slot at the very end */}
                <div
                    className={`${styles.endSlot} ${dropBefore === null ? styles.endSlotActive : ""}`}
                    onDragOver={e => {
                        if (!e.dataTransfer.types.includes(TAB_DRAG_TYPE)) return
                        e.preventDefault()
                        setDropBefore(null)
                    }}
                />
            </div>

            <ContextMenu
                open={!!menu && !!menuTab}
                position={menu?.position ?? { x: 0, y: 0 }}
                items={menuItems}
                onClose={closeMenu}
            />
        </div>
    )
}

interface TabChipProps {
    tab: Tab
    active: boolean
    running: boolean
    linked: boolean
    renaming: boolean
    dropBefore: boolean
    onActivate: () => void
    onClose: () => void
    onRenameStart: () => void
    onRenameEnd: (title: string | null) => void
    onMenu: (position: MenuPosition) => void
    onDragStart: (e: React.DragEvent) => void
    onDragEnd: () => void
    onDragOver: (e: React.DragEvent) => void
}

const LONG_PRESS_MS = 450
const LONG_PRESS_SLOP = 8

function TabChip({
    tab,
    active,
    running,
    linked,
    renaming,
    dropBefore,
    onActivate,
    onClose,
    onRenameStart,
    onRenameEnd,
    onMenu,
    onDragStart,
    onDragEnd,
    onDragOver,
}: TabChipProps) {
    const [draft, setDraft] = useState(tab.title)
    const kind = parseOperations(tab.query)[0]?.kind ?? null
    // Chrome for Android turns a long press on a draggable element into a native drag, which
    // cancels our pointer events — so on touch the long press belongs to the menu, not to DnD.
    const isTouch = useIsTouch()

    useEffect(() => {
        if (renaming) setDraft(tab.title)
    }, [renaming, tab.title])

    const commit = () => {
        const next = draft.trim()
        onRenameEnd(next && next !== tab.title ? next : null)
    }

    // Touch has no right click: a long press opens the same menu. iOS never fires `contextmenu`,
    // Android does — the second call just repositions the already-open menu.
    const press = useRef<{ timer: number; x: number; y: number } | null>(null)
    const cancelPress = () => {
        if (press.current) window.clearTimeout(press.current.timer)
        press.current = null
    }
    const onPointerDown = (e: React.PointerEvent) => {
        if (e.pointerType === "mouse" || renaming) return
        const { clientX: x, clientY: y } = e
        cancelPress()
        press.current = {
            x,
            y,
            timer: window.setTimeout(() => {
                press.current = null
                onMenu({ x, y })
            }, LONG_PRESS_MS),
        }
    }
    const onPointerMove = (e: React.PointerEvent) => {
        const p = press.current
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP) cancelPress()
    }

    return (
        <motion.div
            layout
            data-tab={tab.id}
            className={`${styles.tab} ${active ? styles.active : ""} ${dropBefore ? styles.dropBefore : ""}`}
            initial={{ opacity: 0, width: 0, scale: 0.9 }}
            animate={{ opacity: 1, width: "auto", scale: 1 }}
            exit={{ opacity: 0, width: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 460, damping: 36 }}
        >
            {/* Native HTML5 drag lives on a plain element: motion.div reserves onDrag* for its own gestures. */}
            <div
                className={styles.inner}
                draggable={!renaming && !isTouch}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
                onMouseDown={e => {
                    if (e.button === 1) {
                        e.preventDefault()
                        onClose()
                    }
                }}
                onAuxClick={e => e.preventDefault()}
                onContextMenu={e => {
                    e.preventDefault()
                    onMenu({ x: e.clientX, y: e.clientY })
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={cancelPress}
                onPointerCancel={cancelPress}
            >
                {active && (
                    <motion.span
                        layoutId="tab-active"
                        className={styles.activeBg}
                        transition={{ type: "spring", stiffness: 520, damping: 40 }}
                    />
                )}
                <button
                    className={styles.main}
                    onClick={onActivate}
                    onDoubleClick={onRenameStart}
                    title={`${tab.title}\n(double‑click to rename, right‑click for menu, drag into a collection)`}
                >
                    {running ? (
                        <span className={styles.pulse} />
                    ) : kind ? (
                        <KindBadge kind={kind} compact />
                    ) : (
                        <span className={styles.emptyDot} />
                    )}
                    {renaming ? (
                        <input
                            className={styles.rename}
                            autoFocus
                            value={draft}
                            onChange={e => setDraft(e.target.value)}
                            onBlur={commit}
                            onKeyDown={e => {
                                if (e.key === "Enter") commit()
                                if (e.key === "Escape") onRenameEnd(null)
                            }}
                            onClick={e => e.stopPropagation()}
                        />
                    ) : (
                        <span className={styles.title}>{tab.title}</span>
                    )}
                    {linked && (
                        <span className={styles.linked} title="Linked to a collection item" />
                    )}
                </button>
                <button
                    className={styles.close}
                    aria-label="Close tab"
                    onClick={e => {
                        e.stopPropagation()
                        onClose()
                    }}
                >
                    <X />
                </button>
            </div>
        </motion.div>
    )
}
