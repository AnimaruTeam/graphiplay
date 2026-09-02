import { useUnit } from "effector-react"
import { AlertTriangle, Check, Copy, Radio, Sparkles, Trash2, Zap } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"

import { CodeEditor, IconButton } from "@/components"
import { $activeResponse, $activeTab, responseCleared, toastShown } from "@/models"
import { formatBytes, formatMs } from "@/shared/lib/graphql"

import styles from "./ResponsePane.module.css"

export function ResponsePane() {
    const [res, tab, clear, toast] = useUnit([
        $activeResponse,
        $activeTab,
        responseCleared,
        toastShown,
    ])
    const [copied, setCopied] = useState(false)

    const copy = async () => {
        await navigator.clipboard.writeText(res.body)
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
                            {res.size != null && (
                                <span className={styles.stat}>
                                    {res.events
                                        ? `${res.size} event${res.size === 1 ? "" : "s"}`
                                        : formatBytes(res.size)}
                                </span>
                            )}
                            {res.status === "streaming" && res.events && (
                                <span className={styles.stat}>
                                    {res.events.length} event{res.events.length === 1 ? "" : "s"}
                                </span>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
                <div className={styles.spacer} />
                {hasBody && (
                    <>
                        <IconButton
                            label={copied ? "Copied" : "Copy response"}
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

                {hasBody ? (
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
