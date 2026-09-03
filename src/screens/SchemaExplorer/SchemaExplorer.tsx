import { useUnit } from "effector-react"
import {
    type GraphQLArgument,
    type GraphQLField,
    type GraphQLNamedType,
    type GraphQLSchema,
    isEnumType,
    isInputObjectType,
    isInterfaceType,
    isObjectType,
    isScalarType,
    isUnionType,
} from "graphql"
import { ArrowDownToLine, ArrowLeft, ChevronRight, FileCode2, Play, Search, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useMemo } from "react"

import { Button, CodeEditor, EmptyState, IconButton, KindBadge, Markdown } from "@/components"
import {
    $activeTab,
    $docsCurrent,
    $docsSearch,
    $docsStack,
    $schema,
    $schemaError,
    $schemaLoading,
    $sdl,
    type DocsNode,
    docsJumped,
    docsPopped,
    docsPushed,
    docsReset,
    docsSearchChanged,
    fetchSchema,
    tabAdded,
    tabUpdated,
    toastShown,
} from "@/models"
import { TypeLink } from "@/screens"
import { generateOperation, typeGroupClass } from "@/shared/lib/graphql"
import type { OperationKind } from "@/shared/types"

import styles from "./SchemaExplorer.module.css"

const variants = {
    enter: (dir: number) => ({ opacity: 0, x: dir * 24 }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => ({ opacity: 0, x: dir * -24 }),
}

export function SchemaExplorer() {
    const [schema, loading, error, stack, current, search] = useUnit([
        $schema,
        $schemaLoading,
        $schemaError,
        $docsStack,
        $docsCurrent,
        $docsSearch,
    ])
    const [push, pop, jump, reset, setSearch, refetch] = useUnit([
        docsPushed,
        docsPopped,
        docsJumped,
        docsReset,
        docsSearchChanged,
        fetchSchema,
    ])

    if (!schema) {
        return (
            <EmptyState
                icon={<FileCode2 />}
                title={loading ? "Loading schema…" : "No schema loaded"}
                description={
                    error ?? "Enter an endpoint URL at the top and load the schema to explore it."
                }
                action={
                    <Button variant="primary" onClick={() => refetch()} loading={loading}>
                        Load schema
                    </Button>
                }
            />
        )
    }

    const dir = 1

    return (
        <div className={styles.root}>
            <div className={styles.toolbar}>
                {stack.length > 1 && (
                    <IconButton label="Back" size="sm" onClick={() => pop()}>
                        <ArrowLeft />
                    </IconButton>
                )}
                <div className={styles.searchBox}>
                    <Search />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search types & fields"
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
                {current.kind !== "sdl" ? (
                    <IconButton
                        label="View full SDL"
                        size="sm"
                        onClick={() => push({ kind: "sdl" })}
                    >
                        <FileCode2 />
                    </IconButton>
                ) : (
                    <IconButton label="Back to explorer" size="sm" onClick={() => reset()}>
                        <X />
                    </IconButton>
                )}
            </div>

            {stack.length > 1 && (
                <div className={styles.crumbs}>
                    {stack.map((node, i) => (
                        <span key={i} className={styles.crumb}>
                            {i > 0 && <ChevronRight className={styles.crumbSep} />}
                            <button
                                className={i === stack.length - 1 ? styles.crumbActive : ""}
                                onClick={() => jump(i)}
                            >
                                {crumbLabel(node)}
                            </button>
                        </span>
                    ))}
                </div>
            )}

            <div className={styles.viewport}>
                <AnimatePresence mode="popLayout" custom={dir} initial={false}>
                    <motion.div
                        key={stackKey(current) + (search ? ":search" : "")}
                        className={styles.page}
                        custom={dir}
                        variants={variants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        transition={{ type: "spring", stiffness: 380, damping: 34 }}
                    >
                        {search.trim() ? (
                            <SearchResults schema={schema} query={search.trim()} />
                        ) : current.kind === "root" ? (
                            <RootView schema={schema} />
                        ) : current.kind === "type" ? (
                            <TypeView schema={schema} name={current.name} />
                        ) : current.kind === "field" ? (
                            <FieldView
                                schema={schema}
                                typeName={current.typeName}
                                fieldName={current.fieldName}
                            />
                        ) : (
                            <SdlView />
                        )}
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    )
}

function stackKey(node: DocsNode) {
    switch (node.kind) {
        case "root":
            return "root"
        case "sdl":
            return "sdl"
        case "type":
            return `type:${node.name}`
        case "field":
            return `field:${node.typeName}.${node.fieldName}`
    }
}

function crumbLabel(node: DocsNode) {
    switch (node.kind) {
        case "root":
            return "Schema"
        case "sdl":
            return "SDL"
        case "type":
            return node.name
        case "field":
            return node.fieldName
    }
}

// --- Root --------------------------------------------------------------------

function RootView({ schema }: { schema: GraphQLSchema }) {
    const push = useUnit(docsPushed)
    const roots = [
        { kind: "query" as const, type: schema.getQueryType() },
        { kind: "mutation" as const, type: schema.getMutationType() },
        { kind: "subscription" as const, type: schema.getSubscriptionType() },
    ].filter(r => r.type)

    const groups = useMemo(() => {
        const all = Object.values(schema.getTypeMap()).filter(t => !t.name.startsWith("__"))
        const rootNames = new Set(roots.map(r => r.type!.name))
        const by = (pred: (t: GraphQLNamedType) => boolean) =>
            all
                .filter(t => pred(t) && !rootNames.has(t.name))
                .sort((a, b) => a.name.localeCompare(b.name))
        return [
            { label: "Objects", items: by(isObjectType) },
            { label: "Inputs", items: by(isInputObjectType) },
            { label: "Enums", items: by(isEnumType) },
            { label: "Interfaces", items: by(isInterfaceType) },
            { label: "Unions", items: by(isUnionType) },
            { label: "Scalars", items: by(isScalarType) },
        ].filter(g => g.items.length)
    }, [schema])

    const description = schema.description

    return (
        <div className={styles.section}>
            {description && <Markdown source={description} className={styles.description} />}
            <div className={styles.groupLabel}>Root types</div>
            <div className={styles.rootGrid}>
                {roots.map(r => (
                    <button
                        key={r.kind}
                        className={`${styles.rootCard} ${styles[`root_${r.kind}`]}`}
                        onClick={() => push({ kind: "type", name: r.type!.name })}
                    >
                        <KindBadge kind={r.kind} />
                        <span className={styles.rootName}>{r.type!.name}</span>
                        <span className={styles.rootCount}>
                            {Object.keys(r.type!.getFields()).length} fields
                        </span>
                    </button>
                ))}
            </div>
            {groups.map(g => (
                <div key={g.label}>
                    <div className={styles.groupLabel}>
                        {g.label} <span className={styles.groupCount}>{g.items.length}</span>
                    </div>
                    <div className={styles.list}>
                        {g.items.map(t => (
                            <button
                                key={t.name}
                                className={styles.row}
                                onClick={() => push({ kind: "type", name: t.name })}
                            >
                                <span className={`${styles.rowName} ${typeGroupClass(t)}`}>
                                    {t.name}
                                </span>
                                {t.description && (
                                    <Markdown
                                        mode="inline"
                                        as="span"
                                        source={t.description}
                                        className={styles.rowDesc}
                                    />
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}

// --- Type --------------------------------------------------------------------

function TypeView({ schema, name }: { schema: GraphQLSchema; name: string }) {
    const push = useUnit(docsPushed)
    const type = schema.getType(name)
    if (!type) return <EmptyState title="Unknown type" description={name} />

    const rootKind = rootKindFor(schema, name)

    return (
        <div className={styles.section}>
            <div className={styles.typeHeader}>
                <span className={styles.typeKindLabel}>{typeKindLabel(type)}</span>
                <h3 className={`${styles.typeTitle} ${typeGroupClass(type)}`}>{type.name}</h3>
                {type.description && (
                    <Markdown source={type.description} className={styles.description} />
                )}
            </div>

            {(isObjectType(type) || isInterfaceType(type)) && type.getInterfaces().length > 0 && (
                <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Implements</span>
                    {type.getInterfaces().map(i => (
                        <TypeLink key={i.name} type={i} />
                    ))}
                </div>
            )}

            {(isObjectType(type) || isInterfaceType(type) || isInputObjectType(type)) && (
                <>
                    <div className={styles.groupLabel}>Fields</div>
                    <div className={styles.list}>
                        {Object.values(type.getFields()).map(f => (
                            <button
                                key={f.name}
                                className={`${styles.fieldRow} ${f.deprecationReason ? styles.deprecated : ""}`}
                                onClick={() =>
                                    isInputObjectType(type)
                                        ? push({
                                              kind: "type",
                                              name: f.type.toString().replace(/[!\[\]]/g, ""),
                                          })
                                        : push({
                                              kind: "field",
                                              typeName: type.name,
                                              fieldName: f.name,
                                          })
                                }
                            >
                                <div className={styles.fieldSig}>
                                    {rootKind && <KindBadge kind={rootKind} compact />}
                                    <span className={styles.fieldName}>{f.name}</span>
                                    {"args" in f && f.args.length > 0 && (
                                        <span className={styles.fieldArgs}>
                                            ({f.args.length} arg{f.args.length > 1 ? "s" : ""})
                                        </span>
                                    )}
                                    <span className={styles.colon}>:</span>
                                    <span onClick={e => e.stopPropagation()}>
                                        <TypeLink type={f.type} />
                                    </span>
                                </div>
                                {f.description && (
                                    <Markdown
                                        mode="inline"
                                        as="span"
                                        source={f.description}
                                        className={styles.rowDesc}
                                    />
                                )}
                            </button>
                        ))}
                    </div>
                </>
            )}

            {isEnumType(type) && (
                <>
                    <div className={styles.groupLabel}>Values</div>
                    <div className={styles.list}>
                        {type.getValues().map(v => (
                            <div
                                key={v.name}
                                className={`${styles.fieldRowStatic} ${v.deprecationReason ? styles.deprecated : ""}`}
                            >
                                <span className={styles.enumValue}>{v.name}</span>
                                {v.description && (
                                    <Markdown
                                        mode="inline"
                                        source={v.description}
                                        className={styles.rowDesc}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}

            {isUnionType(type) && (
                <>
                    <div className={styles.groupLabel}>Possible types</div>
                    <div className={styles.list}>
                        {type.getTypes().map(t => (
                            <div key={t.name} className={styles.fieldRowStatic}>
                                <TypeLink type={t} />
                            </div>
                        ))}
                    </div>
                </>
            )}

            {isInterfaceType(type) && (
                <>
                    <div className={styles.groupLabel}>Implemented by</div>
                    <div className={styles.list}>
                        {schema.getPossibleTypes(type).map(t => (
                            <div key={t.name} className={styles.fieldRowStatic}>
                                <TypeLink type={t} />
                            </div>
                        ))}
                    </div>
                </>
            )}

            {isScalarType(type) && type.specifiedByURL && (
                <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Specified by</span>
                    <a href={type.specifiedByURL} target="_blank" rel="noreferrer">
                        {type.specifiedByURL}
                    </a>
                </div>
            )}
        </div>
    )
}

function typeKindLabel(t: GraphQLNamedType) {
    if (isObjectType(t)) return "Object"
    if (isInputObjectType(t)) return "Input object"
    if (isEnumType(t)) return "Enum"
    if (isInterfaceType(t)) return "Interface"
    if (isUnionType(t)) return "Union"
    if (isScalarType(t)) return "Scalar"
    return "Type"
}

export function rootKindFor(schema: GraphQLSchema, typeName: string): OperationKind | null {
    if (schema.getQueryType()?.name === typeName) return "query"
    if (schema.getMutationType()?.name === typeName) return "mutation"
    if (schema.getSubscriptionType()?.name === typeName) return "subscription"
    return null
}

// --- Field -------------------------------------------------------------------

function FieldView({
    schema,
    typeName,
    fieldName,
}: {
    schema: GraphQLSchema
    typeName: string
    fieldName: string
}) {
    const type = schema.getType(typeName)
    const field =
        type && (isObjectType(type) || isInterfaceType(type))
            ? type.getFields()[fieldName]
            : undefined
    if (!type || !field)
        return <EmptyState title="Unknown field" description={`${typeName}.${fieldName}`} />
    const rootKind = rootKindFor(schema, typeName)

    return (
        <div className={styles.section}>
            <div className={styles.typeHeader}>
                <span className={styles.typeKindLabel}>
                    Field on <TypeLink type={type} />
                </span>
                <h3 className={styles.typeTitle}>
                    {rootKind && <KindBadge kind={rootKind} />}
                    {field.name}
                </h3>
                {field.description && (
                    <Markdown source={field.description} className={styles.description} />
                )}
                {field.deprecationReason && (
                    <p className={styles.deprecationNote}>Deprecated: {field.deprecationReason}</p>
                )}
            </div>

            <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Returns</span>
                <TypeLink type={field.type} />
            </div>

            {field.args.length > 0 && (
                <>
                    <div className={styles.groupLabel}>Arguments</div>
                    <div className={styles.list}>
                        {field.args.map(a => (
                            <ArgRow key={a.name} arg={a} />
                        ))}
                    </div>
                </>
            )}

            {rootKind && <InsertOperation schema={schema} kind={rootKind} field={field} />}
        </div>
    )
}

function ArgRow({ arg }: { arg: GraphQLArgument }) {
    return (
        <div className={styles.fieldRowStatic}>
            <div className={styles.fieldSig}>
                <span className={styles.argName}>{arg.name}</span>
                <span className={styles.colon}>:</span>
                <TypeLink type={arg.type} />
                {arg.defaultValue !== undefined && (
                    <span className={styles.defaultValue}>
                        = {JSON.stringify(arg.defaultValue)}
                    </span>
                )}
            </div>
            {arg.description && (
                <Markdown mode="inline" source={arg.description} className={styles.rowDesc} />
            )}
        </div>
    )
}

export function InsertOperation({
    schema,
    kind,
    field,
    compact,
}: {
    schema: GraphQLSchema
    kind: OperationKind
    field: GraphQLField<unknown, unknown>
    compact?: boolean
}) {
    const [activeTab, update, add, toast] = useUnit([$activeTab, tabUpdated, tabAdded, toastShown])
    const insert = (mode: "replace" | "new") => {
        const { query, variables } = generateOperation(schema, kind, field)
        if (mode === "new" || !activeTab) {
            add({ query, variables, title: field.name })
        } else {
            update({
                id: activeTab.id,
                patch: { query, variables, title: field.name, collectionItemId: undefined },
            })
        }
        toast({ title: `Inserted ${kind} ${field.name}`, tone: "success" })
    }
    if (compact) {
        return (
            <div className={styles.inlineActions} onClick={e => e.stopPropagation()}>
                <IconButton
                    label="Insert into current tab"
                    size="sm"
                    onClick={() => insert("replace")}
                >
                    <ArrowDownToLine />
                </IconButton>
                <IconButton label="Open in new tab" size="sm" onClick={() => insert("new")}>
                    <Play />
                </IconButton>
            </div>
        )
    }
    return (
        <div className={styles.insertBox}>
            <Button variant="primary" icon={<ArrowDownToLine />} onClick={() => insert("replace")}>
                Insert into editor
            </Button>
            <Button variant="soft" icon={<Play />} onClick={() => insert("new")}>
                Open in new tab
            </Button>
        </div>
    )
}

// --- Search ------------------------------------------------------------------

function SearchResults({ schema, query }: { schema: GraphQLSchema; query: string }) {
    const push = useUnit(docsPushed)
    const q = query.toLowerCase()
    const results = useMemo(() => {
        const types: GraphQLNamedType[] = []
        const fields: { type: GraphQLNamedType; field: GraphQLField<unknown, unknown> }[] = []
        for (const t of Object.values(schema.getTypeMap())) {
            if (t.name.startsWith("__")) continue
            if (t.name.toLowerCase().includes(q)) types.push(t)
            if (isObjectType(t) || isInterfaceType(t)) {
                for (const f of Object.values(t.getFields())) {
                    if (f.name.toLowerCase().includes(q)) fields.push({ type: t, field: f })
                }
            }
        }
        const score = (s: string) => (s.toLowerCase().startsWith(q) ? 0 : 1)
        types.sort((a, b) => score(a.name) - score(b.name) || a.name.localeCompare(b.name))
        fields.sort(
            (a, b) =>
                score(a.field.name) - score(b.field.name) ||
                a.field.name.localeCompare(b.field.name),
        )
        return { types: types.slice(0, 50), fields: fields.slice(0, 100) }
    }, [schema, q])

    if (!results.types.length && !results.fields.length) {
        return (
            <EmptyState
                icon={<Search />}
                title="No matches"
                description={`Nothing in the schema matches “${query}”.`}
            />
        )
    }

    return (
        <div className={styles.section}>
            {results.types.length > 0 && (
                <>
                    <div className={styles.groupLabel}>Types</div>
                    <div className={styles.list}>
                        {results.types.map(t => (
                            <button
                                key={t.name}
                                className={styles.row}
                                onClick={() => push({ kind: "type", name: t.name })}
                            >
                                <span className={`${styles.rowName} ${typeGroupClass(t)}`}>
                                    <Highlight text={t.name} q={q} />
                                </span>
                                <span className={styles.rowMeta}>{typeKindLabel(t)}</span>
                            </button>
                        ))}
                    </div>
                </>
            )}
            {results.fields.length > 0 && (
                <>
                    <div className={styles.groupLabel}>Fields</div>
                    <div className={styles.list}>
                        {results.fields.map(({ type, field }) => {
                            const rk = rootKindFor(schema, type.name)
                            return (
                                <button
                                    key={`${type.name}.${field.name}`}
                                    className={styles.fieldRow}
                                    onClick={() =>
                                        push({
                                            kind: "field",
                                            typeName: type.name,
                                            fieldName: field.name,
                                        })
                                    }
                                >
                                    <div className={styles.fieldSig}>
                                        {rk && <KindBadge kind={rk} compact />}
                                        <span className={styles.rowMeta}>{type.name}.</span>
                                        <span className={styles.fieldName}>
                                            <Highlight text={field.name} q={q} />
                                        </span>
                                        <span className={styles.colon}>:</span>
                                        <span onClick={e => e.stopPropagation()}>
                                            <TypeLink type={field.type} />
                                        </span>
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                </>
            )}
        </div>
    )
}

export function Highlight({ text, q }: { text: string; q: string }) {
    const idx = text.toLowerCase().indexOf(q.toLowerCase())
    if (idx < 0 || !q) return <>{text}</>
    return (
        <>
            {text.slice(0, idx)}
            <mark className={styles.mark}>{text.slice(idx, idx + q.length)}</mark>
            {text.slice(idx + q.length)}
        </>
    )
}

// --- SDL ---------------------------------------------------------------------

function SdlView() {
    const [sdl, schema] = useUnit([$sdl, $schema])
    return (
        <div className={styles.sdl}>
            {/* The schema resolves type references, so they get the same colours as everywhere else. */}
            <CodeEditor value={sdl} language="graphql" schema={schema} readOnly lineNumbers />
        </div>
    )
}
