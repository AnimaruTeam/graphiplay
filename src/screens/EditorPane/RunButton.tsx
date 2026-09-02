import { useUnit } from "effector-react"
import { Play, Square } from "lucide-react"
import { motion } from "motion/react"
import { useMemo } from "react"

import { Button, Kbd, modKey } from "@/components"
import { $activeTab, $cursorOperation, $running, runRequested, stopRequested } from "@/models"
import { parseOperations } from "@/shared/lib/graphql"
import type { Tab } from "@/shared/types"

import styles from "./EditorPane.module.css"

/** Operation that runs for this tab: in multi-operation documents, the one under the cursor. */
export function useRunTarget(tab: Tab | null) {
    const cursorOp = useUnit($cursorOperation)
    const ops = useMemo(() => (tab ? parseOperations(tab.query) : []), [tab?.query])
    const namedOps = ops.filter(o => o.name)
    const multi = namedOps.length > 1
    const selectedOp = multi
        ? namedOps.some(o => o.name === cursorOp?.name)
            ? cursorOp!.name
            : namedOps[0]!.name
        : null
    const kind = ops.find(o => (selectedOp ? o.name === selectedOp : true))?.kind ?? ops[0]?.kind
    return { ops, namedOps, multi, selectedOp, kind }
}

/** Run / Stop for the active tab. Lives in the editor toolbar on desktop, in the view switcher on phones. */
export function RunButton({ hint = true }: { hint?: boolean }) {
    const [tab, running, run, stop] = useUnit([$activeTab, $running, runRequested, stopRequested])
    const { selectedOp, kind } = useRunTarget(tab)
    if (!tab) return null
    const isRunning = !!running[tab.id]

    return (
        <motion.div whileTap={{ scale: 0.96 }} className={styles.runWrap}>
            <Button
                variant={isRunning ? "danger" : "primary"}
                icon={isRunning ? <Square /> : <Play />}
                onClick={() =>
                    isRunning ? stop(tab.id) : run({ tabId: tab.id, operationName: selectedOp })
                }
                className={styles.run}
            >
                {isRunning ? "Stop" : kind === "subscription" ? "Subscribe" : "Run"}
            </Button>
            {hint && !isRunning && (
                <span className={styles.runHint}>
                    <Kbd>{modKey}</Kbd>
                    <Kbd>↵</Kbd>
                </span>
            )}
        </motion.div>
    )
}
