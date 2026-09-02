import { Braces, Maximize2, Plus, Trash2 } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"

import { Button, IconButton, Switch } from "@/components"
import { modalOpened } from "@/models"
import { parseHeadersJson } from "@/shared/lib/graphql"
import type { HeaderEntry } from "@/shared/types"

import styles from "./HeadersEditor.module.css"

interface HeadersEditorProps {
    headers: HeaderEntry[]
    onAdd: () => void
    onChange: (id: string, patch: Partial<HeaderEntry>) => void
    onRemove: (id: string) => void
    onReplace?: (headers: HeaderEntry[]) => void
    emptyHint?: string
    compact?: boolean
}

const COMMON_KEYS = [
    "Authorization",
    "Content-Type",
    "Accept",
    "X-Api-Key",
    "X-Request-Id",
    "Cookie",
    "Origin",
]

export function HeadersEditor({
    headers,
    onAdd,
    onChange,
    onRemove,
    onReplace,
    emptyHint,
    compact,
}: HeadersEditorProps) {
    const [bulk, setBulk] = useState(false)
    const [bulkText, setBulkText] = useState("")

    const openBulk = () => {
        const obj: Record<string, string> = {}
        for (const h of headers) if (h.key) obj[h.key] = h.value
        setBulkText(JSON.stringify(obj, null, 2))
        setBulk(true)
    }
    const applyBulk = () => {
        onReplace?.(parseHeadersJson(bulkText))
        setBulk(false)
    }

    return (
        <div className={`${styles.root} ${compact ? styles.compact : ""}`}>
            <datalist id="gp-common-headers">
                {COMMON_KEYS.map(k => (
                    <option key={k} value={k} />
                ))}
            </datalist>

            {bulk ? (
                <div className={styles.bulk}>
                    <textarea
                        className={styles.bulkArea}
                        value={bulkText}
                        onChange={e => setBulkText(e.target.value)}
                        spellCheck={false}
                        placeholder='{ "Authorization": "Bearer …" }'
                    />
                    <div className={styles.bulkActions}>
                        <Button size="sm" variant="ghost" onClick={() => setBulk(false)}>
                            Cancel
                        </Button>
                        <Button size="sm" variant="primary" onClick={applyBulk}>
                            Apply JSON
                        </Button>
                    </div>
                </div>
            ) : (
                <>
                    <div className={styles.rows}>
                        <AnimatePresence initial={false}>
                            {headers.map(h => (
                                <motion.div
                                    key={h.id}
                                    className={`${styles.row} ${h.enabled ? "" : styles.disabled}`}
                                    initial={{ opacity: 0, y: -6, height: 0 }}
                                    animate={{ opacity: 1, y: 0, height: "auto" }}
                                    exit={{ opacity: 0, x: -12, height: 0 }}
                                    transition={{ type: "spring", stiffness: 420, damping: 32 }}
                                >
                                    <div className={styles.rowInner}>
                                        <Switch
                                            checked={h.enabled}
                                            onChange={enabled => onChange(h.id, { enabled })}
                                            label="Enabled"
                                        />
                                        <input
                                            className={`${styles.input} ${styles.key}`}
                                            list="gp-common-headers"
                                            placeholder="Header"
                                            value={h.key}
                                            spellCheck={false}
                                            onChange={e => onChange(h.id, { key: e.target.value })}
                                        />
                                        <input
                                            className={styles.input}
                                            placeholder="Value"
                                            value={h.value}
                                            spellCheck={false}
                                            onChange={e =>
                                                onChange(h.id, { value: e.target.value })
                                            }
                                        />
                                        <IconButton
                                            label="Expand value"
                                            size="sm"
                                            onClick={() =>
                                                modalOpened({
                                                    kind: "headerValue",
                                                    header: h.key,
                                                    value: h.value,
                                                    onSave: value => onChange(h.id, { value }),
                                                })
                                            }
                                        >
                                            <Maximize2 />
                                        </IconButton>
                                        <IconButton
                                            label="Remove header"
                                            size="sm"
                                            tone="danger"
                                            onClick={() => onRemove(h.id)}
                                        >
                                            <Trash2 />
                                        </IconButton>
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                        {headers.length === 0 && emptyHint && (
                            <div className={styles.hint}>{emptyHint}</div>
                        )}
                    </div>
                    <div className={styles.actions}>
                        <Button size="sm" variant="soft" icon={<Plus />} onClick={onAdd}>
                            Add header
                        </Button>
                        {onReplace && (
                            <Button size="sm" variant="ghost" icon={<Braces />} onClick={openBulk}>
                                Bulk edit
                            </Button>
                        )}
                    </div>
                </>
            )}
        </div>
    )
}
