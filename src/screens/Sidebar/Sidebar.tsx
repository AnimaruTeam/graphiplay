import { useUnit } from "effector-react"
import { PanelLeftClose, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useRef } from "react"

import { useRoot } from "@/app/root"
import { IconButton } from "@/components"
import {
    $activePanel,
    $sidebarCollapsed,
    $sidebarWidth,
    sidebarToggled,
    sidebarWidthChanged,
} from "@/models"
import {
    CollectionsPanel,
    HeadersPanel,
    HistoryPanel,
    OperationsPanel,
    QueryBuilder,
    SchemaExplorer,
} from "@/screens"
import { useIsMobile } from "@/shared/lib/hooks"
import type { PanelKind } from "@/shared/types"

import styles from "./Sidebar.module.css"

const TITLES: Record<PanelKind, string> = {
    schema: "Schema",
    builder: "Query builder",
    operations: "Operations",
    collections: "Collections",
    history: "History",
    headers: "Persistent headers",
}

function PanelBody({ kind }: { kind: PanelKind }) {
    switch (kind) {
        case "schema":
            return <SchemaExplorer />
        case "builder":
            return <QueryBuilder />
        case "operations":
            return <OperationsPanel />
        case "collections":
            return <CollectionsPanel />
        case "history":
            return <HistoryPanel />
        case "headers":
            return <HeadersPanel />
    }
}

export function Sidebar() {
    const [panel, collapsed, width, toggle, setWidth] = useUnit([
        $activePanel,
        $sidebarCollapsed,
        $sidebarWidth,
        sidebarToggled,
        sidebarWidthChanged,
    ])
    const isMobile = useIsMobile()
    const root = useRoot()
    const dragging = useRef(false)

    const onResizeStart = useCallback(
        (e: React.PointerEvent) => {
            e.preventDefault()
            dragging.current = true
            const startX = e.clientX
            const startW = width
            root?.classList.add(styles.resizing)
            const move = (ev: PointerEvent) => {
                if (!dragging.current) return
                setWidth(startW + ev.clientX - startX)
            }
            const up = () => {
                dragging.current = false
                root?.classList.remove(styles.resizing)
                window.removeEventListener("pointermove", move)
                window.removeEventListener("pointerup", up)
            }
            window.addEventListener("pointermove", move)
            window.addEventListener("pointerup", up)
        },
        [width, setWidth, root],
    )

    // Phone: the sidebar is a full-size overlay above the workspace, sliding in from the left.
    // Keyed on the layout so motion never has to interpolate between width and x animations.
    return (
        <motion.aside
            key={isMobile ? "overlay" : "docked"}
            className={`${styles.sidebar} ${isMobile ? styles.overlay : ""}`}
            animate={
                isMobile
                    ? { x: collapsed ? "-12%" : "0%", opacity: collapsed ? 0 : 1 }
                    : { width: collapsed ? 0 : width, opacity: collapsed ? 0 : 1 }
            }
            initial={false}
            transition={
                dragging.current
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 320, damping: 34, mass: 0.9 }
            }
            inert={isMobile && collapsed}
        >
            <div className={styles.inner} style={isMobile ? undefined : { width }}>
                <header className={styles.head}>
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.h2
                            key={panel}
                            className={styles.title}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.18 }}
                        >
                            {TITLES[panel]}
                        </motion.h2>
                    </AnimatePresence>
                    <IconButton
                        label={isMobile ? "Back to editor" : "Collapse sidebar"}
                        size={isMobile ? "md" : "sm"}
                        onClick={() => toggle()}
                    >
                        {isMobile ? <X /> : <PanelLeftClose />}
                    </IconButton>
                </header>
                <div className={styles.body}>
                    <AnimatePresence mode="popLayout" initial={false}>
                        <motion.div
                            key={panel}
                            className={styles.panel}
                            initial={{ opacity: 0, x: -14 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            transition={{ type: "spring", stiffness: 420, damping: 36 }}
                        >
                            <PanelBody kind={panel} />
                        </motion.div>
                    </AnimatePresence>
                </div>
                {!isMobile && (
                    <div
                        className={styles.resizer}
                        onPointerDown={onResizeStart}
                        onDoubleClick={() => setWidth(340)}
                    />
                )}
            </div>
        </motion.aside>
    )
}
