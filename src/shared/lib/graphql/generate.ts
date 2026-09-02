import {
    type GraphQLField,
    type GraphQLInputType,
    type GraphQLOutputType,
    type GraphQLSchema,
    getNamedType,
    isEnumType,
    isInputObjectType,
    isInterfaceType,
    isLeafType,
    isObjectType,
    isUnionType,
    parse,
    print,
} from "graphql"

import type { OperationKind } from "@/shared/types"

const MAX_DEPTH = 3

function selectionFor(type: GraphQLOutputType, depth: number, visited: Set<string>): string {
    const named = getNamedType(type)
    if (isLeafType(named)) return ""
    if (depth >= MAX_DEPTH) return " { __typename }"

    if (isObjectType(named) || isInterfaceType(named)) {
        if (visited.has(named.name)) return " { __typename }"
        const nextVisited = new Set(visited).add(named.name)
        const fields = Object.values(named.getFields())
        const parts: string[] = []
        const leaf = fields.filter(f => isLeafType(getNamedType(f.type)) && f.args.length === 0)
        const nested = fields.filter(f => !isLeafType(getNamedType(f.type)) && f.args.length === 0)
        for (const f of leaf) parts.push(f.name)
        for (const f of nested.slice(0, 6)) {
            const sub = selectionFor(f.type, depth + 1, nextVisited)
            if (sub) parts.push(`${f.name}${sub}`)
        }
        if (parts.length === 0) parts.push("__typename")
        return ` { ${parts.join(" ")} }`
    }

    if (isUnionType(named)) {
        const parts = named
            .getTypes()
            .slice(0, 4)
            .map(t => `... on ${t.name}${selectionFor(t, depth + 1, visited)}`)
        return ` { __typename ${parts.join(" ")} }`
    }
    return ""
}

export function generateOperation(
    schema: GraphQLSchema,
    kind: OperationKind,
    field: GraphQLField<unknown, unknown>,
): { query: string; variables: string } {
    const opName = field.name.charAt(0).toUpperCase() + field.name.slice(1)
    const varDefs = field.args.map(a => `$${a.name}: ${a.type.toString()}`)
    const argUsage = field.args.map(a => `${a.name}: $${a.name}`)
    const selection = selectionFor(field.type, 1, new Set())

    const head = varDefs.length ? `${kind} ${opName}(${varDefs.join(", ")})` : `${kind} ${opName}`
    const call = argUsage.length ? `${field.name}(${argUsage.join(", ")})` : field.name
    const raw = `${head} { ${call}${selection} }`

    let query = raw
    try {
        query = print(parse(raw))
    } catch {
        /* keep raw */
    }

    const variables: Record<string, unknown> = {}
    for (const a of field.args) {
        variables[a.name] = defaultValueFor(a.type, schema, new Set())
    }

    return {
        query,
        variables: field.args.length ? JSON.stringify(variables, null, 2) : "{}",
    }
}

export function defaultValueFor(
    type: GraphQLInputType,
    schema: GraphQLSchema,
    visited: Set<string>,
): unknown {
    const typeStr = type.toString()
    const named = getNamedType(type)
    const isList = typeStr.startsWith("[")
    let value: unknown
    switch (named.name) {
        case "Int":
        case "Float":
            value = 0
            break
        case "Boolean":
            value = false
            break
        case "ID":
        case "String":
            value = ""
            break
        default: {
            if (isEnumType(named)) value = named.getValues()[0]?.name ?? null
            else if (isInputObjectType(named)) {
                if (visited.has(named.name)) value = {}
                else {
                    const next = new Set(visited).add(named.name)
                    const obj: Record<string, unknown> = {}
                    for (const f of Object.values(named.getFields())) {
                        if (f.type.toString().endsWith("!"))
                            obj[f.name] = defaultValueFor(f.type, schema, next)
                    }
                    value = obj
                }
            } else value = null
        }
    }
    return isList ? [value] : value
}
