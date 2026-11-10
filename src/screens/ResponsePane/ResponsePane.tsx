import { useUnit } from "effector-react"
import {
    AlertTriangle,
    Braces,
    Check,
    Copy,
    Fingerprint,
    KeyRound,
    Radio,
    Sparkles,
    Trash2,
    Zap,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"

import { CodeEditor, IconButton } from "@/components"
import { $activeResponse, $activeTab, responseCleared, toastShown } from "@/models"
import { formatBytes, formatMs } from "@/shared/lib/graphql"
import type { BodyCompression, PersistedQuery, ResponseState } from "@/shared/types"

import styles from "./ResponsePane.module.css"

export function ResponsePane() {
    const [res, tab, clear, toast] = useUnit([
        $activeResponse,
        $activeTab,
        responseCleared,
        toastShown,
    ])
    const [copied, setCopied] = useState(false)
    const [view, setView] = useState<"body" | "headers">("body")

    const headers = Object.entries(res.headers ?? {})
    // Subscriptions and network failures carry no headers; the tab disappears with them.
    const shown = view === "headers" && headers.length ? "headers" : "body"

    const copy = async () => {
        await navigator.clipboard.writeText(
            shown === "headers" ? JSON.stringify(res.headers ?? {}, null, 2) : res.body,
        )
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
    }

    const hasBody = res.body.length > 0
    const statusTone =
        res.status === "error"
            ? "error"
            : res.status === "success"
              ? "success"
              : res.status === "streaming"
                ? "streaming"
                : "idle"

    return (
        <div className={styles.root}>
            <div className={styles.head}>
                <span className={styles.label}>Response</span>
                <AnimatePresence mode="popLayout" initial={false}>
                    {res.status !== "idle" && (
                        <motion.div
                            key={res.status + String(res.httpStatus)}
                            className={styles.meta}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.18 }}
                        >
                            <span className={`${styles.pill} ${styles[statusTone]}`}>
                                {res.status === "loading" && <span className={styles.spinner} />}
                                {res.status === "streaming" && <Radio className={styles.live} />}
                                {res.status === "success" && <Check />}
                                {res.status === "error" && <AlertTriangle />}
                                {res.status === "loading"
                                    ? "Running"
                                    : res.status === "streaming"
                                      ? "Live"
                                      : res.httpStatus
                                        ? `HTTP ${res.httpStatus}`
                                        : res.status}
                            </span>
                            {res.durationMs != null && (
                                <span className={styles.stat}>{formatMs(res.durationMs)}</span>
                            )}
                            {res.size != null &&
                                (res.events ? (
                                    <span className={styles.stat}>
                                        {res.size} event{res.size === 1 ? "" : "s"}
                                    </span>
                                ) : (
                                    <>
                                        <span className={styles.stat} title={transferTitle(res)}>
                                            {formatBytes(res.size)}
                                            {res.responseCompression?.encodedSize != null && (
                                                <span className={styles.wire}>
                                                    {" → "}
                                                    {formatBytes(
                                                        res.responseCompression.encodedSize,
                                                    )}
                                                </span>
                                            )}
                                        </span>
                                        {res.responseCompression && (
                                            <span
                                                className={styles.encoding}
                                                title={transferTitle(res)}
                                            >
                                                {res.responseCompression.encoding}
                                            </span>
                                        )}
                                    </>
                                ))}
                            {res.status === "streaming" && res.events && (
                                <span className={styles.stat}>
                                    {res.events.length} event{res.events.length === 1 ? "" : "s"}
                                </span>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
                <div className={styles.spacer} />
                {headers.length > 0 && (
                    <div className={styles.tabs}>
                        <button
                            className={`${styles.tab} ${shown === "body" ? styles.tabActive : ""}`}
                            onClick={() => setView("body")}
                        >
                            <Braces />
                            <span className={styles.tabText}>Body</span>
                        </button>
                        <button
                            className={`${styles.tab} ${shown === "headers" ? styles.tabActive : ""}`}
                            onClick={() => setView("headers")}
                        >
                            <KeyRound />
                            <span className={styles.tabText}>Headers</span>
                            <span className={styles.count}>{headers.length}</span>
                        </button>
                    </div>
                )}
                {(hasBody || shown === "headers") && (
                    <>
                        <IconButton
                            label={
                                copied
                                    ? "Copied"
                                    : shown === "headers"
                                      ? "Copy headers"
                                      : "Copy response"
                            }
                            size="sm"
                            onClick={copy}
                        >
                            {copied ? <Check /> : <Copy />}
                        </IconButton>
                        <IconButton label="Clear" size="sm" onClick={() => tab && clear(tab.id)}>
                            <Trash2 />
                        </IconButton>
                    </>
                )}
            </div>

            <div className={styles.body}>
                <AnimatePresence initial={false}>
                    {res.persistedQuery && (
                        <motion.div
                            key="apq"
                            className={styles.apqWrap}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                        >
                            <PersistedQueryBar
                                query={res.persistedQuery}
                                pending={res.status === "loading"}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
                <AnimatePresence initial={false}>
                    {res.error && (
                        <motion.div
                            key="error"
                            className={styles.error}
                            initial={{ opacity: 0, y: -8, height: 0 }}
                            animate={{ opacity: 1, y: 0, height: "auto" }}
                            exit={{ opacity: 0, y: -8, height: 0 }}
                        >
                            <div className={styles.errorInner}>
                                <AlertTriangle />
                                <div>
                                    <div className={styles.errorTitle}>Request failed</div>
                                    <div className={styles.errorText}>{res.error}</div>
                                </div>
                                <button
                                    className={styles.errorCopy}
                                    onClick={() => {
                                        navigator.clipboard.writeText(res.error ?? "")
                                        toast({ title: "Copied", tone: "info" })
                                    }}
                                >
                                    copy
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {shown === "headers" ? (
                    <div className={styles.headers}>
                        {headers.map(([key, value]) => (
                            <div className={styles.headerRow} key={key}>
                                <span className={styles.headerKey}>{key}</span>
                                <span className={styles.headerValue}>{value}</span>
                            </div>
                        ))}
                    </div>
                ) : hasBody ? (
                    <div className={styles.editor}>
                        <CodeEditor value={res.body} language="json" readOnly />
                    </div>
                ) : (
                    <div className={styles.empty}>
                        <AnimatePresence mode="wait">
                            {res.status === "loading" ? (
                                <motion.div
                                    key="loading"
                                    className={styles.loading}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                >
                                    <span className={styles.orb} />
                                    <span>Waiting for the server…</span>
                                </motion.div>
                            ) : res.status === "streaming" ? (
                                <motion.div
                                    key="streaming"
                                    className={styles.loading}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                >
                                    <Radio className={styles.live} />
                                    <span>Subscribed — waiting for events…</span>
                                </motion.div>
                            ) : res.error ? null : (
                                <motion.div
                                    key="idle"
                                    className={styles.idle}
                                    initial={{ opacity: 0, scale: 0.96 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0 }}
                                >
                                    <div className={styles.idleIcon}>
                                        <Zap />
                                    </div>
                                    <div className={styles.idleTitle}>
                                        Hit Run to see the response
                                    </div>
                                    <div className={styles.idleText}>
                                        <Sparkles /> Highlighted JSON, timing and size show up here.
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                )}
            </div>
        </div>
    )
}

const OUTCOMES = {
    hit: {
        label: "Hit",
        tone: "success",
        title: "The server had this hash stored and ran the query from it: one request, no query text sent.",
    },
    registered: {
        label: "Registered",
        tone: "accent",
        title: "The server didn't know the hash (PersistedQueryNotFound), so the query text went in a second request and is now stored under it. Run as APQ again for a hit.",
    },
    unsupported: {
        label: "Not supported",
        tone: "danger",
        title: "The server has persisted queries switched off (PersistedQueryNotSupported).",
    },
    rejected: {
        label: "Rejected",
        tone: "danger",
        title: "The server answered with an error instead of running the query; the response says why. A server without APQ support usually asks for the query text.",
    },
} as const

/** Hash of the query sent as an Automatic Persisted Query, and what the server made of it. */
function PersistedQueryBar({ query, pending }: { query: PersistedQuery; pending: boolean }) {
    const [copied, setCopied] = useState(false)
    const outcome = query.outcome ? OUTCOMES[query.outcome] : null
    const copy = async () => {
        await navigator.clipboard.writeText(query.hash)
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
    }
    return (
        <div className={styles.apq}>
            <Fingerprint className={styles.apqIcon} />
            <span className={styles.apqLabel}>APQ</span>
            {outcome ? (
                <span
                    className={`${styles.apqOutcome} ${styles[outcome.tone]}`}
                    title={`${outcome.title}\n${query.requests} request${query.requests === 1 ? "" : "s"}`}
                >
                    {outcome.label}
                </span>
            ) : (
                pending && <span className={styles.apqOutcome}>Sending…</span>
            )}
            <span
                className={styles.apqHash}
                title={`SHA-256 of the query text as sent\n${query.hash}`}
            >
                <span className={styles.apqHashHead}>{query.hash.slice(0, -8)}</span>
                <span>{query.hash.slice(-8)}</span>
            </span>
            <IconButton label={copied ? "Copied" : "Copy hash"} size="sm" onClick={copy}>
                {copied ? <Check /> : <Copy />}
            </IconButton>
        </div>
    )
}

function transferTitle(res: ResponseState): string | undefined {
    const lines: string[] = []
    if (res.responseCompression) lines.push(`Response: ${describe(res.responseCompression)}`)
    if (res.requestCompression) lines.push(`Request: ${describe(res.requestCompression)}`)
    return lines.length ? lines.join("\n") : undefined
}

function describe({ encoding, size, encodedSize }: BodyCompression): string {
    const how =
        encoding === "compressed"
            ? "compressed (Content-Encoding not exposed by the server)"
            : encoding
    if (encodedSize == null) {
        return `${formatBytes(size)}, ${how}; size on the wire not exposed by the server`
    }
    const change = size > 0 ? Math.round((1 - encodedSize / size) * 100) : 0
    return `${formatBytes(size)} → ${formatBytes(encodedSize)} ${how} (${
        change >= 0 ? `${change}% smaller` : `${-change}% larger`
    })`
}
