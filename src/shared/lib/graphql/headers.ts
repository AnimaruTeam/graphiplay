import { nanoid } from "nanoid"

import type { HeaderEntry, Tab } from "@/shared/types"

export const createHeader = (key = "", value = "", enabled = true): HeaderEntry => ({
    id: nanoid(8),
    key,
    value,
    enabled,
})

/** Merge header lists; later lists override earlier ones (case-insensitive keys). */
export function mergeHeaders(...lists: HeaderEntry[][]): Record<string, string> {
    const out: Record<string, string> = {}
    const canonical: Record<string, string> = {}
    for (const list of lists) {
        for (const h of list) {
            const key = h.key.trim()
            if (!h.enabled || !key) continue
            const lower = key.toLowerCase()
            if (canonical[lower] && canonical[lower] !== key) delete out[canonical[lower]]
            canonical[lower] = key
            out[key] = h.value
        }
    }
    return out
}

/** Persistent headers with the ones switched off for `tab` treated as disabled. */
export function persistentHeadersForTab(
    persistent: HeaderEntry[],
    tab: Pick<Tab, "disabledPersistentHeaders">,
): HeaderEntry[] {
    const off = tab.disabledPersistentHeaders
    if (!off?.length) return persistent
    return persistent.map(h => (off.includes(h.id) ? { ...h, enabled: false } : h))
}

export function parseHeadersJson(text: string): HeaderEntry[] {
    try {
        const obj = JSON.parse(text)
        if (!obj || typeof obj !== "object") return []
        return Object.entries(obj).map(([k, v]) => createHeader(k, String(v)))
    } catch {
        return []
    }
}
