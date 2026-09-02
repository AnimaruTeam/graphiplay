import {
    type ArgumentNode,
    type DefinitionNode,
    type DocumentNode,
    type FieldNode,
    type GraphQLArgument,
    type GraphQLField,
    type GraphQLNamedType,
    type GraphQLOutputType,
    type GraphQLSchema,
    type InlineFragmentNode,
    Kind,
    type Location,
    type OperationDefinitionNode,
    type SelectionNode,
    type SelectionSetNode,
    type VariableDefinitionNode,
    getNamedType,
    isInterfaceType,
    isLeafType,
    isNonNullType,
    isObjectType,
    isUnionType,
    parse,
    parseType,
    print,
    visit,
} from "graphql"

import type { ActiveOperation } from "@/shared/lib/codemirror"
import type { OperationKind } from "@/shared/types"

import { safeParseJson } from "./document"
import { defaultValueFor } from "./generate"

// Query-builder AST helpers. The query text is the source of truth: the tree is derived from
// `parse(query)` and every toggle splices one re-printed operation back into the text by `loc`,
// so comments, fragments and untouched operations survive.

export type PathSeg = { field: string } | { on: string }

export interface ParsedQuery {
    /** Every definition that parsed (with `loc` in document coordinates). */
    doc: DocumentNode
    /** First syntax error, when some part of the text failed to parse. */
    error: string | null
    /** Operation indexes (as counted by the editor) whose text is broken and thus missing from `doc`. */
    brokenOps: number[]
}

export interface BuilderInput {
    schema: GraphQLSchema
    query: string
    variables: string
    active: ActiveOperation | null
}

export interface TextChange {
    from: number
    to: number
    insert: string
}

export interface BuilderResult {
    query: string
    change: TextChange
    /** New variables JSON, only when a key was seeded. */
    variables?: string
    /** Where to put the editor cursor afterwards (inside a freshly created operation). */
    cursor?: number
}

const EMPTY_DOC: DocumentNode = { kind: Kind.DOCUMENT, definitions: [] }

/**
 * Whitespace/comment-only text is an empty document, not a syntax error. When the whole text
 * doesn't parse, each top-level definition is parsed on its own so a typo in one operation
 * doesn't blank out the others.
 */
export function parseQuery(text: string): ParsedQuery {
    if (!text.replace(/#[^\n\r]*/g, "").trim())
        return { doc: EMPTY_DOC, error: null, brokenOps: [] }
    try {
        return { doc: parse(text), error: null, brokenOps: [] }
    } catch (e) {
        const error = (e as Error).message
        const definitions: DefinitionNode[] = []
        const brokenOps: number[] = []
        let opIndex = 0
        for (const chunk of splitDefinitions(text)) {
            const source = text.slice(chunk.from, chunk.to)
            const parsedChunk = parseDefinition(source)
            const node = parsedChunk ? shiftLoc(parsedChunk, chunk) : null
            const isOperation = node
                ? node.kind === Kind.OPERATION_DEFINITION
                : !/^\s*fragment\b/.test(source)
            if (node) definitions.push(node)
            else if (isOperation) brokenOps.push(opIndex)
            if (isOperation) opIndex++
        }
        return { doc: { kind: Kind.DOCUMENT, definitions }, error, brokenOps }
    }
}

const EMPTY_PLACEHOLDER = "__gp_empty__"

/**
 * Parse one definition. `query Test { }` is a syntax error in GraphQL but exactly what a user
 * types before reaching for the builder, so empty selection sets are filled with a placeholder
 * field for parsing and emptied again afterwards.
 */
function parseDefinition(source: string): DefinitionNode | null {
    try {
        const doc = parse(source)
        return doc.definitions.length === 1 ? doc.definitions[0]! : null
    } catch {
        /* fall through to the repair */
    }
    if (!/\{\s*\}/.test(source)) return null
    try {
        const doc = parse(source.replace(/\{(\s*)\}/g, `{$1${EMPTY_PLACEHOLDER} }`))
        if (doc.definitions.length !== 1) return null
        return visit(doc.definitions[0]!, {
            Field: n => (n.name.value === EMPTY_PLACEHOLDER ? null : undefined),
        })
    } catch {
        return null
    }
}

/** Top-level definitions as text ranges, found by brace matching (tolerant of syntax errors inside). */
function splitDefinitions(text: string): { from: number; to: number }[] {
    const out: { from: number; to: number }[] = []
    let start = -1
    let braces = 0
    let parens = 0
    let i = 0
    while (i < text.length) {
        const ch = text[i]!
        if (ch === "#") {
            while (i < text.length && text[i] !== "\n") i++
            continue
        }
        if (ch === '"') {
            const block = text.startsWith('"""', i)
            i += block ? 3 : 1
            while (i < text.length) {
                if (text[i] === "\\") i += 2
                else if (block ? text.startsWith('"""', i) : text[i] === '"' || text[i] === "\n") {
                    i += block ? 3 : 1
                    break
                } else i++
            }
            continue
        }
        if (start === -1 && !/\s/.test(ch)) start = i
        if (ch === "(") parens++
        else if (ch === ")") parens = Math.max(0, parens - 1)
        else if (ch === "{" && parens === 0) braces++
        else if (ch === "}" && parens === 0) {
            braces = Math.max(0, braces - 1)
            if (braces === 0 && start !== -1) {
                out.push({ from: start, to: i + 1 })
                start = -1
            }
        }
        i++
    }
    if (start !== -1) out.push({ from: start, to: text.length })
    return out
}

/**
 * Re-base `loc` of a definition parsed from a slice back onto the full document. The chunk is
 * exactly one definition, so its end is pinned to the chunk end (inner offsets may have shifted
 * when an empty selection set was repaired).
 */
function shiftLoc<T extends DefinitionNode>(node: T, chunk: { from: number; to: number }): T {
    const offset = chunk.from
    const move = (loc: Location | undefined, end?: number) =>
        loc
            ? ({
                  ...loc,
                  start: loc.start + offset,
                  end: end ?? loc.end + offset,
              } as unknown as Location)
            : undefined
    const shifted: T = { ...node, loc: move(node.loc, chunk.to) }
    if ("selectionSet" in shifted && shifted.selectionSet) {
        return {
            ...shifted,
            selectionSet: { ...shifted.selectionSet, loc: move(shifted.selectionSet.loc) },
        }
    }
    return shifted
}

/** The cursor sits inside an operation whose text doesn't parse — nothing can be toggled there. */
export function isTargetBroken(parsed: ParsedQuery, active: ActiveOperation | null): boolean {
    if (!active || active.placement !== "inside" || !parsed.brokenOps.length) return false
    if (active.name && operationsOf(parsed.doc).some(o => o.name?.value === active.name))
        return false
    return parsed.brokenOps.includes(active.index)
}

export function operationsOf(doc: DocumentNode): OperationDefinitionNode[] {
    return doc.definitions.filter(
        (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
    )
}

/** The operation `active` refers to (by name, then index). */
function operationFor(doc: DocumentNode, active: ActiveOperation): OperationDefinitionNode | null {
    const ops = operationsOf(doc)
    if (active.name) {
        const byName = ops.find(o => o.name?.value === active.name)
        if (byName) return byName
    }
    const byIndex = ops[active.index]
    return byIndex && byIndex.operation === active.kind ? byIndex : null
}

/**
 * The operation the tree edits: the one containing the cursor. When the cursor sits outside every
 * operation (or nothing is known about it) there is no target — checking a field starts a new one.
 */
export function resolveTargetOp(
    doc: DocumentNode,
    active: ActiveOperation | null,
): OperationDefinitionNode | null {
    const ops = operationsOf(doc)
    if (!ops.length) return null
    if (!active) return ops[0]!
    if (active.placement !== "inside") return null
    return operationFor(doc, active) ?? ops[0]!
}

export function pathKey(path: PathSeg[]): string {
    return path.map(s => ("field" in s ? `f:${s.field}` : `on:${s.on}`)).join("/")
}

/** Every field / inline fragment in the operation keyed by path — O(1) checkbox lookup per row. */
export function indexSelections(
    op: OperationDefinitionNode,
): Map<string, FieldNode | InlineFragmentNode> {
    const out = new Map<string, FieldNode | InlineFragmentNode>()
    const walk = (set: SelectionSetNode, prefix: string) => {
        for (const sel of set.selections) {
            let key: string
            if (sel.kind === Kind.FIELD) key = `f:${sel.name.value}`
            else if (sel.kind === Kind.INLINE_FRAGMENT && sel.typeCondition)
                key = `on:${sel.typeCondition.name.value}`
            else continue
            const full = prefix ? `${prefix}/${key}` : key
            if (!out.has(full)) out.set(full, sel)
            if (sel.selectionSet) walk(sel.selectionSet, full)
        }
    }
    walk(op.selectionSet, "")
    return out
}

export function argPreview(arg: ArgumentNode, max = 24): string {
    const s = print(arg.value).replace(/\s+/g, " ")
    return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export const isRequiredArg = (a: GraphQLArgument) =>
    isNonNullType(a.type) && a.defaultValue === undefined

// --- AST construction --------------------------------------------------------

const name = (value: string) => ({ kind: Kind.NAME as const, value })

const fieldNode = (
    fieldName: string,
    selectionSet?: SelectionSetNode,
    args?: ArgumentNode[],
): FieldNode => ({
    kind: Kind.FIELD,
    name: name(fieldName),
    ...(args?.length ? { arguments: args } : {}),
    ...(selectionSet ? { selectionSet } : {}),
})

const selectionSet = (selections: SelectionNode[]): SelectionSetNode => ({
    kind: Kind.SELECTION_SET,
    selections,
})

const variableArg = (argName: string, varName: string): ArgumentNode => ({
    kind: Kind.ARGUMENT,
    name: name(argName),
    value: { kind: Kind.VARIABLE, name: name(varName) },
})

/** Minimal valid selection for a composite type: `id` → an `ID`-typed leaf → first arg-less leaf → `__typename`. */
function seedSelection(type: GraphQLOutputType): SelectionSetNode | undefined {
    const named = getNamedType(type)
    if (isLeafType(named)) return undefined
    if (isObjectType(named) || isInterfaceType(named)) {
        const leaves = Object.values(named.getFields()).filter(
            f => isLeafType(getNamedType(f.type)) && f.args.length === 0,
        )
        const pick =
            leaves.find(f => f.name === "id") ??
            leaves.find(f => getNamedType(f.type).name === "ID") ??
            leaves[0]
        if (pick) return selectionSet([fieldNode(pick.name)])
    }
    return selectionSet([fieldNode("__typename")])
}

/** Resolve the schema field at `path` starting from the operation's root type. */
export function fieldAtPath(
    schema: GraphQLSchema,
    kind: OperationKind,
    path: PathSeg[],
): GraphQLField<unknown, unknown> | null {
    let type: GraphQLOutputType | null | undefined = rootType(schema, kind)
    let field: GraphQLField<unknown, unknown> | null = null
    for (const seg of path) {
        if (!type) return null
        if ("on" in seg) {
            type = schema.getType(seg.on) as GraphQLOutputType | undefined
            field = null
            continue
        }
        const named: GraphQLNamedType = getNamedType(type)
        if (!isObjectType(named) && !isInterfaceType(named)) return null
        field = named.getFields()[seg.field] ?? null
        if (!field) return null
        type = field.type
    }
    return field
}

export function rootType(schema: GraphQLSchema, kind: OperationKind) {
    return kind === "query"
        ? schema.getQueryType()
        : kind === "mutation"
          ? schema.getMutationType()
          : schema.getSubscriptionType()
}

// --- immutable selection-set edits --------------------------------------------

function matches(sel: SelectionNode, seg: PathSeg): sel is FieldNode | InlineFragmentNode {
    if ("field" in seg) return sel.kind === Kind.FIELD && sel.name.value === seg.field
    return sel.kind === Kind.INLINE_FRAGMENT && sel.typeCondition?.name.value === seg.on
}

function createSeg(
    seg: PathSeg,
    set: SelectionSetNode | undefined,
    args?: ArgumentNode[],
): FieldNode | InlineFragmentNode {
    if ("field" in seg) return fieldNode(seg.field, set, args)
    return {
        kind: Kind.INLINE_FRAGMENT,
        typeCondition: { kind: Kind.NAMED_TYPE, name: name(seg.on) },
        selectionSet: set ?? selectionSet([fieldNode("__typename")]),
    }
}

/** Arguments to attach to ancestors that get created on the way down, keyed by `pathKey`. */
type ArgsByKey = Map<string, ArgumentNode[]>

/**
 * Apply `fn` to the selection set at `path`, creating missing intermediate nodes on the way down.
 * Children left with an empty selection set are dropped so removals bubble up naturally.
 */
function updateAtPath(
    set: SelectionSetNode,
    path: PathSeg[],
    fn: (set: SelectionSetNode) => SelectionSetNode,
    argsByKey?: ArgsByKey,
    prefix: PathSeg[] = [],
): SelectionSetNode {
    if (path.length === 0) return fn(set)
    const [seg, ...rest] = path as [PathSeg, ...PathSeg[]]
    const here = [...prefix, seg]
    const idx = set.selections.findIndex(s => matches(s, seg))
    const existing = idx === -1 ? null : (set.selections[idx] as FieldNode | InlineFragmentNode)
    const childSet = updateAtPath(
        existing?.selectionSet ?? selectionSet([]),
        rest,
        fn,
        argsByKey,
        here,
    )
    const selections = [...set.selections]
    if (childSet.selections.length === 0) {
        if (idx !== -1) selections.splice(idx, 1)
    } else if (existing) {
        selections[idx] = { ...existing, selectionSet: childSet }
    } else {
        selections.push(createSeg(seg, childSet, argsByKey?.get(pathKey(here))))
    }
    return { ...set, selections }
}

/**
 * Variables for the required args of every field along `path` that isn't selected yet
 * (ancestors created implicitly must still be valid). Returns the op with definitions added.
 */
function requiredArgsAlong(
    input: BuilderInput,
    op: OperationDefinitionNode,
    kind: OperationKind,
    path: PathSeg[],
    index: Map<string, unknown>,
    seeded: { varName: string; arg: GraphQLArgument }[],
): [OperationDefinitionNode, ArgsByKey] {
    const argsByKey: ArgsByKey = new Map()
    let next = op
    for (let i = 1; i <= path.length; i++) {
        const prefix = path.slice(0, i)
        const seg = prefix[i - 1]!
        if (!("field" in seg) || index.has(pathKey(prefix))) continue
        const field = fieldAtPath(input.schema, kind, prefix)
        if (!field) continue
        const args: ArgumentNode[] = []
        for (const a of field.args.filter(isRequiredArg)) {
            const [o, varName] = ensureVariable(next, field, a)
            next = o
            args.push(variableArg(a.name, varName))
            seeded.push({ varName, arg: a })
        }
        if (args.length) argsByKey.set(pathKey(prefix), args)
    }
    return [next, argsByKey]
}

/** Apply `fn` to the field node at `path` (which must exist). */
function updateField(
    set: SelectionSetNode,
    path: PathSeg[],
    fn: (f: FieldNode) => FieldNode,
): SelectionSetNode {
    const last = path[path.length - 1]
    if (!last || !("field" in last)) return set
    return updateAtPath(set, path.slice(0, -1), parent => ({
        ...parent,
        selections: parent.selections.map(s =>
            matches(s, last) && s.kind === Kind.FIELD ? fn(s) : s,
        ),
    }))
}

// --- variables ----------------------------------------------------------------

function usedVariables(op: OperationDefinitionNode): Set<string> {
    const used = new Set<string>()
    visit(op.selectionSet, {
        Variable: n => {
            used.add(n.name.value)
        },
    })
    for (const d of op.directives ?? []) visit(d, { Variable: n => void used.add(n.name.value) })
    return used
}

/** Drop variable definitions nothing references (catches variables nested in literals and directives). */
function pruneVariables(op: OperationDefinitionNode): OperationDefinitionNode {
    const used = usedVariables(op)
    const defs = (op.variableDefinitions ?? []).filter(v => used.has(v.variable.name.value))
    return { ...op, variableDefinitions: defs }
}

/** Ensure a variable for `arg` exists on the op; returns the (possibly suffixed) variable name. */
function ensureVariable(
    op: OperationDefinitionNode,
    field: GraphQLField<unknown, unknown>,
    arg: GraphQLArgument,
): [OperationDefinitionNode, string] {
    const type = parseType(String(arg.type))
    const wanted = print(type)
    const defs = op.variableDefinitions ?? []
    const candidates = [arg.name, `${field.name}_${arg.name}`]
    for (const varName of candidates) {
        const existing = defs.find(d => d.variable.name.value === varName)
        if (!existing) {
            const def: VariableDefinitionNode = {
                kind: Kind.VARIABLE_DEFINITION,
                variable: { kind: Kind.VARIABLE, name: name(varName) },
                type,
            }
            return [{ ...op, variableDefinitions: [...defs, def] }, varName]
        }
        if (print(existing.type) === wanted) return [op, varName]
    }
    // Both names taken with different types — number it.
    let i = 2
    while (defs.some(d => d.variable.name.value === `${arg.name}${i}`)) i++
    const varName = `${arg.name}${i}`
    const def: VariableDefinitionNode = {
        kind: Kind.VARIABLE_DEFINITION,
        variable: { kind: Kind.VARIABLE, name: name(varName) },
        type,
    }
    return [{ ...op, variableDefinitions: [...defs, def] }, varName]
}

function seedVariables(
    json: string,
    schema: GraphQLSchema,
    entries: { varName: string; arg: GraphQLArgument }[],
): string | undefined {
    if (!entries.length) return undefined
    const parsed = safeParseJson(json)
    if (!parsed.ok) return undefined // never clobber JSON the user is mid-editing
    const next = { ...parsed.value }
    let changed = false
    for (const { varName, arg } of entries) {
        if (varName in next) continue
        next[varName] = defaultValueFor(arg.type, schema, new Set())
        changed = true
    }
    return changed ? JSON.stringify(next, null, 2) : undefined
}

// --- operation selection & text emission -------------------------------------

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Pick the operation of `kind` to edit; `null` means one has to be appended. */
function pickOp(
    doc: DocumentNode,
    target: OperationDefinitionNode | null,
    kind: OperationKind,
): OperationDefinitionNode | null {
    if (target?.operation === kind) return target
    return operationsOf(doc).find(o => o.operation === kind) ?? null
}

function newOp(kind: OperationKind, nameHint: string, named: boolean): OperationDefinitionNode {
    return {
        kind: Kind.OPERATION_DEFINITION,
        operation: kind as OperationDefinitionNode["operation"],
        ...(named ? { name: name(capitalize(nameHint)) } : {}),
        variableDefinitions: [],
        directives: [],
        selectionSet: selectionSet([]),
    }
}

interface Edit {
    /** Existing operation being replaced/removed (with `loc`). */
    before: OperationDefinitionNode | null
    /** Replacement; `null` removes `before`. */
    after: OperationDefinitionNode | null
    /** Extra text replacements applied alongside (e.g. naming a previously anonymous op). */
    extra?: TextChange[]
    /** For a new operation: insert next to this one instead of at the end of the document. */
    anchor?: { op: OperationDefinitionNode; side: "before" | "after" }
}

function applyChanges(text: string, changes: TextChange[]): { query: string; change: TextChange } {
    const sorted = [...changes].sort((a, b) => a.from - b.from)
    let query = ""
    let cursor = 0
    for (const c of sorted) {
        query += text.slice(cursor, c.from) + c.insert
        cursor = c.to
    }
    query += text.slice(cursor)
    // Collapse into one change spanning all edits so the editor can apply it as a single transaction.
    const from = sorted[0]!.from
    const to = sorted[sorted.length - 1]!.to
    return {
        query,
        change: { from, to, insert: query.slice(from, query.length - (text.length - to)) },
    }
}

function emit(
    input: BuilderInput,
    edit: Edit,
): { query: string; change: TextChange; cursor?: number } {
    const text = input.query
    const changes: TextChange[] = [...(edit.extra ?? [])]
    // Offset of the new operation's opening brace within `insert`, to park the cursor inside it.
    let cursorAt: { from: number; offset: number } | undefined
    if (edit.before?.loc) {
        const { start, end } = edit.before.loc
        if (edit.after) changes.push({ from: start, to: end, insert: print(edit.after) })
        else {
            // Remove the op with the blank lines around it.
            let from = start
            let to = end
            while (from > 0 && /[ \t]/.test(text[from - 1]!)) from--
            while (to < text.length && /[ \t]/.test(text[to]!)) to++
            let nl = 0
            while (to < text.length && text[to] === "\n" && nl < 2) {
                to++
                nl++
            }
            if (nl === 0)
                while (from > 0 && text[from - 1] === "\n" && nl < 2) {
                    from--
                    nl++
                }
            changes.push({ from, to, insert: "" })
        }
    } else if (edit.after) {
        const body = print(edit.after)
        const brace = body.indexOf("{") + 1
        const anchorLoc = edit.anchor?.op.loc
        if (anchorLoc && edit.anchor!.side === "before") {
            // Same offset as a possible `extra` edit naming that neighbour — the new op must come first.
            changes.unshift({ from: anchorLoc.start, to: anchorLoc.start, insert: `${body}\n\n` })
            cursorAt = { from: anchorLoc.start, offset: brace }
        } else if (anchorLoc) {
            changes.push({ from: anchorLoc.end, to: anchorLoc.end, insert: `\n\n${body}` })
            cursorAt = { from: anchorLoc.end, offset: 2 + brace }
        } else {
            const trimmed = text.trimEnd()
            if (!trimmed) {
                changes.push({ from: 0, to: text.length, insert: `${body}\n` })
                cursorAt = { from: 0, offset: brace }
            } else {
                changes.push({ from: trimmed.length, to: text.length, insert: `\n\n${body}\n` })
                cursorAt = { from: trimmed.length, offset: 2 + brace }
            }
        }
    }
    if (!changes.length) return { query: text, change: { from: 0, to: 0, insert: "" } }
    const out = applyChanges(text, changes)
    if (!cursorAt) return out
    // `extra` edits before the insertion point shift it.
    const shift = (edit.extra ?? [])
        .filter(c => c.from < cursorAt!.from)
        .reduce((n, c) => n + c.insert.length - (c.to - c.from), 0)
    return { ...out, cursor: cursorAt.from + shift + cursorAt.offset }
}

/** Name an anonymous operation in place (`query {` → `query Query {`, bare `{` → `query Query {`). */
function nameAnonymous(text: string, op: OperationDefinitionNode): TextChange | null {
    if (op.name || !op.loc) return null
    const start = op.loc.start
    const head = text.slice(start, op.selectionSet.loc?.start ?? start)
    const label = capitalize(op.operation)
    if (head.trim() === "") return { from: start, to: start, insert: `${op.operation} ${label} ` }
    const kw = head.match(/^\s*(query|mutation|subscription)/)
    if (!kw) return null
    const at = start + kw[0].length
    return { from: at, to: at, insert: ` ${label}` }
}

/** Resolve or create the operation for `kind`; returns the target, whether it's new, and side edits. */
function targetFor(
    input: BuilderInput,
    parsed: ParsedQuery,
    kind: OperationKind,
    nameHint: string,
): {
    op: OperationDefinitionNode
    existing: OperationDefinitionNode | null
    extra: TextChange[]
    anchor?: Edit["anchor"]
} {
    const { doc } = parsed
    const active = input.active
    const outside = !!active && active.placement !== "inside"
    const target = resolveTargetOp(doc, active)
    // Cursor in a gap between operations: always start a new one there rather than reuse a neighbour.
    const existing = outside ? null : pickOp(doc, target, kind)
    if (existing) return { op: existing, existing, extra: [] }
    const others = operationsOf(doc)
    // Anonymous operations can't coexist with others — name the new one and any anonymous sibling.
    const extra = others.map(o => nameAnonymous(input.query, o)).filter((c): c is TextChange => !!c)
    const neighbour = outside ? operationFor(doc, active) : null
    const anchor = neighbour
        ? { op: neighbour, side: active!.placement as "before" | "after" }
        : undefined
    return {
        op: newOp(kind, nameHint, others.length + parsed.brokenOps.length > 0),
        existing: null,
        extra,
        anchor,
    }
}

// --- public toggles ------------------------------------------------------------

export function toggleField(
    input: BuilderInput,
    kind: OperationKind,
    path: PathSeg[],
): BuilderResult | null {
    const parsed = parseQuery(input.query)
    if (isTargetBroken(parsed, input.active)) return null
    const last = path[path.length - 1]
    if (!last) return null
    const hint = "field" in last ? last.field : last.on
    const { op, existing, extra, anchor } = targetFor(input, parsed, kind, hint)
    const index = existing
        ? indexSelections(existing)
        : new Map<string, FieldNode | InlineFragmentNode>()
    const present = index.has(pathKey(path))
    const seeded: { varName: string; arg: GraphQLArgument }[] = []

    let next: OperationDefinitionNode
    if (present) {
        next = {
            ...op,
            selectionSet: updateAtPath(op.selectionSet, path.slice(0, -1), set => ({
                ...set,
                selections: set.selections.filter(s => !matches(s, last)),
            })),
        }
    } else {
        const [opWithVars, argsByKey] = requiredArgsAlong(input, op, kind, path, index, seeded)
        const field = "field" in last ? fieldAtPath(input.schema, kind, path) : null
        const seed =
            "field" in last
                ? field
                    ? seedSelection(field.type) // undefined for leaf fields
                    : undefined
                : (seedSelection(input.schema.getType(last.on) as GraphQLOutputType) ??
                  selectionSet([fieldNode("__typename")]))
        const args = argsByKey.get(pathKey(path))
        next = {
            ...opWithVars,
            selectionSet: updateAtPath(
                opWithVars.selectionSet,
                path.slice(0, -1),
                set => ({ ...set, selections: [...set.selections, createSeg(last, seed, args)] }),
                argsByKey,
            ),
        }
    }
    next = pruneVariables(next)
    const after = next.selectionSet.selections.length ? next : null
    const out = emit(input, { before: existing, after, extra, anchor })
    const variables = seedVariables(input.variables, input.schema, seeded)
    return variables ? { ...out, variables } : out
}

function setArgs(
    input: BuilderInput,
    kind: OperationKind,
    path: PathSeg[],
    select: (a: GraphQLArgument, present: boolean) => boolean,
): BuilderResult | null {
    const parsed = parseQuery(input.query)
    if (isTargetBroken(parsed, input.active)) return null
    const field = fieldAtPath(input.schema, kind, path)
    if (!field) return null
    const { op, existing, extra, anchor } = targetFor(input, parsed, kind, field.name)
    const index = existing
        ? indexSelections(existing)
        : new Map<string, FieldNode | InlineFragmentNode>()
    const node = index.get(pathKey(path))
    const fieldExists = node?.kind === Kind.FIELD
    const currentArgs: readonly ArgumentNode[] = fieldExists ? (node.arguments ?? []) : []
    const seeded: { varName: string; arg: GraphQLArgument }[] = []

    let next = op
    const keep: ArgumentNode[] = []
    for (const a of field.args) {
        const current = currentArgs.find(n => n.name.value === a.name)
        const want = select(a, !!current)
        if (!want) continue
        if (current) keep.push(current)
        else {
            const [o, varName] = ensureVariable(next, field, a)
            next = o
            keep.push(variableArg(a.name, varName))
            seeded.push({ varName, arg: a })
        }
    }
    // Preserve arguments the schema doesn't know about (e.g. mid-rename) rather than silently dropping them.
    for (const n of currentArgs) if (!field.args.some(a => a.name === n.name.value)) keep.push(n)

    if (fieldExists) {
        next = {
            ...next,
            selectionSet: updateField(next.selectionSet, path, f => ({ ...f, arguments: keep })),
        }
    } else {
        const [withAncestors, argsByKey] = requiredArgsAlong(
            input,
            next,
            kind,
            path.slice(0, -1),
            index,
            seeded,
        )
        const seed = seedSelection(field.type)
        next = {
            ...withAncestors,
            selectionSet: updateAtPath(
                withAncestors.selectionSet,
                path.slice(0, -1),
                set => ({
                    ...set,
                    selections: [...set.selections, fieldNode(field.name, seed, keep)],
                }),
                argsByKey,
            ),
        }
    }
    next = pruneVariables(next)
    const out = emit(input, { before: existing, after: next, extra, anchor })
    const variables = seedVariables(input.variables, input.schema, seeded)
    return variables ? { ...out, variables } : out
}

export function toggleArgument(
    input: BuilderInput,
    kind: OperationKind,
    path: PathSeg[],
    argName: string,
): BuilderResult | null {
    return setArgs(input, kind, path, (a, present) =>
        a.name === argName ? (isRequiredArg(a) ? true : !present) : present,
    )
}

export function setAllArguments(
    input: BuilderInput,
    kind: OperationKind,
    path: PathSeg[],
    on: boolean,
): BuilderResult | null {
    return setArgs(input, kind, path, a => on || isRequiredArg(a))
}

/** Members shown as `... on X` rows under a union/interface field. */
export function possibleTypes(schema: GraphQLSchema, type: GraphQLOutputType) {
    const named = getNamedType(type)
    return isUnionType(named) || isInterfaceType(named) ? schema.getPossibleTypes(named) : []
}
