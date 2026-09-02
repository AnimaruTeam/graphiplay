import { type OperationDefinitionNode, parse, print } from "graphql"

import type { OperationKind } from "@/shared/types"

export interface DocOperation {
    name: string | null
    kind: OperationKind
}

export function parseOperations(source: string): DocOperation[] {
    try {
        const doc = parse(source)
        return doc.definitions
            .filter((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")
            .map(d => ({ name: d.name?.value ?? null, kind: d.operation as OperationKind }))
    } catch {
        return []
    }
}

export function guessTitle(source: string, fallback = "Untitled"): string {
    const ops = parseOperations(source)
    const first = ops[0]
    if (first?.name) return first.name
    if (first) return `${first.kind}`
    const match = source.match(/(query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/)
    return match ? match[2] : fallback
}

export function prettify(source: string): string {
    return print(parse(source))
}

export function safeParseJson(
    text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
    const trimmed = text.trim()
    if (!trimmed) return { ok: true, value: {} }
    try {
        const value = JSON.parse(trimmed)
        if (value && typeof value === "object" && !Array.isArray(value)) return { ok: true, value }
        return { ok: false, error: "Variables must be a JSON object" }
    } catch (e) {
        return { ok: false, error: (e as Error).message }
    }
}

export function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function formatMs(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)} ms`
    return `${(ms / 1000).toFixed(2)} s`
}
