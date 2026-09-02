import { useUnit } from "effector-react"
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"

import { $toasts, toastDismissed } from "@/models"

import styles from "./Toasts.module.css"

const icons = {
    info: <Info />,
    success: <CheckCircle2 />,
    error: <TriangleAlert />,
}

export function Toasts() {
    const [toasts, dismiss] = useUnit([$toasts, toastDismissed])
    return (
        <div className={styles.stack}>
            <AnimatePresence initial={false}>
                {toasts.map(t => (
                    <motion.div
                        key={t.id}
                        layout
                        className={`${styles.toast} ${styles[t.tone]}`}
                        initial={{ opacity: 0, y: 16, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 40, scale: 0.95 }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    >
                        <span className={styles.icon}>{icons[t.tone]}</span>
                        <div className={styles.content}>
                            <div className={styles.title}>{t.title}</div>
                            {t.description && (
                                <div className={styles.description}>{t.description}</div>
                            )}
                        </div>
                        <button
                            className={styles.close}
                            onClick={() => dismiss(t.id)}
                            aria-label="Dismiss"
                        >
                            <X />
                        </button>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    )
}
