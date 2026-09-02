import { useUnit } from "effector-react"
import { History, RotateCcw, Trash2 } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"

import { Button, EmptyState, IconButton, KindBadge } from "@/components"
import {
    $activeTab,
    $history,
    historyCleared,
    historyEntryDeleted,
    modalOpened,
    tabAdded,
    tabUpdated,
} from "@/models"
import { formatMs } from "@/shared/lib/graphql"
import type { HistoryEntry } from "@/shared/types"

import styles from "./HistoryPanel.module.css"

function relative(ts: number): string {
    const diff = Date.now() - ts
    if (diff < 60_000) return "just now"
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
    return new Date(ts).toLocaleDateString()
}

function groupByDay(list: HistoryEntry[]) {
    const groups: { label: string; items: HistoryEntry[] }[] = []
    for (const h of list) {
        const d = new Date(h.createdAt)
        const today = new Date()
        const label =
            d.toDateString() === today.toDateString()
                ? "Today"
                : d.toDateString() === new Date(today.getTime() - 86_400_000).toDateString()
                  ? "Yesterday"
                  : d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        const g = groups[groups.length - 1]
        if (g && g.label === label) g.items.push(h)
        else groups.push({ label, items: [h] })
    }
    return groups
}

export function HistoryPanel() {
    const [history, clear, remove, activeTab, addTab, update, openModal] = useUnit([
        $history,
        historyCleared,
        historyEntryDeleted,
        $activeTab,
        tabAdded,
        tabUpdated,
        modalOpened,
    ])

    const restore = (h: HistoryEntry) => {
        const patch = {
            query: h.query,
            variables: h.variables,
            headers: h.headers.map(x => ({ ...x })),
            title: h.operationName ?? h.kind,
            collectionItemId: undefined,
        }
        if (activeTab && !activeTab.query.trim()) update({ id: activeTab.id, patch })
        else addTab(patch)
    }

    return (
        <div className={styles.root}>
            <div className={styles.toolbar}>
                <span className={styles.count}>
                    {history.length} request{history.length === 1 ? "" : "s"}
                </span>
                <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 />}
                    disabled={!history.length}
                    onClick={() =>
                        openModal({
                            kind: "confirm",
                            title: "Clear history?",
                            message: "All recorded requests will be removed.",
                            danger: true,
                            onConfirm: () => clear(),
                        })
                    }
                >
                    Clear
                </Button>
            </div>
            <div className={styles.list}>
                {history.length === 0 && (
                    <EmptyState
                        icon={<History />}
                        title="No requests yet"
                        description="Every operation you run is recorded here so you can replay it later."
                    />
                )}
                {groupByDay(history).map(g => (
                    <div key={g.label}>
                        <div className={styles.day}>{g.label}</div>
                        <AnimatePresence initial={false}>
                            {g.items.map(h => (
                                <motion.div
                                    key={h.id}
                                    layout
                                    className={`${styles.item} ${h.ok ? "" : styles.failed}`}
                                    initial={{ opacity: 0, y: -6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, x: -14 }}
                                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                                >
                                    <button
                                        className={styles.main}
                                        onClick={() => restore(h)}
                                        title="Restore into editor"
                                    >
                                        <KindBadge kind={h.kind} compact />
                                        <div className={styles.text}>
                                            <span className={styles.name}>
                                                {h.operationName ?? `anonymous ${h.kind}`}
                                            </span>
                                            <span className={styles.meta}>
                                                <span className={h.ok ? styles.ok : styles.err}>
                                                    {h.status ?? (h.ok ? "ok" : "error")}
                                                </span>
                                                <span>·</span>
                                                <span>{formatMs(h.durationMs)}</span>
                                                <span>·</span>
                                                <span>{relative(h.createdAt)}</span>
                                            </span>
                                        </div>
                                    </button>
                                    <div className={styles.actions}>
                                        <IconButton
                                            label="Restore"
                                            size="sm"
                                            onClick={() => restore(h)}
                                        >
                                            <RotateCcw />
                                        </IconButton>
                                        <IconButton
                                            label="Delete"
                                            size="sm"
                                            tone="danger"
                                            onClick={() => remove(h.id)}
                                        >
                                            <Trash2 />
                                        </IconButton>
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                ))}
            </div>
        </div>
    )
}
