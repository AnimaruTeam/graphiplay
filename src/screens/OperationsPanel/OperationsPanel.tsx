import { useUnit } from "effector-react"
import type { GraphQLField, GraphQLSchema } from "graphql"
import { ChevronRight, Layers, Search, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useMemo, useState } from "react"

import { Button, CodeEditor, EmptyState, KindBadge, Markdown } from "@/components"
import { $schema, $schemaLoading, docsPushed, fetchSchema, panelSelected } from "@/models"
import { Highlight, InsertOperation, TypeLink } from "@/screens"
import { generateOperation } from "@/shared/lib/graphql"
import type { OperationKind } from "@/shared/types"

import styles from "./OperationsPanel.module.css"

type Filter = "all" | OperationKind

interface Op {
    kind: OperationKind
    typeName: string
    field: GraphQLField<unknown, unknown>
}

function collect(schema: GraphQLSchema): Op[] {
    const out: Op[] = []
    const roots: [OperationKind, ReturnType<GraphQLSchema["getQueryType"]>][] = [
        ["query", schema.getQueryType()],
        ["mutation", schema.getMutationType()],
        ["subscription", schema.getSubscriptionType()],
    ]
    for (const [kind, type] of roots) {
        if (!type) continue
        for (const field of Object.values(type.getFields()))
            out.push({ kind, typeName: type.name, field })
    }
    return out
}

export function OperationsPanel() {
    const [schema, loading, refetch] = useUnit([$schema, $schemaLoading, fetchSchema])
    const [filter, setFilter] = useState<Filter>("all")
    const [search, setSearch] = useState("")
    const [expanded, setExpanded] = useState<string | null>(null)

    const ops = useMemo(() => (schema ? collect(schema) : []), [schema])
    const counts = useMemo(
        () => ({
            all: ops.length,
            query: ops.filter(o => o.kind === "query").length,
            mutation: ops.filter(o => o.kind === "mutation").length,
            subscription: ops.filter(o => o.kind === "subscription").length,
        }),
        [ops],
    )
    const q = search.trim().toLowerCase()
    const visible = ops.filter(
        o =>
            (filter === "all" || o.kind === filter) &&
            (!q ||
                o.field.name.toLowerCase().includes(q) ||
                o.field.description?.toLowerCase().includes(q)),
    )

    if (!schema) {
        return (
            <EmptyState
                icon={<Layers />}
                title="No operations yet"
                description="Load a schema to list every query, mutation and subscription it exposes."
                action={
                    <Button variant="primary" onClick={() => refetch()} loading={loading}>
                        Load schema
                    </Button>
                }
            />
        )
    }

    return (
        <div className={styles.root}>
            <div className={styles.toolbar}>
                <div className={styles.searchBox}>
                    <Search />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Filter operations"
                        spellCheck={false}
                    />
                    {search && (
                        <button
                            className={styles.clear}
                            onClick={() => setSearch("")}
                            aria-label="Clear"
                        >
                            <X />
                        </button>
                    )}
                </div>
            </div>
            <div className={styles.chips}>
                {(["all", "query", "mutation", "subscription"] as Filter[]).map(f => (
                    <button
                        key={f}
                        className={`${styles.chip} ${styles[`chip_${f}`]} ${filter === f ? styles.chipActive : ""}`}
                        onClick={() => setFilter(f)}
                    >
                        {f === "all" ? "All" : f}
                        <span className={styles.chipCount}>{counts[f]}</span>
                    </button>
                ))}
            </div>

            <div className={styles.list}>
                {visible.length === 0 && (
                    <EmptyState
                        title="Nothing matches"
                        description="Try a different filter or search term."
                    />
                )}
                {visible.map(op => {
                    const key = `${op.kind}.${op.field.name}`
                    const isOpen = expanded === key
                    return (
                        <div
                            key={key}
                            className={`${styles.item} ${isOpen ? styles.itemOpen : ""}`}
                        >
                            <button
                                className={styles.itemHead}
                                onClick={() => setExpanded(isOpen ? null : key)}
                            >
                                <ChevronRight
                                    className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ""}`}
                                />
                                <KindBadge kind={op.kind} compact />
                                <span className={styles.name}>
                                    <Highlight text={op.field.name} q={q} />
                                </span>
                                {op.field.args.length > 0 && (
                                    <span className={styles.args}>
                                        {op.field.args.length} arg
                                        {op.field.args.length > 1 ? "s" : ""}
                                    </span>
                                )}
                                <span className={styles.ret} onClick={e => e.stopPropagation()}>
                                    <TypeLink type={op.field.type} />
                                </span>
                            </button>
                            <AnimatePresence initial={false}>
                                {isOpen && (
                                    <motion.div
                                        key="body"
                                        className={styles.body}
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ type: "spring", stiffness: 380, damping: 36 }}
                                    >
                                        <OpBody schema={schema} op={op} />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

function OpBody({ schema, op }: { schema: GraphQLSchema; op: Op }) {
    const [push, selectPanel] = useUnit([docsPushed, panelSelected])
    const preview = useMemo(() => generateOperation(schema, op.kind, op.field), [schema, op])
    const lines = preview.query.split("\n").length
    return (
        <div className={styles.bodyInner}>
            {op.field.description && (
                <Markdown source={op.field.description} className={styles.desc} />
            )}
            {op.field.args.length > 0 && (
                <div className={styles.argList}>
                    {op.field.args.map(a => (
                        <div key={a.name} className={styles.argRow}>
                            <span className={styles.argName}>{a.name}</span>
                            <span className={styles.colon}>:</span>
                            <TypeLink type={a.type} />
                        </div>
                    ))}
                </div>
            )}
            <div className={styles.preview} style={{ height: Math.min(260, 24 + lines * 20.8) }}>
                <CodeEditor value={preview.query} language="graphql" readOnly lineNumbers={false} />
            </div>
            <div className={styles.actions}>
                <InsertOperation schema={schema} kind={op.kind} field={op.field} />
                <button
                    className={styles.docsLink}
                    onClick={() => {
                        push({ kind: "field", typeName: op.typeName, fieldName: op.field.name })
                        selectPanel("schema")
                    }}
                >
                    Open in schema docs →
                </button>
            </div>
        </div>
    )
}
