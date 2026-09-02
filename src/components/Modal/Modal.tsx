import { X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { type ReactNode, useEffect } from "react"

import { IconButton } from "@/components"
import { useIsMobile } from "@/shared/lib/hooks"

import styles from "./Modal.module.css"

interface ModalProps {
    open: boolean
    title?: ReactNode
    description?: ReactNode
    onClose: () => void
    children?: ReactNode
    footer?: ReactNode
    width?: number
}

export function Modal({
    open,
    title,
    description,
    onClose,
    children,
    footer,
    width = 460,
}: ModalProps) {
    const isMobile = useIsMobile()
    useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [open, onClose])

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className={styles.backdrop}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    onMouseDown={e => {
                        if (e.target === e.currentTarget) onClose()
                    }}
                >
                    <motion.div
                        className={styles.dialog}
                        style={isMobile ? undefined : { width }}
                        role="dialog"
                        aria-modal
                        initial={isMobile ? { y: "100%" } : { opacity: 0, y: 18, scale: 0.96 }}
                        animate={isMobile ? { y: 0 } : { opacity: 1, y: 0, scale: 1 }}
                        exit={isMobile ? { y: "100%" } : { opacity: 0, y: 10, scale: 0.97 }}
                        transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.8 }}
                    >
                        {(title || description) && (
                            <div className={styles.header}>
                                <div>
                                    {title && <h2 className={styles.title}>{title}</h2>}
                                    {description && (
                                        <p className={styles.description}>{description}</p>
                                    )}
                                </div>
                                <IconButton label="Close" onClick={onClose} size="sm">
                                    <X />
                                </IconButton>
                            </div>
                        )}
                        <div className={styles.body}>{children}</div>
                        {footer && <div className={styles.footer}>{footer}</div>}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
