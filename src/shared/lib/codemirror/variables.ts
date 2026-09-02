import { jsonLanguage } from "@codemirror/lang-json"
import type { syntaxTree } from "@codemirror/language"
import { StateEffect, StateField } from "@codemirror/state"
import {
    type GraphQLInputObjectType,
    type GraphQLInputType,
    type GraphQLSchema,
    Kind,
    type OperationDefinitionNode,
    getNamedType,
    getNullableType,
    isEnumType,
    isInputObjectType,
    isInputType,
    isListType,
    isNonNullType,
    isRequiredInputField,
    print,
    typeFromAST,
    valueFromASTUntyped,
} from "graphql"

import { parseQuery } from "@/shared/lib/graphql"

// @lezer/common isn't a direct dependency; borrow the types from the tree.
type Tree = ReturnType<typeof syntaxTree>
export type SyntaxNode = Tree["topNode"]

/**
 * Variables JSON ↔ GraphQL document bridge: knows which variables the query declares and
 * their input types, resolves a JSON path to the input type expected there, and validates
 * the JSON against it. Pure functions; editor extensions live in variablesEditor.ts.
 */

export interface VariablesInput {
    schema: GraphQLSchema | null
    query: string
    /** Operation that will run (null when the document has a single / anonymous one). */
    operationName: string | null
}

export interface VariableDef {
    name: string
    /** null when there's no schema or the declared type isn't known to it. */
    type: GraphQLInputType | null
    typeText: string
    defaultValue?: unknown
    /** Labels of operations declaring it, e.g. `query GetUser`. */
    operations: string[]
    /** Declared by the operation that will run. */
    inActive: boolean
}

export interface VariablesContext extends VariablesInput {
    vars: Map<string, VariableDef>
    /** Operation that will run, when it can be told apart. */
    active: { label: string } | null
}

/** A key that can be written in an object: a top-level variable or an input field. */
export interface Member {
    name: string
    type: GraphQLInputType | null
    typeText: string
    required: boolean
    description?: string | null
    deprecationReason?: string | null
    defaultValue?: unknown
    variable?: VariableDef
    parent?: GraphQLInputObjectType
}

export type Container = { kind: "root" } | { kind: "input"; type: GraphQLInputObjectType }

/** Object keys and array indices from the root object down to a value. */
export type PathSegment = string | number

/** Node names that carry a JSON value; the tree also has nodes for `{ } [ ] , :`. */
export const VALUE_NODES = new Set(["String", "Number", "True", "False", "Null", "Object", "Array"])

/** Value node of a Property, if it has one. */
export const valueOf = (prop: SyntaxNode): SyntaxNode | null =>
    findChild(prop, n => VALUE_NODES.has(n.name))

function findChild(parent: SyntaxNode, test: (n: SyntaxNode) => boolean): SyntaxNode | null {
    for (let c = parent.firstChild; c; c = c.nextSibling) if (test(c)) return c
    return null
}

export const valueChildren = (node: SyntaxNode): SyntaxNode[] => {
    const out: SyntaxNode[] = []
    for (let c = node.firstChild; c; c = c.nextSibling) if (VALUE_NODES.has(c.name)) out.push(c)
    return out
}

export const setVariablesContext = StateEffect.define<VariablesInput>()

export const variablesContextField = StateField.define<VariablesContext>({
    create: () => buildVariablesContext({ schema: null, query: "", operationName: null }),
    update(value, tr) {
        for (const e of tr.effects)
            if (e.is(setVariablesContext)) return buildVariablesContext(e.value)
        return value
    },
})

const opLabel = (op: OperationDefinitionNode) =>
    op.name ? `${op.operation} ${op.name.value}` : op.operation

export function buildVariablesContext(input: VariablesInput): VariablesContext {
    const ops = parseQuery(input.query).doc.definitions.filter(
        (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
    )
    const activeOp = input.operationName
        ? ops.find(o => o.name?.value === input.operationName)
        : ops.length === 1
          ? ops[0]
          : undefined
    // Active operation first so its declaration wins when several operations share a name.
    const ordered = activeOp ? [activeOp, ...ops.filter(o => o !== activeOp)] : ops

    const vars = new Map<string, VariableDef>()
    for (const op of ordered) {
        for (const def of op.variableDefinitions ?? []) {
            const name = def.variable.name.value
            const existing = vars.get(name)
            if (existing) {
                existing.operations.push(opLabel(op))
                continue
            }
            const resolved = input.schema ? typeFromAST(input.schema, def.type) : undefined
            vars.set(name, {
                name,
                type: resolved && isInputType(resolved) ? resolved : null,
                typeText: print(def.type),
                defaultValue: def.defaultValue ? valueFromASTUntyped(def.defaultValue) : undefined,
                operations: [opLabel(op)],
                inActive: op === activeOp,
            })
        }
    }
    return { ...input, vars, active: activeOp ? { label: opLabel(activeOp) } : null }
}

// --- Path resolution -------------------------------------------------------

export function keyOf(text: string, nameNode: SyntaxNode): string {
    const raw = text.slice(nameNode.from, nameNode.to)
    try {
        return JSON.parse(raw)
    } catch {
        return raw.replace(/^"|"$/g, "")
    }
}

/**
 * Path from the root object to `node`. A property's key is part of the path only when the
 * node sits inside that property's value, so a PropertyName resolves to its enclosing object.
 */
export function pathOf(text: string, node: SyntaxNode): PathSegment[] {
    const path: PathSegment[] = []
    for (let cur = node; cur.parent; cur = cur.parent) {
        const parent = cur.parent
        if (parent.name === "Property" && cur.name !== "PropertyName") {
            const nameNode = parent.getChild("PropertyName")
            if (nameNode) path.unshift(keyOf(text, nameNode))
        } else if (parent.name === "Array") {
            let index = 0
            for (let s = cur.prevSibling; s; s = s.prevSibling) if (VALUE_NODES.has(s.name)) index++
            path.unshift(index)
        }
    }
    return path
}

const isVariableRequired = (v: VariableDef) =>
    v.defaultValue === undefined && (v.type ? isNonNullType(v.type) : v.typeText.endsWith("!"))

function variableMember(v: VariableDef): Member {
    return {
        name: v.name,
        type: v.type,
        typeText: v.typeText,
        required: isVariableRequired(v),
        defaultValue: v.defaultValue,
        variable: v,
    }
}

function fieldMember(parent: GraphQLInputObjectType, name: string): Member | null {
    const f = parent.getFields()[name]
    if (!f) return null
    return {
        name: f.name,
        type: f.type,
        typeText: String(f.type),
        required: isRequiredInputField(f),
        description: f.description,
        deprecationReason: f.deprecationReason,
        defaultValue: f.defaultValue,
        parent,
    }
}

export function memberOf(ctx: VariablesContext, container: Container, key: string): Member | null {
    if (container.kind === "root") {
        const v = ctx.vars.get(key)
        return v ? variableMember(v) : null
    }
    return fieldMember(container.type, key)
}

export function membersOf(ctx: VariablesContext, container: Container): Member[] {
    if (container.kind === "root") return [...ctx.vars.values()].map(variableMember)
    return Object.keys(container.type.getFields()).map(n => fieldMember(container.type, n)!)
}

/** Declared input type of the value at `path`; null when it can't be known. */
export function typeAt(ctx: VariablesContext, path: PathSegment[]): GraphQLInputType | null {
    if (!path.length || typeof path[0] !== "string") return null
    let type = ctx.vars.get(path[0])?.type ?? null
    for (const seg of path.slice(1)) {
        if (!type) return null
        let t = getNullableType(type)
        if (typeof seg === "number") {
            if (!isListType(t)) return null
            type = t.ofType
            continue
        }
        // GraphQL coerces a lone object into a single-item list.
        while (isListType(t)) t = getNullableType(t.ofType)
        if (!isInputObjectType(t)) return null
        type = t.getFields()[seg]?.type ?? null
    }
    return type
}

/** What keys are allowed inside the object at `path` (the root object when path is empty). */
export function containerAt(ctx: VariablesContext, path: PathSegment[]): Container | null {
    if (!path.length) return { kind: "root" }
    const type = typeAt(ctx, path)
    if (!type) return null
    let t = getNullableType(type)
    while (isListType(t)) t = getNullableType(t.ofType)
    return isInputObjectType(t) ? { kind: "input", type: t } : null
}

// --- Placeholders --------------------------------------------------------------

/** JSON text to insert for a member's value when none is written yet. */
export function placeholderFor(member: Member): string {
    if (member.defaultValue !== undefined) return JSON.stringify(member.defaultValue)
    if (!member.type) return "null"
    const nullable = getNullableType(member.type)
    if (isListType(nullable)) return "[]"
    const named = getNamedType(nullable)
    if (isInputObjectType(named)) return "{}"
    if (isEnumType(named)) return '""'
    switch (named.name) {
        case "Int":
        case "Float":
            return "0"
        case "Boolean":
            return "false"
        default:
            return '""'
    }
}

// --- Validation ------------------------------------------------------------------

export interface VariableIssue {
    from: number
    to: number
    severity: "error" | "warning"
    kind: "unused" | "foreign" | "type" | "missing" | "unknownField" | "duplicate"
    message: string
    fix?: { label: string; from: number; to: number; insert: string }
}

const kindOf = (node: SyntaxNode) =>
    (
        ({
            String: "string",
            Number: "number",
            True: "boolean",
            False: "boolean",
            Null: "null",
            Object: "object",
            Array: "array",
        }) as Record<string, string>
    )[node.name] ?? node.name

const hasSyntaxErrors = (tree: Tree) => {
    const c = tree.cursor()
    do if (c.type.isError) return true
    while (c.next())
    return false
}

const listNames = (names: string[], max = 8) =>
    names.length > max ? `${names.slice(0, max).join(", ")}, …` : names.join(", ")

/** Change inserting `"key": value` as the last property of `obj`, matching its layout. */
export function insertPropertyFix(
    text: string,
    obj: SyntaxNode,
    key: string,
    value: string,
): VariableIssue["fix"] {
    const label = `Add "${key}"`
    const props = obj.getChildren("Property")
    const last = props[props.length - 1]
    const entry = `${JSON.stringify(key)}: ${value}`
    const multiline = text.slice(obj.from, obj.to).includes("\n")
    if (!multiline) {
        return last
            ? { label, from: last.to, to: last.to, insert: `, ${entry}` }
            : { label, from: obj.from + 1, to: obj.from + 1, insert: ` ${entry} ` }
    }
    const lineStartOf = (pos: number) => text.lastIndexOf("\n", pos - 1) + 1
    const indentOf = (pos: number) => text.slice(lineStartOf(pos), pos).match(/^\s*/)![0]
    const indent = last ? indentOf(props[0]!.from) : `${indentOf(obj.from)}  `
    return last
        ? { label, from: last.to, to: last.to, insert: `,\n${indent}${entry}` }
        : { label, from: obj.from + 1, to: obj.from + 1, insert: `\n${indent}${entry}` }
}

/** Change removing property `prop` together with its separating comma. */
function removePropertyFix(prop: SyntaxNode): VariableIssue["fix"] {
    const label = "Remove"
    let next = prop.nextSibling
    while (next?.name === ",") next = next.nextSibling
    if (next?.name === "Property") return { label, from: prop.from, to: next.from, insert: "" }
    let prev = prop.prevSibling
    while (prev?.name === ",") prev = prev.prevSibling
    if (prev?.name === "Property") return { label, from: prev.to, to: prop.to, insert: "" }
    const obj = prop.parent!
    return { label, from: obj.from + 1, to: obj.to - 1, insert: "" }
}

/**
 * Type-checks variables JSON against the query's declarations. Syntax errors are left to
 * the JSON linter: the tree is only inspected when it parsed cleanly.
 */
export function validateVariables(
    ctx: VariablesContext,
    text: string,
    tree: Tree = jsonLanguage.parser.parse(text),
): VariableIssue[] {
    const issues: VariableIssue[] = []
    const requiredVars = [...ctx.vars.values()].filter(v => v.inActive && isVariableRequired(v))

    if (!text.trim()) {
        for (const v of requiredVars) {
            issues.push({
                from: 0,
                to: 0,
                severity: "error",
                kind: "missing",
                message: `Missing required variable $${v.name}: ${v.typeText}`,
                fix: {
                    label: `Add "${v.name}"`,
                    from: 0,
                    to: text.length,
                    insert: `{\n  ${JSON.stringify(v.name)}: ${placeholderFor(variableMember(v))}\n}`,
                },
            })
        }
        return issues
    }
    if (hasSyntaxErrors(tree)) return issues

    const root = tree.topNode.firstChild
    if (!root) return issues
    if (root.name !== "Object") {
        issues.push({
            from: root.from,
            to: root.to,
            severity: "error",
            kind: "type",
            message: `Variables must be a JSON object, got ${kindOf(root)}`,
        })
        return issues
    }

    const checkValue = (node: SyntaxNode, type: GraphQLInputType) => {
        if (node.name === "Null") {
            if (isNonNullType(type)) {
                issues.push({
                    from: node.from,
                    to: node.to,
                    severity: "error",
                    kind: "type",
                    message: `Expected ${type}, got null`,
                })
            }
            return
        }
        const nullable = getNullableType(type)
        if (isListType(nullable)) {
            if (node.name === "Array") {
                for (const c of valueChildren(node)) checkValue(c, nullable.ofType)
            } else checkValue(node, nullable.ofType) // single item coerces to a list
            return
        }
        const mismatch = (got = kindOf(node)) =>
            issues.push({
                from: node.from,
                to: node.to,
                severity: "error",
                kind: "type",
                message: `Expected ${type}, got ${got}`,
            })
        if (isInputObjectType(nullable)) {
            if (node.name !== "Object") return mismatch()
            return checkObject(node, { kind: "input", type: nullable })
        }
        if (isEnumType(nullable)) {
            if (node.name !== "String") return mismatch()
            const value = keyOf(text, node)
            const names = nullable.getValues().map(v => v.name)
            if (!names.includes(value)) {
                issues.push({
                    from: node.from,
                    to: node.to,
                    severity: "error",
                    kind: "type",
                    message: `"${value}" is not a value of enum ${nullable.name}. Expected one of: ${listNames(names)}`,
                })
            }
            return
        }
        const num = node.name === "Number" ? Number(text.slice(node.from, node.to)) : NaN
        const isInt = Number.isInteger(num) && Math.abs(num) <= 2 ** 31 - 1
        switch (nullable.name) {
            case "Int":
                if (node.name !== "Number") return mismatch()
                if (!isInt) return mismatch(text.slice(node.from, node.to))
                return
            case "Float":
                return node.name === "Number" ? undefined : mismatch()
            case "String":
                return node.name === "String" ? undefined : mismatch()
            case "Boolean":
                return node.name === "True" || node.name === "False" ? undefined : mismatch()
            case "ID":
                return node.name === "String" || isInt ? undefined : mismatch()
            default:
                return // custom scalars accept anything
        }
    }

    const checkObject = (obj: SyntaxNode, container: Container) => {
        const seen = new Set<string>()
        for (const prop of obj.getChildren("Property")) {
            const nameNode = prop.getChild("PropertyName")
            if (!nameNode) continue
            const key = keyOf(text, nameNode)
            const at = { from: nameNode.from, to: nameNode.to }
            if (seen.has(key)) {
                issues.push({
                    ...at,
                    severity: "warning",
                    kind: "duplicate",
                    message: `Duplicate key "${key}"; the last one wins`,
                })
            }
            seen.add(key)

            const member = memberOf(ctx, container, key)
            if (!member) {
                if (container.kind === "root") {
                    issues.push({
                        ...at,
                        severity: "warning",
                        kind: "unused",
                        message: `$${key} is not declared by any operation in the query and will be ignored`,
                        fix: removePropertyFix(prop),
                    })
                } else {
                    issues.push({
                        ...at,
                        severity: "error",
                        kind: "unknownField",
                        message: `Field "${key}" is not defined by ${container.type.name}. Fields: ${listNames(Object.keys(container.type.getFields()))}`,
                        fix: removePropertyFix(prop),
                    })
                }
                continue
            }
            if (member.variable && ctx.active && !member.variable.inActive) {
                issues.push({
                    ...at,
                    severity: "warning",
                    kind: "foreign",
                    message: `$${key} is used by ${member.variable.operations.join(", ")}, not by ${ctx.active.label}`,
                })
            }
            const valueNode = valueOf(prop)
            if (valueNode && member.type) checkValue(valueNode, member.type)
        }

        const missing =
            container.kind === "root"
                ? requiredVars.map(variableMember)
                : membersOf(ctx, container).filter(m => m.required)
        for (const m of missing) {
            if (seen.has(m.name)) continue
            issues.push({
                from: obj.from,
                to: obj.from + 1,
                severity: "error",
                kind: "missing",
                message:
                    container.kind === "root"
                        ? `Missing required variable $${m.name}: ${m.typeText}`
                        : `Missing required field ${m.name}: ${m.typeText} on ${container.type.name}`,
                fix: insertPropertyFix(text, obj, m.name, placeholderFor(m)),
            })
        }
        if (container.kind === "input" && container.type.isOneOf && seen.size !== 1) {
            issues.push({
                from: obj.from,
                to: obj.from + 1,
                severity: "error",
                kind: "type",
                message: `${container.type.name} is a @oneOf input: exactly one field must be set`,
            })
        }
    }

    checkObject(root, { kind: "root" })
    return issues
}
