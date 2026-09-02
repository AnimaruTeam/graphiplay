import { useUnit } from "effector-react"
import { Maximize2, Pencil } from "lucide-react"

import { Button, HeadersEditor, IconButton, Switch } from "@/components"
import {
    $activePanel,
    $persistentHeaders,
    $sidebarCollapsed,
    modalOpened,
    panelSelected,
    tabHeaderAdded,
    tabHeaderChanged,
    tabHeaderRemoved,
    tabPersistentHeaderToggled,
    tabUpdated,
} from "@/models"
import type { Tab } from "@/shared/types"

import styles from "./TabHeaders.module.css"

/** Bottom-panel "Headers" tab: persistent headers with per-tab switches, then the tab's own headers. */
export function TabHeaders({ tab }: { tab: Tab }) {
    const [persistent, togglePersistent, update] = useUnit([
        $persistentHeaders,
        tabPersistentHeaderToggled,
        tabUpdated,
    ])
    const [activePanel, sidebarCollapsed, selectPanel, openModal] = useUnit([
        $activePanel,
        $sidebarCollapsed,
        panelSelected,
        modalOpened,
    ])
    const disabled = tab.disabledPersistentHeaders ?? []
    const visible = persistent.filter(h => h.key.trim())

    // panelSelected toggles collapse when the panel is already open, so only call it when needed.
    const openPersistent = () => {
        if (activePanel !== "headers" || sidebarCollapsed) selectPanel("headers")
    }

    return (
        <div className={styles.root}>
            <section className={styles.section}>
                <header className={styles.sectionHead}>
                    <span className={styles.sectionTitle}>Persistent</span>
                    <Button size="sm" variant="ghost" icon={<Pencil />} onClick={openPersistent}>
                        Edit
                    </Button>
                </header>
                {visible.length === 0 ? (
                    <div className={styles.hint}>No persistent headers for this endpoint.</div>
                ) : (
                    <div className={styles.rows}>
                        {visible.map(h => {
                            const offForTab = disabled.includes(h.id)
                            const on = h.enabled && !offForTab
                            return (
                                <div
                                    key={h.id}
                                    className={`${styles.row} ${on ? "" : styles.rowOff}`}
                                >
                                    <Switch
                                        checked={on}
                                        disabled={!h.enabled}
                                        onChange={enabled =>
                                            togglePersistent({ tabId: tab.id, id: h.id, enabled })
                                        }
                                        label={
                                            h.enabled
                                                ? offForTab
                                                    ? "Enable for this tab"
                                                    : "Disable for this tab"
                                                : "Disabled globally"
                                        }
                                    />
                                    <span className={styles.key} title={h.key}>
                                        {h.key}
                                    </span>
                                    <span className={styles.value} title={h.value}>
                                        {h.value}
                                    </span>
                                    <span className={styles.rowEnd}>
                                        {!h.enabled && (
                                            <span className={styles.tag}>off globally</span>
                                        )}
                                        <IconButton
                                            label="View value"
                                            size="sm"
                                            onClick={() =>
                                                openModal({
                                                    kind: "headerValue",
                                                    header: h.key,
                                                    value: h.value,
                                                })
                                            }
                                        >
                                            <Maximize2 />
                                        </IconButton>
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                )}
            </section>

            <section className={styles.section}>
                <header className={styles.sectionHead}>
                    <span className={styles.sectionTitle}>This tab</span>
                </header>
                <HeadersEditor
                    compact
                    headers={tab.headers}
                    onAdd={() => tabHeaderAdded(tab.id)}
                    onChange={(id, patch) => tabHeaderChanged({ tabId: tab.id, id, patch })}
                    onRemove={id => tabHeaderRemoved({ tabId: tab.id, id })}
                    onReplace={headers => update({ id: tab.id, patch: { headers } })}
                    emptyHint="Per‑tab headers are merged over persistent headers for this request only."
                />
            </section>
        </div>
    )
}
