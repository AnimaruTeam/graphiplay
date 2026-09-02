import { useUnit } from "effector-react"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useState } from "react"

import { Toasts } from "@/components"
import {
    $activeTab,
    $appReady,
    $modal,
    $paletteOpen,
    $resolvedTheme,
    $running,
    type StartOptions,
    appStarted,
    modalClosed,
    paletteToggled,
    runRequested,
    sidebarClosed,
    sidebarToggled,
    stopRequested,
    tabAdded,
    tabClosed,
} from "@/models"
import { CommandPalette, Modals, Rail, Sidebar, TopBar, Workspace } from "@/screens"
import { useIsMobile } from "@/shared/lib/hooks"

import styles from "./App.module.css"
import { ROOT_CLASS, RootContext } from "./root"

export interface AppProps {
    options?: StartOptions
    /**
     * Standalone app: shortcuts fire wherever the focus is. Embedded (default): only when
     * the event originates inside the playground, so the host page keeps its own keys.
     */
    globalShortcuts?: boolean
}

function useShortcuts(root: HTMLElement | null, global: boolean) {
    const [
        activeTab,
        running,
        run,
        stop,
        addTab,
        closeTab,
        togglePalette,
        toggleSidebar,
        modal,
        paletteOpen,
        closeModal,
    ] = useUnit([
        $activeTab,
        $running,
        runRequested,
        stopRequested,
        tabAdded,
        tabClosed,
        paletteToggled,
        sidebarToggled,
        $modal,
        $paletteOpen,
        modalClosed,
    ])

    useEffect(() => {
        if (!root) return
        const onKey = (e: KeyboardEvent) => {
            // CodeMirror keymaps (Mod-Enter, Mod-S…) call preventDefault when they handle a key;
            // don't run the same action a second time from here.
            if (e.defaultPrevented) return
            if (!global && !(e.target instanceof Node && root.contains(e.target))) return
            const mod = e.metaKey || e.ctrlKey
            // Browsers reserve Mod+T / Mod+W (new / close browser tab) and ignore preventDefault,
            // so app tabs use Alt instead. e.code, because macOS turns Option+letter into a symbol.
            if (e.altKey && !mod && !e.shiftKey && !paletteOpen && !modal) {
                if (e.code === "KeyT") {
                    e.preventDefault()
                    addTab({ query: "" })
                } else if (e.code === "KeyW") {
                    e.preventDefault()
                    if (activeTab) closeTab(activeTab.id)
                }
                return
            }
            if (!mod) return
            const k = e.key.toLowerCase()
            if (k === "k") {
                e.preventDefault()
                if (modal) closeModal()
                togglePalette()
                return
            }
            if (paletteOpen || modal) return
            if (k === "enter") {
                e.preventDefault()
                if (activeTab)
                    running[activeTab.id]
                        ? stop(activeTab.id)
                        : run({ tabId: activeTab.id, operationName: undefined })
            } else if (k === "b") {
                e.preventDefault()
                toggleSidebar()
            }
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [
        root,
        global,
        activeTab,
        running,
        run,
        stop,
        addTab,
        closeTab,
        togglePalette,
        toggleSidebar,
        modal,
        paletteOpen,
        closeModal,
    ])
}

export function App({ options, globalShortcuts = false }: AppProps) {
    const [ready, theme, start, closeSidebar] = useUnit([
        $appReady,
        $resolvedTheme,
        appStarted,
        sidebarClosed,
    ])
    const isMobile = useIsMobile()
    // State (not a ref): children portal into the root, so they must re-render once it exists.
    const [root, setRoot] = useState<HTMLElement | null>(null)

    useEffect(() => {
        start(options)
        // Options are read once, on mount — like a constructor argument.
    }, [start])

    // The phone layout shows the sidebar as an overlay — start on the editor, not on a panel.
    useEffect(() => {
        if (ready && isMobile) closeSidebar()
    }, [ready, isMobile, closeSidebar])

    useShortcuts(root, globalShortcuts)

    return (
        <RootContext.Provider value={root}>
            <div ref={setRoot} className={`${ROOT_CLASS} ${styles.app}`} data-theme={theme}>
                <AnimatePresence>
                    {!ready && (
                        <motion.div
                            key="splash"
                            className={styles.splash}
                            initial={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.25 }}
                        >
                            <div className={styles.splashLogo}>
                                <span />
                            </div>
                            <div className={styles.splashText}>Graphiplay</div>
                        </motion.div>
                    )}
                </AnimatePresence>
                {ready && (
                    <motion.div
                        className={styles.shell}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                        <TopBar />
                        <div className={styles.main}>
                            <Rail />
                            <div className={styles.content}>
                                <Sidebar />
                                <Workspace />
                            </div>
                        </div>
                    </motion.div>
                )}
                <Modals />
                <CommandPalette />
                <Toasts />
            </div>
        </RootContext.Provider>
    )
}
