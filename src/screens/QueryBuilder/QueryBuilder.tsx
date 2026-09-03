import { useUnit } from "effector-react"
import {
    type ArgumentNode,
    type FieldNode,
    type GraphQLField,
    type GraphQLNamedType,
    type GraphQLOutputType,
    type GraphQLSchema,
    type InlineFragmentNode,
    Kind,
    type OperationDefinitionNode,
    getNamedType,
    isInterfaceType,
    isLeafType,
    isObjectType,
} from "graphql"
import { AlertTriangle, ChevronRight, ListTree, Search, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button, Checkbox, EmptyState, KindBadge } from "@/components"
import {
    $activeTab,
    $cursorOperation,
    $schema,
    $schemaLoading,
    fetchSchema,
    queryEditRequested,
    tabUpdated,
} from "@/models"
import {
    type BuilderInput,
    type BuilderResult,
    type PathSeg,
    argPreview,
    indexSelections,
    isRequiredArg,
    isTargetBroken,
    parseQuery,
    pathKey,
    possibleTypes,
    resolveTargetOp,
    rootType,
    setAllArguments,
    toggleArgument,
    toggleField,
    typeGroupClass,
} from "@/shared/lib/graphql"
import { markdownPlain } from "@/shared/lib/markdown"
import type { OperationKind } from "@/shared/types"

import styles from "./QueryBuilder.module.css"

type SelectionIndex = Map<string, FieldNode | InlineFragmentNode>

interface TreeCtx {
    schema: GraphQLSchema
    kind: OperationKind
    /** Selections of the operation being edited for this root kind; empty when none exists. */
    index: SelectionIndex
    disabled: boolean
    onToggleField: (path: PathSeg[]) => void
    onToggleArg: (path: PathSeg[], arg: string) => void
    onAllArgs: (path: PathSeg[], on: boolean) => void
}

const KINDS: OperationKind[] = ["query", "mutation", "subscription"]

export function QueryBuilder() {
    const [schema, loading, refetch] = useUnit([$schema, $schemaLoading, fetchSchema])
    const [tab, cursorOp, update, requestEdit] = useUnit([
        $activeTab,
        $cursorOperation,
        tabUpdated,
        queryEditRequested,
    ])
    const [search, setSearch] = useState("")

    const query = tab?.query ?? ""
    // One parse per query change; every row then does O(1) lookups.
    const parsed = useMemo(() => parseQuery(query), [query])
    const targetBroken = isTargetBroken(parsed, cursorOp)
    const target = useMemo(
        () => (targetBroken ? null : resolveTargetOp(parsed.doc, cursorOp)),
        [parsed, cursorOp, targetBroken],
    )
    const outside = !!cursorOp && cursorOp.placement !== "inside"
    const indexes = useMemo(() => {
        const out = new Map<OperationKind, SelectionIndex>()
        // Cursor in a gap: nothing is "current" — any check starts a new operation there.
        if (targetBroken || outside) return out
        for (const kind of KINDS) {
            const op =
                target?.operation === kind
                    ? target
                    : parsed.doc.definitions.find(
                          (d): d is OperationDefinitionNode =>
                              d.kind === Kind.OPERATION_DEFINITION && d.operation === kind,
                      )
            out.set(kind, op ? indexSelections(op) : new Map())
        }
        return out
    }, [parsed, target, outside, targetBroken])

    if (!schema) {
        return (
            <EmptyState
                icon={<ListTree />}
                title="Nothing to build from"
                description="Load a schema to pick fields and arguments with checkboxes."
                action={
                    <Button variant="primary" onClick={() => refetch()} loading={loading}>
                        Load schema
                    </Button>
                }
            />
        )
    }

    const apply = (result: BuilderResult | null) => {
        if (!result || !tab) return
        requestEdit({
            tabId: tab.id,
            change: result.change,
            query: result.query,
            cursor: result.cursor,
        })
        if (result.variables !== undefined)
            update({ id: tab.id, patch: { variables: result.variables } })
    }
    const input = (): BuilderInput | null =>
        tab ? { schema, query: tab.query, variables: tab.variables, active: cursorOp } : null
    const ctxFor = (kind: OperationKind): TreeCtx => ({
        schema,
        kind,
        index: indexes.get(kind) ?? new Map(),
        disabled: targetBroken || !tab,
        onToggleField: path => {
            const i = input()
            if (i) apply(toggleField(i, kind, path))
        },
        onToggleArg: (path, arg) => {
            const i = input()
            if (i) apply(toggleArgument(i, kind, path, arg))
        },
        onAllArgs: (path, on) => {
            const i = input()
            if (i) apply(setAllArguments(i, kind, path, on))
        },
    })

    const q = search.trim().toLowerCase()
    const groups = KINDS.map(kind => {
        const type = rootType(schema, kind)
        if (!type) return null
        const fields = Object.values(type.getFields()).filter(
            f => !q || f.name.toLowerCase().includes(q),
        )
        return {
            kind,
            fields,
            selected: [...(indexes.get(kind)?.keys() ?? [])].filter(k => !k.includes("/")).length,
        }
    }).filter((g): g is NonNullable<typeof g> => !!g && (g.fields.length > 0 || !q))

    return (
        <div className={styles.root}>
            <div className={styles.toolbar}>
                <div className={styles.searchBox}>
                    <Search />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Filter root fields"
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
                <div className={styles.status}>
                    {targetBroken ? (
                        <span className={styles.statusError} title={parsed.error ?? undefined}>
                            <AlertTriangle /> This operation has a syntax error — fix it to edit
                            with checkboxes
                        </span>
                    ) : target ? (
                        <>
                            <span>Editing</span>
                            <KindBadge kind={target.operation as OperationKind} compact />
                            <span className={styles.opName}>
                                {target.name?.value ?? "anonymous"}
                            </span>
                        </>
                    ) : outside ? (
                        <span>
                            Cursor is outside operations — checking a field starts a new one there
                        </span>
                    ) : (
                        <span>Check a field to start a new operation</span>
                    )}
                </div>
            </div>

            <div className={styles.tree}>
                {groups.map(g => (
                    <section key={g.kind} className={styles.group}>
                        <header className={styles.groupLabel}>
                            <span>{g.kind}</span>
                            {g.selected > 0 && (
                                <span className={styles.groupCount}>{g.selected}</span>
                            )}
                        </header>
                        {g.fields.map(f => (
                            <FieldRow
                                key={f.name}
                                ctx={ctxFor(g.kind)}
                                field={f}
                                path={[{ field: f.name }]}
                            />
                        ))}
                    </section>
                ))}
            </div>
        </div>
    )
}

function typeLabel(type: GraphQLOutputType) {
    return type.toString()
}

function FieldRow({
    ctx,
    field,
    path,
}: {
    ctx: TreeCtx
    field: GraphQLField<unknown, unknown>
    path: PathSeg[]
}) {
    const key = pathKey(path)
    const node = ctx.index.get(key)
    const checked = node?.kind === Kind.FIELD
    const named: GraphQLNamedType = getNamedType(field.type)
    const composite = !isLeafType(named)
    const expandable = composite || field.args.length > 0
    const [open, setOpen] = useState(checked)
    // A selection appearing from the editor side opens the node so the user sees what's checked.
    useEffect(() => {
        if (checked) setOpen(true)
    }, [checked])

    const argNodes = checked ? (node.arguments ?? []) : []
    const alias = checked && node.alias ? node.alias.value : null

    return (
        <div className={styles.node}>
            <div
                className={`${styles.row} ${checked ? styles.rowOn : ""} ${field.deprecationReason ? styles.deprecated : ""}`}
                onClick={() => expandable && setOpen(v => !v)}
            >
                <span
                    className={`${styles.chevron} ${open ? styles.chevronOpen : ""} ${expandable ? "" : styles.chevronHidden}`}
                >
                    <ChevronRight />
                </span>
                <Checkbox
                    checked={checked}
                    disabled={ctx.disabled}
                    onChange={() => ctx.onToggleField(path)}
                    label={checked ? `Remove ${field.name}` : `Add ${field.name}`}
                />
                <span
                    className={styles.label}
                    title={field.description ? markdownPlain(field.description) : undefined}
                >
                    {alias && <span className={styles.alias}>{alias}: </span>}
                    <span className={styles.fieldName}>{field.name}</span>
                    <span className={styles.colon}> : </span>
                    <span className={`${styles.type} ${typeGroupClass(field.type)}`}>
                        {typeLabel(field.type)}
                    </span>
                </span>
            </div>
            {open && expandable && (
                <div className={styles.children}>
                    {field.args.length > 0 && (
                        <ArgsGroup
                            ctx={ctx}
                            field={field}
                            path={path}
                            present={argNodes.map(a => a.name.value)}
                            argNodes={argNodes}
                        />
                    )}
                    {composite && <TypeChildren ctx={ctx} type={named} path={path} />}
                </div>
            )}
        </div>
    )
}

function ArgsGroup({
    ctx,
    field,
    path,
    present,
    argNodes,
}: {
    ctx: TreeCtx
    field: GraphQLField<unknown, unknown>
    path: PathSeg[]
    present: string[]
    argNodes: readonly ArgumentNode[]
}) {
    const [open, setOpen] = useState(present.length > 0)
    useEffect(() => {
        if (present.length) setOpen(true)
    }, [present.length])
    const optional = field.args.filter(a => !isRequiredArg(a))
    const selectedOptional = optional.filter(a => present.includes(a.name)).length
    const state: boolean | "mixed" =
        optional.length === 0
            ? present.length > 0
            : selectedOptional === 0
              ? false
              : selectedOptional === optional.length
                ? true
                : "mixed"

    return (
        <div className={styles.node}>
            <div className={styles.row} onClick={() => setOpen(v => !v)}>
                <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}>
                    <ChevronRight />
                </span>
                <Checkbox
                    checked={state}
                    disabled={ctx.disabled || optional.length === 0}
                    onChange={on => ctx.onAllArgs(path, on)}
                    label="Toggle all arguments"
                />
                <span className={`${styles.label} ${styles.argsLabel}`}>[arguments]</span>
            </div>
            {open && (
                <div className={styles.children}>
                    {field.args.map(a => {
                        const on = present.includes(a.name)
                        const required = isRequiredArg(a)
                        const current = argNodes.find(n => n.name.value === a.name)
                        return (
                            <div
                                key={a.name}
                                className={`${styles.row} ${styles.leafRow} ${on ? styles.rowOn : ""}`}
                            >
                                <Checkbox
                                    checked={on}
                                    disabled={ctx.disabled || (required && on)}
                                    onChange={() => ctx.onToggleArg(path, a.name)}
                                    label={
                                        required
                                            ? `${a.name} is required`
                                            : on
                                              ? `Remove ${a.name}`
                                              : `Add ${a.name}`
                                    }
                                />
                                <span
                                    className={styles.label}
                                    title={a.description ? markdownPlain(a.description) : undefined}
                                >
                                    <span className={styles.argName}>{a.name}</span>
                                    <span className={styles.colon}> : </span>
                                    <span className={`${styles.type} ${typeGroupClass(a.type)}`}>
                                        {a.type.toString()}
                                    </span>
                                    {current && (
                                        <span className={styles.preview}>
                                            {argPreview(current)}
                                        </span>
                                    )}
                                </span>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

function TypeChildren({
    ctx,
    type,
    path,
}: {
    ctx: TreeCtx
    type: GraphQLNamedType
    path: PathSeg[]
}) {
    const fields =
        isObjectType(type) || isInterfaceType(type) ? Object.values(type.getFields()) : []
    const members = possibleTypes(ctx.schema, type as GraphQLOutputType)
    return (
        <>
            {fields.map(f => (
                <FieldRow key={f.name} ctx={ctx} field={f} path={[...path, { field: f.name }]} />
            ))}
            {members.map(m => (
                <FragmentRow
                    key={m.name}
                    ctx={ctx}
                    typeName={m.name}
                    path={[...path, { on: m.name }]}
                />
            ))}
        </>
    )
}

function FragmentRow({ ctx, typeName, path }: { ctx: TreeCtx; typeName: string; path: PathSeg[] }) {
    const checked = ctx.index.get(pathKey(path))?.kind === Kind.INLINE_FRAGMENT
    const [open, setOpen] = useState(checked)
    useEffect(() => {
        if (checked) setOpen(true)
    }, [checked])
    const type = ctx.schema.getType(typeName)
    if (!type) return null
    return (
        <div className={styles.node}>
            <div
                className={`${styles.row} ${checked ? styles.rowOn : ""}`}
                onClick={() => setOpen(v => !v)}
            >
                <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}>
                    <ChevronRight />
                </span>
                <Checkbox
                    checked={checked}
                    disabled={ctx.disabled}
                    onChange={() => ctx.onToggleField(path)}
                    label={
                        checked ? `Remove fragment on ${typeName}` : `Add fragment on ${typeName}`
                    }
                />
                <span className={styles.label}>
                    <span className={styles.fragmentKw}>... on </span>
                    <span className={`${styles.type} ${typeGroupClass(type)}`}>{typeName}</span>
                </span>
            </div>
            {open && (
                <div className={styles.children}>
                    <TypeChildren ctx={ctx} type={type} path={path} />
                </div>
            )}
        </div>
    )
}
