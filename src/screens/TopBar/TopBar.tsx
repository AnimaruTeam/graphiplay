import { useUnit } from "effector-react"
import {
    BookmarkPlus,
    ChevronDown,
    Keyboard,
    Monitor,
    Moon,
    RefreshCw,
    Search,
    Settings2,
    Sun,
    Trash2,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef, useState } from "react"

import { Button, IconButton, Kbd, modKey } from "@/components"
import {
    $endpoints,
    $schema,
    $schemaError,
    $schemaFetchedAt,
    $schemaLoading,
    $schemaPollInterval,
    $schemaPolling,
    $schemaUrl,
    $theme,
    $url,
    $workspaceUrl,
    type ThemeSetting,
    endpointDeleted,
    endpointSaved,
    endpointSelected,
    fetchSchema,
    modalOpened,
    paletteToggled,
    themeChanged,
    toastShown,
    urlChanged,
    urlCommitted,
} from "@/models"
import { useMediaQuery } from "@/shared/lib/hooks"
import { REPO_URL } from "@/shared/meta"

import styles from "./TopBar.module.css"

const THEMES: { value: ThemeSetting; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: "Light theme", icon: <Sun /> },
    { value: "dark", label: "Dark theme", icon: <Moon /> },
    { value: "system", label: "Follow system", icon: <Monitor /> },
]

export function TopBar() {
    const [url, workspaceUrl, endpoints, schema, loading, error, fetchedAt, schemaUrl] = useUnit([
        $url,
        $workspaceUrl,
        $endpoints,
        $schema,
        $schemaLoading,
        $schemaError,
        $schemaFetchedAt,
        $schemaUrl,
    ])
    const [polling, pollInterval] = useUnit([$schemaPolling, $schemaPollInterval])
    const [
        setUrl,
        commitUrl,
        refetch,
        selectEndpoint,
        deleteEndpoint,
        saveEndpoint,
        openModal,
        togglePalette,
        toast,
    ] = useUnit([
        urlChanged,
        urlCommitted,
        fetchSchema,
        endpointSelected,
        endpointDeleted,
        endpointSaved,
        modalOpened,
        paletteToggled,
        toastShown,
    ])
    const [theme, setTheme] = useUnit([$theme, themeChanged])
    const [menuOpen, setMenuOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)
    // Mirrors stage 3 in TopBar.module.css: the reload button is icon-only from 900px down.
    const compact = useMediaQuery("(max-width: 900px)")

    useEffect(() => {
        if (!menuOpen) return
        // pointerdown rather than mousedown: touch taps don't always synthesize mouse events in time.
        const onDown = (e: PointerEvent) => {
            if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
        }
        window.addEventListener("pointerdown", onDown)
        return () => window.removeEventListener("pointerdown", onDown)
    }, [menuOpen])

    const stale = schema && schemaUrl && schemaUrl !== url.trim()
    const status = loading ? "loading" : error ? "error" : schema && !stale ? "ok" : "idle"
    const statusLabel = {
        loading: "Fetching schema…",
        error: error ?? "Error",
        ok: [
            fetchedAt
                ? `Schema loaded · ${new Date(fetchedAt).toLocaleTimeString()}`
                : "Schema loaded",
            polling &&
                `polling every ${pollInterval < 60 ? `${pollInterval}s` : `${pollInterval / 60}m`}`,
        ]
            .filter(Boolean)
            .join(" · "),
        idle: stale ? "Endpoint changed — reload schema" : "No schema loaded",
    }[status]

    const isSaved = endpoints.some(e => e.url === url)

    return (
        <header className={styles.bar}>
            {/* The wordmark as a selection set — the smallest possible GraphQL query, and the
                way to the source. The braces open up on hover like the editor's own folding. */}
            <a
                className={styles.brand}
                href={REPO_URL}
                target="_blank"
                rel="noreferrer noopener"
                title="Graphiplay — source on GitHub"
            >
                <span className={styles.brace} aria-hidden="true">
                    {"{"}
                </span>
                <span className={styles.brandName}>graphiplay</span>
                <span className={styles.brace} aria-hidden="true">
                    {"}"}
                </span>
            </a>

            <div className={styles.center}>
                <div className={`${styles.urlBox} ${styles[status]}`}>
                    <span className={styles.statusDot} title={statusLabel} />
                    <input
                        className={styles.urlInput}
                        value={url}
                        spellCheck={false}
                        placeholder="https://api.example.com/graphql"
                        onChange={e => setUrl(e.target.value)}
                        onBlur={() => commitUrl()}
                        onKeyDown={e => {
                            if (e.key !== "Enter") return
                            // A new URL switches the workspace (and loads its schema); the same one just re-introspects.
                            if (url.trim() === workspaceUrl) refetch()
                            else commitUrl()
                        }}
                    />
                    <span className={`${styles.statusText} ${styles[`status_${status}`]}`}>
                        {statusLabel}
                    </span>
                    <div className={styles.urlActions} ref={menuRef}>
                        <IconButton
                            label={
                                isSaved
                                    ? "Endpoint saved — update headers snapshot"
                                    : "Save endpoint"
                            }
                            size="sm"
                            active={isSaved}
                            onClick={() => {
                                saveEndpoint()
                                toast({
                                    title: isSaved ? "Endpoint updated" : "Endpoint saved",
                                    tone: "success",
                                })
                            }}
                        >
                            <BookmarkPlus />
                        </IconButton>
                        <IconButton
                            label="Saved endpoints"
                            size="sm"
                            active={menuOpen}
                            onClick={() => setMenuOpen(v => !v)}
                        >
                            <ChevronDown />
                        </IconButton>
                        <AnimatePresence>
                            {menuOpen && (
                                <motion.div
                                    className={styles.menu}
                                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -2, scale: 0.98 }}
                                    transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
                                >
                                    <div className={styles.menuTitle}>Saved endpoints</div>
                                    {endpoints.length === 0 && (
                                        <div className={styles.menuEmpty}>
                                            Nothing saved yet. Press the bookmark icon to remember
                                            the current URL and its headers.
                                        </div>
                                    )}
                                    {endpoints.map(e => (
                                        <div
                                            key={e.id}
                                            className={`${styles.menuItem} ${e.url === url ? styles.menuItemActive : ""}`}
                                        >
                                            <button
                                                className={styles.menuItemMain}
                                                onClick={() => {
                                                    selectEndpoint(e.id)
                                                    setMenuOpen(false)
                                                }}
                                            >
                                                <span className={styles.menuItemName}>
                                                    {e.name}
                                                </span>
                                                <span className={styles.menuItemUrl}>{e.url}</span>
                                                {e.headers.length > 0 && (
                                                    <span className={styles.menuItemMeta}>
                                                        {e.headers.length} header(s)
                                                    </span>
                                                )}
                                            </button>
                                            <IconButton
                                                label="Delete"
                                                size="sm"
                                                tone="danger"
                                                onClick={() => {
                                                    setMenuOpen(false)
                                                    openModal({
                                                        kind: "confirm",
                                                        title: `Remove “${e.name}” from saved endpoints?`,
                                                        message: `${e.url} will no longer appear in this list. Its tabs, collections and headers stay in place — you can still open it by typing the URL.`,
                                                        danger: true,
                                                        onConfirm: () => {
                                                            deleteEndpoint(e.id)
                                                            toast({
                                                                title: "Endpoint removed",
                                                                description: e.name,
                                                                tone: "info",
                                                            })
                                                        },
                                                    })
                                                }}
                                            >
                                                <Trash2 />
                                            </IconButton>
                                        </div>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
                <Button
                    variant={status === "ok" ? "soft" : "primary"}
                    icon={<RefreshCw className={loading ? styles.spin : ""} />}
                    onClick={() => refetch()}
                    loading={loading}
                    className={styles.reload}
                    title={status === "ok" ? "Reload schema" : "Load schema"}
                >
                    {compact ? null : status === "ok" ? "Reload schema" : "Load schema"}
                </Button>
            </div>

            <div className={styles.right}>
                <button
                    className={styles.paletteBtn}
                    onClick={() => togglePalette(true)}
                    aria-label="Search"
                >
                    <Search />
                    <span className={styles.paletteText}>
                        <span>Search</span>
                        <Kbd>{modKey}</Kbd>
                        <Kbd>K</Kbd>
                    </span>
                </button>
                <div className={styles.themeSwitch} role="radiogroup" aria-label="Theme">
                    {THEMES.map(t => (
                        <button
                            key={t.value}
                            role="radio"
                            aria-checked={theme === t.value}
                            aria-label={t.label}
                            title={t.label}
                            className={`${styles.themeOption} ${theme === t.value ? styles.themeOptionActive : ""}`}
                            onClick={() => setTheme(t.value)}
                        >
                            {t.icon}
                        </button>
                    ))}
                </div>
                <IconButton
                    label="Endpoint settings"
                    onClick={() => openModal({ kind: "endpointSettings" })}
                >
                    <Settings2 />
                </IconButton>
                <IconButton
                    label="Keyboard shortcuts"
                    className={styles.desktopOnly}
                    onClick={() => openModal({ kind: "shortcuts" })}
                >
                    <Keyboard />
                </IconButton>
            </div>
        </header>
    )
}
