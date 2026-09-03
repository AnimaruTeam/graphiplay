import { useUnit } from "effector-react"
import { Check, FolderPlus } from "lucide-react"
import { useEffect, useState } from "react"

import { Button, Field, Input, Kbd, Modal, Switch, altKey, modKey } from "@/components"
import {
    $collections,
    $items,
    $modal,
    $schemaPollInterval,
    $schemaPolling,
    $tabs,
    $transport,
    $url,
    $wsUrl,
    COLLECTION_COLORS,
    type Modal as ModalState,
    SCHEMA_POLL_INTERVALS,
    collectionCreated,
    collectionCreatedDone,
    collectionRecolored,
    collectionRenamed,
    itemRenamed,
    itemSaved,
    itemSavedDone,
    modalClosed,
    schemaPollIntervalChanged,
    schemaPollingToggled,
    tabUpdated,
    toastShown,
    transportChanged,
    wsUrlChanged,
} from "@/models"
import { deriveWsUrl, guessTitle } from "@/shared/lib/graphql"

import styles from "./Modals.module.css"

export function Modals() {
    const [modal, close] = useUnit([$modal, modalClosed])
    // Keep the last modal rendered during the exit animation.
    const [last, setLast] = useState<ModalState | null>(null)
    useEffect(() => {
        if (modal) setLast(modal)
    }, [modal])
    const current = modal ?? last
    if (!current) return null

    const open = modal !== null
    switch (current.kind) {
        case "saveToCollection":
            return (
                <SaveToCollection
                    key={current.tabId}
                    open={open}
                    tabId={current.tabId}
                    onClose={close}
                />
            )
        case "newCollection":
            return <NewCollection open={open} onClose={close} />
        case "renameCollection":
            return <RenameCollection key={current.id} open={open} id={current.id} onClose={close} />
        case "renameItem":
            return <RenameItem key={current.id} open={open} id={current.id} onClose={close} />
        case "confirm":
            return <Confirm open={open} modal={current} onClose={close} />
        case "endpointSettings":
            return <EndpointSettings open={open} onClose={close} />
        case "shortcuts":
            return <Shortcuts open={open} onClose={close} />
        case "headerValue":
            return <HeaderValue open={open} modal={current} onClose={close} />
    }
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
    return (
        <div className={styles.colors}>
            {COLLECTION_COLORS.map(c => (
                <button
                    key={c}
                    type="button"
                    className={`${styles.color} ${value === c ? styles.colorActive : ""}`}
                    style={{ ["--c" as string]: c }}
                    onClick={() => onChange(c)}
                    aria-label={c}
                >
                    {value === c && <Check />}
                </button>
            ))}
        </div>
    )
}

function SaveToCollection({
    open,
    tabId,
    onClose,
}: {
    open: boolean
    tabId: string
    onClose: () => void
}) {
    const [tabs, collections, save, createCollection, update, toast] = useUnit([
        $tabs,
        $collections,
        itemSaved,
        collectionCreated,
        tabUpdated,
        toastShown,
    ])
    const tab = tabs.find(t => t.id === tabId)
    const [name, setName] = useState(() =>
        tab ? (tab.title !== "Untitled" ? tab.title : guessTitle(tab.query)) : "",
    )
    const [collectionId, setCollectionId] = useState<string>(collections[0]?.id ?? "new")
    const [newName, setNewName] = useState("")
    const [newColor, setNewColor] = useState(
        COLLECTION_COLORS[collections.length % COLLECTION_COLORS.length],
    )
    const [pending, setPending] = useState(false)

    useEffect(() => {
        if (!open) return
        const unsubSaved = itemSavedDone.watch(id => {
            update({ id: tabId, patch: { collectionItemId: id, title: name.trim() || "Untitled" } })
            toast({ title: "Saved to collection", description: name, tone: "success" })
            setPending(false)
            onClose()
        })
        const unsubCreated = collectionCreatedDone.watch(cid => {
            if (!pending || !tab) return
            save({
                collectionId: cid,
                name: name.trim() || "Untitled",
                query: tab.query,
                variables: tab.variables,
                headers: tab.headers,
            })
        })
        return () => {
            unsubSaved()
            unsubCreated()
        }
    }, [open, name, tabId, tab, pending, save, update, toast, onClose])

    const submit = () => {
        if (!tab) return
        setPending(true)
        if (collectionId === "new")
            createCollection({ name: newName.trim() || "My collection", color: newColor })
        else
            save({
                collectionId,
                name: name.trim() || "Untitled",
                query: tab.query,
                variables: tab.variables,
                headers: tab.headers,
            })
    }

    return (
        <Modal
            open={open}
            title="Save to collection"
            description="Stores the query, variables and per‑tab headers locally in your browser."
            onClose={onClose}
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={submit} loading={pending} disabled={!tab}>
                        Save
                    </Button>
                </>
            }
        >
            <form
                className={styles.form}
                onSubmit={e => {
                    e.preventDefault()
                    submit()
                }}
            >
                <Field label="Name">
                    <Input
                        autoFocus
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Operation name"
                    />
                </Field>
                <Field label="Collection">
                    <div className={styles.collectionList}>
                        {collections.map(c => (
                            <button
                                key={c.id}
                                type="button"
                                className={`${styles.collectionOption} ${collectionId === c.id ? styles.collectionOptionActive : ""}`}
                                onClick={() => setCollectionId(c.id)}
                            >
                                <span className={styles.dot} style={{ background: c.color }} />
                                {c.name}
                            </button>
                        ))}
                        <button
                            type="button"
                            className={`${styles.collectionOption} ${collectionId === "new" ? styles.collectionOptionActive : ""}`}
                            onClick={() => setCollectionId("new")}
                        >
                            <FolderPlus />
                            New collection
                        </button>
                    </div>
                </Field>
                {collectionId === "new" && (
                    <div className={styles.newCollection}>
                        <Field label="Collection name">
                            <Input
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                placeholder="e.g. Users API"
                            />
                        </Field>
                        <ColorPicker value={newColor} onChange={setNewColor} />
                    </div>
                )}
            </form>
        </Modal>
    )
}

function NewCollection({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [collections, create, toast] = useUnit([$collections, collectionCreated, toastShown])
    const [name, setName] = useState("")
    const [color, setColor] = useState(
        COLLECTION_COLORS[collections.length % COLLECTION_COLORS.length],
    )
    const submit = () => {
        create({ name, color })
        toast({
            title: "Collection created",
            description: name.trim() || "Untitled collection",
            tone: "success",
        })
        onClose()
    }
    return (
        <Modal
            open={open}
            title="New collection"
            onClose={onClose}
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={submit}>
                        Create
                    </Button>
                </>
            }
        >
            <form
                className={styles.form}
                onSubmit={e => {
                    e.preventDefault()
                    submit()
                }}
            >
                <Field label="Name">
                    <Input
                        autoFocus
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="e.g. Users API"
                    />
                </Field>
                <Field label="Color">
                    <ColorPicker value={color} onChange={setColor} />
                </Field>
            </form>
        </Modal>
    )
}

function RenameCollection({
    open,
    id,
    onClose,
}: {
    open: boolean
    id: string
    onClose: () => void
}) {
    const [collections, rename, recolor] = useUnit([
        $collections,
        collectionRenamed,
        collectionRecolored,
    ])
    const c = collections.find(x => x.id === id)
    const [name, setName] = useState(c?.name ?? "")
    const [color, setColor] = useState(c?.color ?? COLLECTION_COLORS[0])
    const submit = () => {
        if (!c) return
        if (name.trim() && name.trim() !== c.name) rename({ id, name: name.trim() })
        if (color !== c.color) recolor({ id, color })
        onClose()
    }
    return (
        <Modal
            open={open}
            title="Edit collection"
            onClose={onClose}
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={submit}>
                        Save
                    </Button>
                </>
            }
        >
            <form
                className={styles.form}
                onSubmit={e => {
                    e.preventDefault()
                    submit()
                }}
            >
                <Field label="Name">
                    <Input autoFocus value={name} onChange={e => setName(e.target.value)} />
                </Field>
                <Field label="Color">
                    <ColorPicker value={color} onChange={setColor} />
                </Field>
            </form>
        </Modal>
    )
}

function RenameItem({ open, id, onClose }: { open: boolean; id: string; onClose: () => void }) {
    const [items, tabs, rename, update] = useUnit([$items, $tabs, itemRenamed, tabUpdated])
    const item = items.find(x => x.id === id)
    const [name, setName] = useState(item?.name ?? "")
    const submit = () => {
        const next = name.trim()
        if (item && next && next !== item.name) {
            rename({ id, name: next })
            const linked = tabs.find(t => t.collectionItemId === id)
            if (linked) update({ id: linked.id, patch: { title: next } })
        }
        onClose()
    }
    return (
        <Modal
            open={open}
            title="Rename operation"
            onClose={onClose}
            width={400}
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={submit}>
                        Rename
                    </Button>
                </>
            }
        >
            <form
                className={styles.form}
                onSubmit={e => {
                    e.preventDefault()
                    submit()
                }}
            >
                <Field label="Name">
                    <Input autoFocus value={name} onChange={e => setName(e.target.value)} />
                </Field>
            </form>
        </Modal>
    )
}

function Confirm({
    open,
    modal,
    onClose,
}: {
    open: boolean
    modal: Extract<ModalState, { kind: "confirm" }>
    onClose: () => void
}) {
    return (
        <Modal
            open={open}
            title={modal.title}
            description={modal.message}
            onClose={onClose}
            width={420}
            footer={
                <>
                    <Button variant="ghost" onClick={onClose} autoFocus>
                        Cancel
                    </Button>
                    <Button
                        variant={modal.danger ? "danger" : "primary"}
                        onClick={() => {
                            modal.onConfirm()
                            onClose()
                        }}
                    >
                        {modal.danger ? "Delete" : "Confirm"}
                    </Button>
                </>
            }
        />
    )
}

const formatInterval = (s: number) => (s < 60 ? `${s}s` : `${s / 60}m`)

function EndpointSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [url, wsUrl, transport, setWs, setTransport] = useUnit([
        $url,
        $wsUrl,
        $transport,
        wsUrlChanged,
        transportChanged,
    ])
    const [polling, pollInterval, setPolling, setPollInterval] = useUnit([
        $schemaPolling,
        $schemaPollInterval,
        schemaPollingToggled,
        schemaPollIntervalChanged,
    ])
    return (
        <Modal
            open={open}
            title="Endpoint settings"
            description="Subscriptions transport and schema polling for the current endpoint."
            onClose={onClose}
            width={500}
            footer={
                <Button variant="primary" onClick={onClose}>
                    Done
                </Button>
            }
        >
            <div className={styles.form}>
                <Field label="HTTP endpoint">
                    <Input value={url} readOnly className={styles.readonly} />
                </Field>
                <Field label="Subscriptions transport">
                    <div className={styles.segmented}>
                        {(["ws", "sse"] as const).map(t => (
                            <button
                                key={t}
                                type="button"
                                className={`${styles.segment} ${transport === t ? styles.segmentActive : ""}`}
                                onClick={() => setTransport(t)}
                            >
                                {t === "ws" ? "WebSocket (graphql-ws)" : "SSE (graphql-sse)"}
                            </button>
                        ))}
                    </div>
                </Field>
                {transport === "ws" && (
                    <Field
                        label="WebSocket URL"
                        hint={`Leave empty to use ${deriveWsUrl(url) || "the derived ws:// URL"}`}
                    >
                        <Input
                            value={wsUrl}
                            onChange={e => setWs(e.target.value)}
                            placeholder={deriveWsUrl(url)}
                        />
                    </Field>
                )}
                <p className={styles.note}>
                    Persistent headers are sent as <code>connectionParams</code> over WebSocket and
                    as HTTP headers over SSE.
                </p>

                <div className={styles.switchRow}>
                    <div>
                        <div className={styles.switchLabel}>Poll schema automatically</div>
                        <div className={styles.switchHint}>
                            Re-introspect in the background and reload when the schema changes.
                        </div>
                    </div>
                    <Switch
                        checked={polling}
                        onChange={setPolling}
                        label="Poll schema automatically"
                    />
                </div>
                {polling && (
                    <Field label="Poll interval">
                        <div className={styles.segmented}>
                            {SCHEMA_POLL_INTERVALS.map(s => (
                                <button
                                    key={s}
                                    type="button"
                                    className={`${styles.segment} ${pollInterval === s ? styles.segmentActive : ""}`}
                                    onClick={() => setPollInterval(s)}
                                >
                                    {formatInterval(s)}
                                </button>
                            ))}
                        </div>
                    </Field>
                )}
            </div>
        </Modal>
    )
}

function HeaderValue({
    open,
    modal,
    onClose,
}: {
    open: boolean
    modal: Extract<ModalState, { kind: "headerValue" }>
    onClose: () => void
}) {
    const [value, setValue] = useState(modal.value)
    const readOnly = !modal.onSave
    const save = () => {
        modal.onSave?.(value)
        onClose()
    }
    return (
        <Modal
            open={open}
            title={modal.header.trim() || "Header value"}
            description={
                readOnly
                    ? "Persistent header value (edit it in the sidebar)."
                    : `${modKey}+↵ to save`
            }
            onClose={onClose}
            width={680}
            footer={
                readOnly ? (
                    <Button variant="primary" onClick={onClose}>
                        Close
                    </Button>
                ) : (
                    <>
                        <Button variant="ghost" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button variant="primary" onClick={save}>
                            Save
                        </Button>
                    </>
                )
            }
        >
            <textarea
                className={styles.valueArea}
                value={value}
                readOnly={readOnly}
                autoFocus
                spellCheck={false}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => {
                    if (!readOnly && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault() // otherwise the global Mod+Enter runs the query once the modal closes
                        save()
                    }
                }}
            />
            <div className={styles.valueMeta}>{value.length.toLocaleString()} chars</div>
        </Modal>
    )
}

const SHORTCUTS: [string[], string][] = [
    [[modKey, "↵"], "Run / stop the active operation"],
    [[modKey, "S"], "Save to collection (or update the linked item)"],
    [[modKey, "K"], "Command palette"],
    [["Shift", "Alt", "F"], "Prettify query & variables"],
    [[altKey, "Space"], "Suggest fields & types at the cursor"],
    [["Ctrl", "Space"], "Same, CodeMirror's default binding"],
    [[altKey, "T"], "New tab"],
    [[altKey, "W"], "Close tab"],
    [[modKey, "B"], "Toggle sidebar"],
    [[modKey, "F"], "Search in editor"],
]

function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
    return (
        <Modal open={open} title="Keyboard shortcuts" onClose={onClose} width={440}>
            <div className={styles.shortcuts}>
                {SHORTCUTS.map(([keys, label]) => (
                    <div key={label} className={styles.shortcut}>
                        <span>{label}</span>
                        <span className={styles.keys}>
                            {keys.map(k => (
                                <Kbd key={k}>{k}</Kbd>
                            ))}
                        </span>
                    </div>
                ))}
            </div>
        </Modal>
    )
}
