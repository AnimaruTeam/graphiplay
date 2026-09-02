import { useUnit } from "effector-react"
import {
    ChevronRight,
    FolderHeart,
    FolderPlus,
    MoreHorizontal,
    Pencil,
    Play,
    Save,
    Trash2,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useRef, useState } from "react"

import { Button, EmptyState, IconButton, KindBadge } from "@/components"
import {
    $activeTab,
    $collections,
    $draggingTabId,
    $itemsByCollection,
    $tabs,
    TAB_DRAG_TYPE,
    collectionDeleted,
    itemDeleted,
    modalOpened,
    tabActivated,
    tabAdded,
    tabSavedToCollection,
    tabSavedToNewCollection,
    tabUpdated,
    toastShown,
} from "@/models"
import type { Collection, CollectionItem } from "@/shared/types"

import styles from "./CollectionsPanel.module.css"

const isTabDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(TAB_DRAG_TYPE)

/** Tracks dragenter/dragleave pairs so nested children don't flicker the "over" state. */
function useDropZone(onDrop: (tabId: string) => void) {
    const depth = useRef(0)
    const [over, setOver] = useState(false)
    return {
        over,
        handlers: {
            onDragEnter: (e: React.DragEvent) => {
                if (!isTabDrag(e)) return
                depth.current += 1
                setOver(true)
            },
            onDragLeave: (e: React.DragEvent) => {
                if (!isTabDrag(e)) return
                depth.current = Math.max(0, depth.current - 1)
                if (depth.current === 0) setOver(false)
            },
            onDragOver: (e: React.DragEvent) => {
                if (!isTabDrag(e)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = "copy"
            },
            onDrop: (e: React.DragEvent) => {
                const id = e.dataTransfer.getData(TAB_DRAG_TYPE)
                depth.current = 0
                setOver(false)
                if (!id) return
                e.preventDefault()
                e.stopPropagation()
                onDrop(id)
            },
        },
    }
}

export function CollectionsPanel() {
    const [collections, itemsBy, activeTab, openModal, draggingTabId, placeInNew] = useUnit([
        $collections,
        $itemsByCollection,
        $activeTab,
        modalOpened,
        $draggingTabId,
        tabSavedToNewCollection,
    ])
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
    const dragging = draggingTabId !== null
    const newZone = useDropZone(tabId => placeInNew({ tabId }))

    return (
        <div className={styles.root}>
            <div className={styles.toolbar}>
                <Button
                    size="sm"
                    variant="primary"
                    icon={<Save />}
                    disabled={!activeTab || !activeTab.query.trim()}
                    onClick={() =>
                        activeTab && openModal({ kind: "saveToCollection", tabId: activeTab.id })
                    }
                >
                    Save current tab
                </Button>
                <Button
                    size="sm"
                    variant="soft"
                    icon={<FolderPlus />}
                    onClick={() => openModal({ kind: "newCollection" })}
                >
                    New
                </Button>
            </div>

            <div className={styles.list}>
                {collections.length === 0 && !dragging && (
                    <EmptyState
                        icon={<FolderHeart />}
                        title="No collections"
                        description="Group your queries, mutations and subscriptions. Everything is stored locally in your browser. Tip: drag a tab here to save it."
                        action={
                            <Button
                                variant="primary"
                                icon={<FolderPlus />}
                                onClick={() => openModal({ kind: "newCollection" })}
                            >
                                Create collection
                            </Button>
                        }
                    />
                )}
                {collections.map(c => (
                    <CollectionBlock
                        key={c.id}
                        collection={c}
                        items={itemsBy[c.id] ?? []}
                        open={!collapsed[c.id]}
                        dragging={dragging}
                        onToggle={() => setCollapsed(s => ({ ...s, [c.id]: !s[c.id] }))}
                    />
                ))}
                <AnimatePresence>
                    {dragging && (
                        <motion.div
                            key="new-zone"
                            className={`${styles.newZone} ${newZone.over ? styles.newZoneOver : ""}`}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            {...newZone.handlers}
                        >
                            <FolderPlus />
                            Drop here to create a new collection
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    )
}

function CollectionBlock({
    collection,
    items,
    open,
    dragging,
    onToggle,
}: {
    collection: Collection
    items: CollectionItem[]
    open: boolean
    dragging: boolean
    onToggle: () => void
}) {
    const [openModal, deleteCollection, placeTab] = useUnit([
        modalOpened,
        collectionDeleted,
        tabSavedToCollection,
    ])
    const [menu, setMenu] = useState(false)
    const zone = useDropZone(tabId => placeTab({ tabId, collectionId: collection.id }))

    return (
        <div
            className={[
                styles.block,
                dragging ? styles.blockDroppable : "",
                zone.over ? styles.blockOver : "",
            ].join(" ")}
            style={{ ["--c" as string]: collection.color }}
            {...zone.handlers}
        >
            <div className={styles.blockHead}>
                <button className={styles.blockToggle} onClick={onToggle}>
                    <ChevronRight
                        className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
                    />
                    <span className={styles.dot} style={{ background: collection.color }} />
                    <span className={styles.blockName}>{collection.name}</span>
                    <span className={styles.blockCount}>{items.length}</span>
                </button>
                <div className={styles.blockActions}>
                    <IconButton
                        label="Collection menu"
                        size="sm"
                        active={menu}
                        onClick={() => setMenu(v => !v)}
                    >
                        <MoreHorizontal />
                    </IconButton>
                    <AnimatePresence>
                        {menu && (
                            <motion.div
                                className={styles.menu}
                                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                                transition={{ duration: 0.15 }}
                                onMouseLeave={() => setMenu(false)}
                            >
                                <button
                                    onClick={() => {
                                        setMenu(false)
                                        openModal({ kind: "renameCollection", id: collection.id })
                                    }}
                                >
                                    <Pencil /> Rename & color
                                </button>
                                <button
                                    className={styles.menuDanger}
                                    onClick={() => {
                                        setMenu(false)
                                        openModal({
                                            kind: "confirm",
                                            title: `Delete “${collection.name}”?`,
                                            message: `This removes the collection and its ${items.length} saved operation(s). This cannot be undone.`,
                                            danger: true,
                                            onConfirm: () => deleteCollection(collection.id),
                                        })
                                    }}
                                >
                                    <Trash2 /> Delete collection
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        className={styles.items}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 380, damping: 36 }}
                    >
                        <div className={styles.itemsInner}>
                            {items.length === 0 && (
                                <div className={styles.emptyItems}>
                                    {dragging
                                        ? "Drop the tab here"
                                        : "Empty — save the current tab or drag a tab here."}
                                </div>
                            )}
                            {items.map(it => (
                                <ItemRow key={it.id} item={it} color={collection.color} />
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

function ItemRow({ item, color }: { item: CollectionItem; color: string }) {
    const [tabs, activeTab, addTab, activate, update, openModal, removeItem, toast] = useUnit([
        $tabs,
        $activeTab,
        tabAdded,
        tabActivated,
        tabUpdated,
        modalOpened,
        itemDeleted,
        toastShown,
    ])
    const linkedTab = tabs.find(t => t.collectionItemId === item.id)
    const isActive = activeTab?.collectionItemId === item.id

    const openItem = () => {
        if (linkedTab) {
            activate(linkedTab.id)
            return
        }
        if (activeTab && !activeTab.query.trim()) {
            update({
                id: activeTab.id,
                patch: {
                    query: item.query,
                    variables: item.variables,
                    headers: item.headers.map(h => ({ ...h })),
                    title: item.name,
                    collectionItemId: item.id,
                },
            })
            return
        }
        addTab({
            query: item.query,
            variables: item.variables,
            headers: item.headers.map(h => ({ ...h })),
            title: item.name,
            collectionItemId: item.id,
        })
    }

    return (
        <div
            className={`${styles.item} ${isActive ? styles.itemActive : ""}`}
            style={{ ["--c" as string]: color }}
        >
            <button className={styles.itemMain} onClick={openItem} title="Open">
                <KindBadge kind={item.kind} compact />
                <span className={styles.itemName}>{item.name}</span>
                {linkedTab && <span className={styles.openDot} title="Open in a tab" />}
            </button>
            <div className={styles.itemActions}>
                <IconButton label="Open" size="sm" onClick={openItem}>
                    <Play />
                </IconButton>
                <IconButton
                    label="Rename"
                    size="sm"
                    onClick={() => openModal({ kind: "renameItem", id: item.id })}
                >
                    <Pencil />
                </IconButton>
                <IconButton
                    label="Delete"
                    size="sm"
                    tone="danger"
                    onClick={() =>
                        openModal({
                            kind: "confirm",
                            title: `Delete “${item.name}”?`,
                            message: "The saved operation will be removed from this collection.",
                            danger: true,
                            onConfirm: () => {
                                removeItem(item.id)
                                if (linkedTab)
                                    update({
                                        id: linkedTab.id,
                                        patch: { collectionItemId: undefined },
                                    })
                                toast({ title: "Operation deleted", tone: "info" })
                            },
                        })
                    }
                >
                    <Trash2 />
                </IconButton>
            </div>
        </div>
    )
}
