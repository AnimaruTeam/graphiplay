import { useUnit } from "effector-react"
import { motion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"

import { useRoot } from "@/app/root"
import {
    $activeResponse,
    $activeTab,
    $responseWidth,
    $running,
    responseWidthChanged,
} from "@/models"
import { EditorPane, ResponsePane, RunButton, TabsBar } from "@/screens"
import { useElementSize, useIsMobile } from "@/shared/lib/hooks"

import styles from "./Workspace.module.css"

export function Workspace() {
    const isMobile = useIsMobile()
    return (
        <section className={styles.workspace}>
            <TabsBar />
            {isMobile ? <MobileViews /> : <SplitView />}
        </section>
    )
}

/** Below this workspace width the side-by-side split leaves no room for either pane. */
const STACK_BELOW_WIDTH = 680
/** …unless the window is too short for stacking (phone in landscape), then side by side it stays. */
const STACK_MIN_HEIGHT = 480

/**
 * Desktop / tablet: editor and response with a draggable divider — side by side when the
 * workspace is wide enough, stacked otherwise (e.g. tablet with the sidebar open). The stored
 * fraction is the response's share along whichever axis is in use.
 */
function SplitView() {
    const [responseWidth, setResponseWidth] = useUnit([$responseWidth, responseWidthChanged])
    const splitRef = useRef<HTMLDivElement>(null)
    const { width, height } = useElementSize(splitRef)
    const stacked = width > 0 && width < STACK_BELOW_WIDTH && height >= STACK_MIN_HEIGHT

    const root = useRoot()
    const onResizeStart = useCallback(
        (e: React.PointerEvent) => {
            e.preventDefault()
            const host = splitRef.current
            if (!host) return
            const cursorClass = stacked ? styles.resizingRow : styles.resizing
            root?.classList.add(cursorClass)
            const rect = host.getBoundingClientRect()
            const move = (ev: PointerEvent) => {
                const fraction = stacked
                    ? (rect.bottom - ev.clientY) / rect.height
                    : (rect.right - ev.clientX) / rect.width
                setResponseWidth(fraction)
            }
            const up = () => {
                root?.classList.remove(cursorClass)
                window.removeEventListener("pointermove", move)
                window.removeEventListener("pointerup", up)
            }
            window.addEventListener("pointermove", move)
            window.addEventListener("pointerup", up)
        },
        [setResponseWidth, stacked, root],
    )

    return (
        <div className={`${styles.split} ${stacked ? styles.stacked : ""}`} ref={splitRef}>
            <div className={styles.editor} style={{ flex: `1 1 ${(1 - responseWidth) * 100}%` }}>
                <EditorPane />
            </div>
            <div
                className={styles.divider}
                onPointerDown={onResizeStart}
                onDoubleClick={() => setResponseWidth(0.45)}
            >
                <span />
            </div>
            <div className={styles.response} style={{ flex: `0 0 ${responseWidth * 100}%` }}>
                <ResponsePane />
            </div>
        </div>
    )
}

type MobileView = "editor" | "response"

/**
 * Phone: one view at a time, switched with a segmented control. Both panes stay mounted side by
 * side in a sliding track so the editor keeps its undo history and scroll position.
 */
function MobileViews() {
    const [view, setView] = useState<MobileView>("editor")
    const [tab, running, res] = useUnit([$activeTab, $running, $activeResponse])
    const isRunning = !!(tab && running[tab.id])

    // Starting a request is the moment the user wants to see the response.
    useEffect(() => {
        if (isRunning) setView("response")
    }, [isRunning])

    const tone =
        res.status === "error"
            ? styles.dotError
            : res.status === "success"
              ? styles.dotSuccess
              : res.status === "streaming" || res.status === "loading"
                ? styles.dotLive
                : ""

    return (
        <>
            <div className={styles.switcher}>
                <div className={styles.segment} role="tablist" aria-label="View">
                    <button
                        role="tab"
                        aria-selected={view === "editor"}
                        className={`${styles.segmentBtn} ${view === "editor" ? styles.segmentActive : ""}`}
                        onClick={() => setView("editor")}
                    >
                        Query
                    </button>
                    <button
                        role="tab"
                        aria-selected={view === "response"}
                        className={`${styles.segmentBtn} ${view === "response" ? styles.segmentActive : ""}`}
                        onClick={() => setView("response")}
                    >
                        Response
                        {tone && <span className={`${styles.dot} ${tone}`} />}
                    </button>
                </div>
                <div className={styles.switcherSpacer} />
                <RunButton hint={false} />
            </div>
            <div className={styles.viewport}>
                <motion.div
                    className={styles.track}
                    animate={{ x: view === "editor" ? "0%" : "-50%" }}
                    initial={false}
                    transition={{ type: "spring", stiffness: 380, damping: 38, mass: 0.9 }}
                >
                    <div className={styles.view} inert={view !== "editor"}>
                        <EditorPane />
                    </div>
                    <div className={styles.view} inert={view !== "response"}>
                        <ResponsePane />
                    </div>
                </motion.div>
            </div>
        </>
    )
}
