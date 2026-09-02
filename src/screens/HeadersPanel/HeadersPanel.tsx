import { useUnit } from "effector-react"
import { KeyRound, RefreshCw } from "lucide-react"

import { Button, HeadersEditor } from "@/components"
import {
    $persistentHeaders,
    $schemaLoading,
    $workspaceUrl,
    fetchSchema,
    persistentHeaderAdded,
    persistentHeaderChanged,
    persistentHeaderRemoved,
    persistentHeadersReplaced,
} from "@/models"

import styles from "./HeadersPanel.module.css"

export function HeadersPanel() {
    const [headers, url, add, change, remove, replace, refetch, loading] = useUnit([
        $persistentHeaders,
        $workspaceUrl,
        persistentHeaderAdded,
        persistentHeaderChanged,
        persistentHeaderRemoved,
        persistentHeadersReplaced,
        fetchSchema,
        $schemaLoading,
    ])
    const enabled = headers.filter(h => h.enabled && h.key.trim()).length

    return (
        <div className={styles.root}>
            <div className={styles.intro}>
                <div className={styles.introIcon}>
                    <KeyRound />
                </div>
                <div>
                    <div className={styles.introTitle}>Persistent headers</div>
                    <p className={styles.introText}>
                        Sent with <b>every</b> request and with schema introspection for{" "}
                        <span className={styles.url}>{url || "the current endpoint"}</span>. Per‑tab
                        headers override these when the names match.
                    </p>
                </div>
            </div>

            <div className={styles.editor}>
                <HeadersEditor
                    headers={headers}
                    onAdd={add}
                    onChange={(id, patch) => change({ id, patch })}
                    onRemove={remove}
                    onReplace={replace}
                    emptyHint="No persistent headers. Add an Authorization token, API key or anything your API needs."
                />
            </div>

            <div className={styles.footer}>
                <span className={styles.status}>
                    {enabled} active header{enabled === 1 ? "" : "s"}
                </span>
                <Button
                    size="sm"
                    variant="ghost"
                    icon={<RefreshCw />}
                    loading={loading}
                    onClick={() => refetch()}
                >
                    Re‑introspect with headers
                </Button>
            </div>
        </div>
    )
}
