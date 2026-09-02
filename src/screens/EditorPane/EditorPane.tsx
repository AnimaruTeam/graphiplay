import { useUnit } from "effector-react"
import { Braces, ChevronDown, ChevronUp, Eraser, KeyRound, Save, Sparkles } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useMemo, useRef } from "react"

import { useRoot } from "@/app/root"
import { CodeEditor, type CodeEditorHandle, IconButton, KindBadge, modKey } from "@/components"
import {
    $activePanel,
    $activeTab,
    $bottomCollapsed,
    $bottomHeight,
    $bottomTab,
    $items,
    $persistentHeaders,
    $running,
    $schema,
    $sidebarCollapsed,
    DEFAULT_BOTTOM_HEIGHT,
    bottomCollapsedToggled,
    bottomHeightChanged,
    bottomTabChanged,
    cursorOperationChanged,
    docsPushed,
    docsReset,
    itemSaved,
    modalOpened,
    panelSelected,
    queryEditRequested,
    runRequested,
    stopRequested,
    tabUpdated,
    toastShown,
} from "@/models"
import { RunButton, TabHeaders, useRunTarget } from "@/screens"
import { buildVariablesContext, validateVariables } from "@/shared/lib/codemirror"
import {
    mergeHeaders,
    persistentHeadersForTab,
    prettify,
    safeParseJson,
} from "@/shared/lib/graphql"
import { useElementSize, useIsMobile } from "@/shared/lib/hooks"

import styles from "./EditorPane.module.css"

/** Phones have little vertical room; keep the variables/headers drawer short. */
const MOBILE_BOTTOM_HEIGHT = 160
/** Toolbar + drawer tab strip + the least amount of query editor worth showing. */
const MIN_EDITOR_CHROME = 44 + 40 + 140

export function EditorPane() {
    const [tab, schema, running, run, stop, update, openModal, toast, items, saveItem] = useUnit([
        $activeTab,
        $schema,
        $running,
        runRequested,
        stopRequested,
        tabUpdated,
        modalOpened,
        toastShown,
        $items,
        itemSaved,
    ])
    const [bottomTab, bottomCollapsed, setBottomTab, toggleBottom] = useUnit([
        $bottomTab,
        $bottomCollapsed,
        bottomTabChanged,
        bottomCollapsedToggled,
    ])
    const [bottomHeight, setBottomHeight] = useUnit([$bottomHeight, bottomHeightChanged])
    const persistentHeaders = useUnit($persistentHeaders)
    const [activePanel, sidebarCollapsed, selectPanel, pushDocs, resetDocs] = useUnit([
        $activePanel,
        $sidebarCollapsed,
        panelSelected,
        docsPushed,
        docsReset,
    ])
    const setCursorOp = useUnit(cursorOperationChanged)
    const isMobile = useIsMobile()
    const rootRef = useRef<HTMLDivElement>(null)
    const { height: paneHeight } = useElementSize(rootRef)
    const editorRef = useRef<CodeEditorHandle>(null)
    const tabId = tab?.id

    // Edits from the query builder go through the editor when it's mounted so cursor/undo survive.
    useEffect(() => {
        if (!tabId) return
        return queryEditRequested.watch(e => {
            if (e.tabId !== tabId) return
            if (!editorRef.current?.applyChange(e.change, e.cursor))
                update({ id: tabId, patch: { query: e.query } })
        })
    }, [tabId, update])
    const root = useRoot()
    const dragging = useRef(false)

    // Dragging the top edge of the bottom panel: moving the pointer up grows the panel.
    const onResizeStart = useCallback(
        (e: React.PointerEvent) => {
            e.preventDefault()
            dragging.current = true
            const startY = e.clientY
            const startH = bottomHeight
            root?.classList.add(styles.resizing)
            const move = (ev: PointerEvent) => {
                if (!dragging.current) return
                setBottomHeight(startH + startY - ev.clientY)
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
        [bottomHeight, setBottomHeight, root],
    )

    // Type name clicked in the editor hover tooltip → show it in Schema Explorer.
    // panelSelected toggles collapse when the panel is already open, so only call it when needed.
    const onOpenType = (name: string) => {
        resetDocs()
        pushDocs({ kind: "type", name })
        if (activePanel !== "schema" || sidebarCollapsed) selectPanel("schema")
    }

    const { namedOps, multi, selectedOp } = useRunTarget(tab)

    // Variables that won't coerce against the query's declarations (unused keys are only warnings).
    const varsProblem = useMemo(() => {
        if (!tab) return null
        if (!safeParseJson(tab.variables).ok) return "Invalid JSON"
        const ctx = buildVariablesContext({ schema, query: tab.query, operationName: selectedOp })
        const errors = validateVariables(ctx, tab.variables).filter(i => i.severity === "error")
        return errors.length ? errors[0]!.message : null
    }, [tab?.variables, tab?.query, schema, selectedOp])

    if (!tab) return null
    const isRunning = !!running[tab.id]
    const linkedItem = tab.collectionItemId
        ? items.find(i => i.id === tab.collectionItemId)
        : undefined
    // Effective request headers: persistent (minus the ones switched off for this tab) merged with the tab's own.
    const enabledHeaders = Object.keys(
        mergeHeaders(persistentHeadersForTab(persistentHeaders, tab), tab.headers),
    ).length
    // The saved drawer height may be from a tall window; never let it squeeze the query editor out
    // (stacked tablet split, phones, short windows).
    const maxBottom = paneHeight > 0 ? Math.max(72, paneHeight - MIN_EDITOR_CHROME) : Infinity
    const effectiveBottomHeight = Math.min(
        bottomHeight,
        maxBottom,
        isMobile ? MOBILE_BOTTOM_HEIGHT : Infinity,
    )

    const onRun = () => {
        if (isRunning) stop(tab.id)
        else run({ tabId: tab.id, operationName: selectedOp })
    }
    const onFormat = () => {
        try {
            update({ id: tab.id, patch: { query: prettify(tab.query) } })
            const v = safeParseJson(tab.variables)
            if (v.ok)
                update({
                    id: tab.id,
                    patch: { variables: JSON.stringify(v.value, null, 2) },
                })
        } catch (e) {
            toast({
                title: "Cannot prettify",
                description: (e as Error).message,
                tone: "error",
            })
        }
    }
    const onSave = () => {
        if (!tab.query.trim()) return
        if (linkedItem) {
            saveItem({
                id: linkedItem.id,
                collectionId: linkedItem.collectionId,
                name: linkedItem.name,
                query: tab.query,
                variables: tab.variables,
                headers: tab.headers,
            })
            toast({
                title: "Saved",
                description: `“${linkedItem.name}” updated in collection`,
                tone: "success",
            })
        } else openModal({ kind: "saveToCollection", tabId: tab.id })
    }

    return (
        <div className={styles.root} ref={rootRef}>
            <div className={styles.toolbar}>
                {/* On phones Run sits in the Query/Response switcher (Workspace) so it's reachable from both views. */}
                {!isMobile && <RunButton />}

                <AnimatePresence>
                    {multi && (
                        <motion.label
                            className={styles.opPicker}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -8 }}
                        >
                            <span>Operation</span>
                            <select
                                value={selectedOp ?? ""}
                                title="Follows the cursor; pick one to jump to it"
                                onChange={e => editorRef.current?.revealOperation(e.target.value)}
                            >
                                {namedOps.map(o => (
                                    <option key={o.name!} value={o.name!}>
                                        {o.kind} {o.name}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown />
                        </motion.label>
                    )}
                </AnimatePresence>

                <div className={styles.spacer} />

                {linkedItem && (
                    <span
                        className={styles.linkedLabel}
                        title="This tab is linked to a collection item"
                    >
                        <KindBadge kind={linkedItem.kind} compact /> {linkedItem.name}
                    </span>
                )}
                <IconButton label="Prettify (Shift+Alt+F)" onClick={onFormat}>
                    <Sparkles />
                </IconButton>
                <IconButton
                    label={
                        linkedItem
                            ? `Update “${linkedItem.name}” (${modKey}+S)`
                            : `Save to collection (${modKey}+S)`
                    }
                    onClick={onSave}
                >
                    <Save />
                </IconButton>
                <IconButton
                    label="Clear editor"
                    onClick={() =>
                        openModal({
                            kind: "confirm",
                            title: "Clear this tab?",
                            message: "Query, variables and per‑tab headers will be emptied.",
                            onConfirm: () =>
                                update({
                                    id: tab.id,
                                    patch: {
                                        query: "",
                                        variables: "{}",
                                        headers: [],
                                        collectionItemId: undefined,
                                        title: "Untitled",
                                    },
                                }),
                        })
                    }
                >
                    <Eraser />
                </IconButton>
            </div>

            <div className={styles.editor}>
                <CodeEditor
                    value={tab.query}
                    onChange={query => update({ id: tab.id, patch: { query } })}
                    language="graphql"
                    schema={schema}
                    placeholder="Write a query, mutation or subscription…"
                    onRun={onRun}
                    onSave={onSave}
                    onFormat={onFormat}
                    onOpenType={onOpenType}
                    onActiveOperationChange={setCursorOp}
                    ref={editorRef}
                />
            </div>

            <div className={`${styles.bottom} ${bottomCollapsed ? styles.bottomCollapsed : ""}`}>
                {!bottomCollapsed && !isMobile && (
                    <div
                        className={styles.resizer}
                        onPointerDown={onResizeStart}
                        onDoubleClick={() => setBottomHeight(DEFAULT_BOTTOM_HEIGHT)}
                    />
                )}
                <div className={styles.bottomTabs}>
                    <button
                        className={`${styles.bottomTab} ${bottomTab === "variables" ? styles.bottomTabActive : ""}`}
                        onClick={() => setBottomTab("variables")}
                    >
                        <Braces />
                        Variables
                        {varsProblem && <span className={styles.warnDot} title={varsProblem} />}
                    </button>
                    <button
                        className={`${styles.bottomTab} ${bottomTab === "headers" ? styles.bottomTabActive : ""}`}
                        onClick={() => setBottomTab("headers")}
                    >
                        <KeyRound />
                        Headers
                        {enabledHeaders > 0 && (
                            <span className={styles.count}>{enabledHeaders}</span>
                        )}
                    </button>
                    <div className={styles.spacer} />
                    <IconButton
                        label={bottomCollapsed ? "Expand" : "Collapse"}
                        size="sm"
                        onClick={() => toggleBottom()}
                    >
                        {bottomCollapsed ? <ChevronUp /> : <ChevronDown />}
                    </IconButton>
                </div>
                <AnimatePresence initial={false}>
                    {!bottomCollapsed && (
                        <motion.div
                            className={styles.bottomBody}
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: effectiveBottomHeight, opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={
                                dragging.current
                                    ? { duration: 0 }
                                    : { type: "spring", stiffness: 360, damping: 34 }
                            }
                        >
                            <div
                                className={styles.bottomInner}
                                style={{ height: effectiveBottomHeight }}
                            >
                                {bottomTab === "variables" ? (
                                    <CodeEditor
                                        value={tab.variables}
                                        onChange={variables =>
                                            update({ id: tab.id, patch: { variables } })
                                        }
                                        language="json"
                                        schema={schema}
                                        query={tab.query}
                                        operationName={selectedOp}
                                        placeholder='{ "id": "1" }'
                                        onRun={onRun}
                                        onSave={onSave}
                                        onFormat={onFormat}
                                        onOpenType={onOpenType}
                                    />
                                ) : (
                                    <div className={styles.headersScroll}>
                                        <TabHeaders tab={tab} />
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    )
}
