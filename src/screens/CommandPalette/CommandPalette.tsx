import { useUnit } from "effector-react"
import {
    BookMarked,
    FolderHeart,
    Github,
    History,
    KeyRound,
    Layers,
    ListTree,
    Play,
    Plus,
    RefreshCw,
    Search,
    Sparkles,
    Timer,
    X,
    Zap,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"

import { IconButton, Kbd, KindBadge, altKey, modKey } from "@/components"
import {
    $activeTab,
    $collections,
    $items,
    $paletteOpen,
    $schema,
    $schemaPolling,
    $tabs,
    docsPushed,
    docsReset,
    fetchSchema,
    modalOpened,
    paletteToggled,
    panelSelected,
    runRequested,
    schemaPollingToggled,
    sidebarToggled,
    tabActivated,
    tabAdded,
    tabUpdated,
    toastShown,
} from "@/models"
import { generateOperation, typeGroupClass } from "@/shared/lib/graphql"
import { useIsMobile } from "@/shared/lib/hooks"
import { REPO_URL } from "@/shared/meta"
import type { OperationKind } from "@/shared/types"

import styles from "./CommandPalette.module.css"

interface Item {
    id: string
    group: "Actions" | "Operations" | "Collections" | "Tabs" | "Types"
    label: string
    /** Extra class for the label — types use it to carry their kind's colour. */
    labelClass?: string
    hint?: string
    icon?: ReactNode
    kind?: OperationKind
    run: () => void
}

function score(label: string, q: string): number {
    const l = label.toLowerCase()
    if (l === q) return 100
    if (l.startsWith(q)) return 80
    if (l.includes(q)) return 60
    // subsequence match
    let i = 0
    for (const ch of l) if (ch === q[i]) i++
    return i === q.length ? 30 : 0
}

export function CommandPalette() {
    const [open, toggle] = useUnit([$paletteOpen, paletteToggled])
    const isMobile = useIsMobile()
    const [
        schema,
        refetch,
        tabs,
        activeTab,
        addTab,
        activate,
        update,
        collections,
        items,
        run,
        selectPanel,
        push,
        resetDocs,
        openModal,
        toggleSidebar,
        toast,
    ] = useUnit([
        $schema,
        fetchSchema,
        $tabs,
        $activeTab,
        tabAdded,
        tabActivated,
        tabUpdated,
        $collections,
        $items,
        runRequested,
        panelSelected,
        docsPushed,
        docsReset,
        modalOpened,
        sidebarToggled,
        toastShown,
    ])
    const [polling, togglePolling] = useUnit([$schemaPolling, schemaPollingToggled])
    const [query, setQuery] = useState("")
    const [cursor, setCursor] = useState(0)
    const listRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (open) {
            setQuery("")
            setCursor(0)
        }
    }, [open])

    const all = useMemo<Item[]>(() => {
        const close = () => toggle(false)
        const out: Item[] = [
            {
                id: "run",
                group: "Actions",
                label: "Run active operation",
                hint: `${modKey} ↵`,
                icon: <Play />,
                run: () => {
                    close()
                    run()
                },
            },
            {
                id: "new-tab",
                group: "Actions",
                label: "New tab",
                hint: `${altKey} T`,
                icon: <Plus />,
                run: () => {
                    close()
                    addTab({ query: "" })
                },
            },
            {
                id: "save",
                group: "Actions",
                label: "Save to collection",
                hint: `${modKey} S`,
                icon: <FolderHeart />,
                run: () => {
                    close()
                    if (activeTab) openModal({ kind: "saveToCollection", tabId: activeTab.id })
                },
            },
            {
                id: "refetch",
                group: "Actions",
                label: "Reload schema",
                icon: <RefreshCw />,
                run: () => {
                    close()
                    refetch()
                },
            },
            {
                id: "polling",
                group: "Actions",
                label: polling ? "Disable schema polling" : "Enable schema polling",
                icon: <Timer />,
                run: () => {
                    close()
                    togglePolling()
                },
            },
            {
                id: "sidebar",
                group: "Actions",
                label: "Toggle sidebar",
                hint: `${modKey} B`,
                icon: <Sparkles />,
                run: () => {
                    close()
                    toggleSidebar()
                },
            },
            {
                id: "p-schema",
                group: "Actions",
                label: "Go to Schema",
                icon: <BookMarked />,
                run: () => {
                    close()
                    selectPanel("schema")
                },
            },
            {
                id: "p-builder",
                group: "Actions",
                label: "Go to Query builder",
                icon: <ListTree />,
                run: () => {
                    close()
                    selectPanel("builder")
                },
            },
            {
                id: "p-ops",
                group: "Actions",
                label: "Go to Operations",
                icon: <Layers />,
                run: () => {
                    close()
                    selectPanel("operations")
                },
            },
            {
                id: "p-coll",
                group: "Actions",
                label: "Go to Collections",
                icon: <FolderHeart />,
                run: () => {
                    close()
                    selectPanel("collections")
                },
            },
            {
                id: "p-hist",
                group: "Actions",
                label: "Go to History",
                icon: <History />,
                run: () => {
                    close()
                    selectPanel("history")
                },
            },
            {
                id: "p-headers",
                group: "Actions",
                label: "Edit persistent headers",
                icon: <KeyRound />,
                run: () => {
                    close()
                    selectPanel("headers")
                },
            },
            {
                id: "settings",
                group: "Actions",
                label: "Endpoint settings",
                icon: <Zap />,
                run: () => {
                    close()
                    openModal({ kind: "endpointSettings" })
                },
            },
            {
                id: "repo",
                group: "Actions",
                label: "Graphiplay on GitHub",
                hint: "source",
                icon: <Github />,
                run: () => {
                    close()
                    window.open(REPO_URL, "_blank", "noopener,noreferrer")
                },
            },
        ]
        for (const t of tabs) {
            out.push({
                id: `tab-${t.id}`,
                group: "Tabs",
                label: t.title,
                hint: t.id === activeTab?.id ? "active" : undefined,
                run: () => {
                    close()
                    activate(t.id)
                },
            })
        }
        for (const it of items) {
            const c = collections.find(x => x.id === it.collectionId)
            out.push({
                id: `item-${it.id}`,
                group: "Collections",
                label: it.name,
                hint: c?.name,
                kind: it.kind,
                run: () => {
                    close()
                    const linked = tabs.find(t => t.collectionItemId === it.id)
                    if (linked) activate(linked.id)
                    else
                        addTab({
                            query: it.query,
                            variables: it.variables,
                            headers: it.headers.map(h => ({ ...h })),
                            title: it.name,
                            collectionItemId: it.id,
                        })
                },
            })
        }
        if (schema) {
            const roots: [OperationKind, ReturnType<typeof schema.getQueryType>][] = [
                ["query", schema.getQueryType()],
                ["mutation", schema.getMutationType()],
                ["subscription", schema.getSubscriptionType()],
            ]
            for (const [kind, type] of roots) {
                if (!type) continue
                for (const f of Object.values(type.getFields())) {
                    out.push({
                        id: `op-${kind}-${f.name}`,
                        group: "Operations",
                        label: f.name,
                        kind,
                        hint: "insert",
                        run: () => {
                            close()
                            const gen = generateOperation(schema, kind, f)
                            if (activeTab && !activeTab.query.trim())
                                update({
                                    id: activeTab.id,
                                    patch: {
                                        query: gen.query,
                                        variables: gen.variables,
                                        title: f.name,
                                    },
                                })
                            else
                                addTab({
                                    query: gen.query,
                                    variables: gen.variables,
                                    title: f.name,
                                })
                            toast({ title: `Inserted ${kind} ${f.name}`, tone: "success" })
                        },
                    })
                }
            }
            for (const [name, t] of Object.entries(schema.getTypeMap())) {
                if (name.startsWith("__")) continue
                out.push({
                    id: `type-${name}`,
                    group: "Types",
                    label: name,
                    labelClass: typeGroupClass(t),
                    hint: t.constructor.name
                        .replace("GraphQL", "")
                        .replace("Type", "")
                        .toLowerCase(),
                    icon: <BookMarked />,
                    run: () => {
                        close()
                        resetDocs()
                        push({ kind: "type", name })
                        selectPanel("schema")
                    },
                })
            }
        }
        return out
    }, [
        schema,
        tabs,
        activeTab,
        items,
        collections,
        toggle,
        run,
        addTab,
        activate,
        update,
        refetch,
        polling,
        togglePolling,
        selectPanel,
        push,
        resetDocs,
        openModal,
        toggleSidebar,
        toast,
    ])

    const q = query.trim().toLowerCase()
    const visible = useMemo(() => {
        if (!q) return all.filter(i => i.group === "Actions" || i.group === "Tabs").slice(0, 14)
        return all
            .map(i => ({ i, s: score(i.label, q) }))
            .filter(x => x.s > 0)
            .map(x => ({ ...x, s: x.s + (x.i.group === "Actions" ? 5 : 0) }))
            .sort((a, b) => b.s - a.s)
            .slice(0, 40)
            .map(x => x.i)
    }, [all, q])

    useEffect(() => setCursor(0), [q])
    useEffect(() => {
        listRef.current
            ?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
            ?.scrollIntoView({ block: "nearest" })
    }, [cursor])

    const onKey = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault()
            setCursor(c => Math.min(visible.length - 1, c + 1))
        } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setCursor(c => Math.max(0, c - 1))
        } else if (e.key === "Enter") {
            e.preventDefault()
            visible[cursor]?.run()
        } else if (e.key === "Escape") {
            toggle(false)
        }
    }

    let lastGroup = ""
    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className={styles.backdrop}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    onMouseDown={e => {
                        if (e.target === e.currentTarget) toggle(false)
                    }}
                >
                    <motion.div
                        className={styles.panel}
                        initial={{ opacity: 0, y: -14, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.98 }}
                        transition={{ type: "spring", stiffness: 420, damping: 32, mass: 0.8 }}
                    >
                        <div className={styles.search}>
                            <Search />
                            <input
                                autoFocus
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                onKeyDown={onKey}
                                placeholder="Search operations, types, collections, actions…"
                                spellCheck={false}
                            />
                            {isMobile ? (
                                <IconButton label="Close" size="sm" onClick={() => toggle(false)}>
                                    <X />
                                </IconButton>
                            ) : (
                                <Kbd>esc</Kbd>
                            )}
                        </div>
                        <div className={styles.list} ref={listRef}>
                            {visible.length === 0 && (
                                <div className={styles.none}>Nothing found for “{query}”</div>
                            )}
                            {visible.map((it, idx) => {
                                const showGroup = it.group !== lastGroup
                                lastGroup = it.group
                                return (
                                    <div key={it.id}>
                                        {showGroup && (
                                            <div className={styles.group}>{it.group}</div>
                                        )}
                                        <button
                                            data-idx={idx}
                                            className={`${styles.item} ${idx === cursor ? styles.itemActive : ""}`}
                                            onMouseEnter={() => setCursor(idx)}
                                            onClick={it.run}
                                        >
                                            {it.kind ? (
                                                <KindBadge kind={it.kind} compact />
                                            ) : (
                                                <span className={styles.icon}>
                                                    {it.icon ?? <Search />}
                                                </span>
                                            )}
                                            <span
                                                className={`${styles.label} ${it.labelClass ?? ""}`}
                                            >
                                                {it.label}
                                            </span>
                                            {it.hint && (
                                                <span className={styles.hint}>{it.hint}</span>
                                            )}
                                        </button>
                                    </div>
                                )
                            })}
                        </div>
                        <div className={styles.foot}>
                            <span>
                                <Kbd>↑</Kbd>
                                <Kbd>↓</Kbd> navigate
                            </span>
                            <span>
                                <Kbd>↵</Kbd> select
                            </span>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
