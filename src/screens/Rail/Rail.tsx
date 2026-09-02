import { useUnit } from "effector-react"
import {
    BookMarked,
    FolderHeart,
    History,
    KeyRound,
    Layers,
    ListTree,
    SquareTerminal,
} from "lucide-react"
import { motion } from "motion/react"

import {
    $activePanel,
    $persistentHeaders,
    $sidebarCollapsed,
    TAB_DRAG_TYPE,
    panelSelected,
    sidebarClosed,
} from "@/models"
import { useIsMobile } from "@/shared/lib/hooks"
import type { PanelKind } from "@/shared/types"

import styles from "./Rail.module.css"

// `short` is the caption under the icon in the phone bottom bar.
const items: { kind: PanelKind; label: string; short: string; icon: React.ReactNode }[] = [
    { kind: "schema", label: "Schema", short: "Schema", icon: <BookMarked /> },
    { kind: "builder", label: "Query builder", short: "Builder", icon: <ListTree /> },
    { kind: "operations", label: "Operations", short: "Ops", icon: <Layers /> },
    { kind: "collections", label: "Collections", short: "Saved", icon: <FolderHeart /> },
    { kind: "history", label: "History", short: "History", icon: <History /> },
    { kind: "headers", label: "Persistent headers", short: "Headers", icon: <KeyRound /> },
]

const activeTransition = { type: "spring", stiffness: 500, damping: 38 } as const

export function Rail() {
    const [active, collapsed, select, closeSidebar, headers] = useUnit([
        $activePanel,
        $sidebarCollapsed,
        panelSelected,
        sidebarClosed,
        $persistentHeaders,
    ])
    const isMobile = useIsMobile()
    const enabledHeaders = headers.filter(h => h.enabled && h.key.trim()).length

    return (
        <nav className={styles.rail}>
            {/* Phone only: the editor is a destination of its own, since the sidebar covers it. */}
            {isMobile && (
                <button
                    className={`${styles.item} ${collapsed ? styles.active : ""}`}
                    onClick={() => closeSidebar()}
                    aria-label="Query"
                    aria-current={collapsed ? "page" : undefined}
                >
                    {collapsed && (
                        <motion.span
                            layoutId="rail-active"
                            className={styles.activeBg}
                            transition={activeTransition}
                        />
                    )}
                    <span className={styles.icon}>
                        <SquareTerminal />
                    </span>
                    <span className={styles.caption}>Query</span>
                </button>
            )}
            {items.map(it => {
                const isActive = active === it.kind && !collapsed
                return (
                    <button
                        key={it.kind}
                        className={`${styles.item} ${isActive ? styles.active : ""}`}
                        onClick={() => select(it.kind)}
                        onDragEnter={e => {
                            // Spring-load the collections panel while a tab is being dragged.
                            if (
                                it.kind === "collections" &&
                                !isActive &&
                                e.dataTransfer.types.includes(TAB_DRAG_TYPE)
                            )
                                select("collections")
                        }}
                        title={isMobile ? undefined : it.label}
                        aria-label={it.label}
                        aria-current={isActive ? "page" : undefined}
                    >
                        {isActive && (
                            <motion.span
                                layoutId="rail-active"
                                className={styles.activeBg}
                                transition={activeTransition}
                            />
                        )}
                        <span className={styles.icon}>{it.icon}</span>
                        {it.kind === "headers" && enabledHeaders > 0 && (
                            <span className={styles.badge}>{enabledHeaders}</span>
                        )}
                        <span className={styles.caption}>{it.short}</span>
                        <span className={styles.tooltip}>{it.label}</span>
                    </button>
                )
            })}
        </nav>
    )
}
