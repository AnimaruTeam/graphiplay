import { Check, ChevronRight } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { useRoot } from "@/app/root"

import styles from "./ContextMenu.module.css"

export interface MenuItem {
    id: string
    label: ReactNode
    icon?: ReactNode
    /** Small hint on the right (shortcut, count…). */
    hint?: ReactNode
    danger?: boolean
    disabled?: boolean
    checked?: boolean
    onSelect?: () => void
    /** Nested items open a submenu on hover. */
    children?: MenuEntry[]
}
export type MenuEntry = MenuItem | "separator"

export interface MenuPosition {
    x: number
    y: number
}

interface ContextMenuProps {
    open: boolean
    position: MenuPosition
    items: MenuEntry[]
    onClose: () => void
}

const MARGIN = 8

/** Keep a fixed-position box inside the viewport. */
function clamp(x: number, y: number, w: number, h: number) {
    const vw = window.innerWidth
    const vh = window.innerHeight
    return {
        left: Math.max(MARGIN, Math.min(x, vw - w - MARGIN)),
        top: Math.max(MARGIN, Math.min(y, vh - h - MARGIN)),
    }
}

export function ContextMenu({ open, position, items, onClose }: ContextMenuProps) {
    const root = useRoot()
    useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose()
        }
        // pointerdown, not mousedown: after a touch long-press the finger is still down when the
        // menu opens, and the compat mouse events fired on release would close it right away.
        const onDown = (e: PointerEvent) => {
            if (!(e.target as HTMLElement).closest(`.${styles.menu}`)) onClose()
        }
        window.addEventListener("keydown", onKey)
        window.addEventListener("pointerdown", onDown)
        window.addEventListener("resize", onClose)
        window.addEventListener("scroll", onClose, true)
        return () => {
            window.removeEventListener("keydown", onKey)
            window.removeEventListener("pointerdown", onDown)
            window.removeEventListener("resize", onClose)
            window.removeEventListener("scroll", onClose, true)
        }
    }, [open, onClose])

    return createPortal(
        <AnimatePresence>
            {open && (
                <MenuPanel
                    key="root"
                    items={items}
                    x={position.x}
                    y={position.y}
                    onClose={onClose}
                />
            )}
        </AnimatePresence>,
        // Into the playground root so theme variables and scoped styles still apply.
        root ?? document.body,
    )
}

interface MenuPanelProps {
    items: MenuEntry[]
    x: number
    y: number
    onClose: () => void
    /** Submenus open to the side of their parent row instead of at a point. */
    anchor?: DOMRect
}

function MenuPanel({ items, x, y, onClose, anchor }: MenuPanelProps) {
    const ref = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
    const [openSub, setOpenSub] = useState<string | null>(null)
    const [subAnchor, setSubAnchor] = useState<DOMRect | null>(null)
    const hoverTimer = useRef<number | null>(null)
    // Reserve the check column only in panels that actually have checkable rows.
    const hasChecks = items.some(e => e !== "separator" && e.checked !== undefined)

    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        const { width, height } = el.getBoundingClientRect()
        if (anchor) {
            // Prefer the right side of the parent row; flip left when it would overflow.
            const right = anchor.right + 2
            const left =
                right + width > window.innerWidth - MARGIN ? anchor.left - width - 2 : right
            setPos(clamp(left, anchor.top - 6, width, height))
        } else {
            setPos(clamp(x, y, width, height))
        }
    }, [x, y, anchor, items.length])

    const scheduleSub = (item: MenuItem | null, el?: HTMLElement) => {
        if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
        hoverTimer.current = window.setTimeout(
            () => {
                setOpenSub(item?.id ?? null)
                setSubAnchor(el ? el.getBoundingClientRect() : null)
            },
            item ? 120 : 200,
        )
    }

    return (
        <motion.div
            ref={ref}
            role="menu"
            className={styles.menu}
            style={{
                left: pos?.left ?? x,
                top: pos?.top ?? y,
                visibility: pos ? "visible" : "hidden",
            }}
            initial={{ opacity: 0, scale: 0.97, y: -2 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.12, ease: [0.2, 0.8, 0.2, 1] }}
        >
            {items.map((entry, i) => {
                if (entry === "separator")
                    return <div key={`sep-${i}`} className={styles.separator} role="separator" />
                const hasChildren = !!entry.children?.length
                const isSubOpen = openSub === entry.id
                return (
                    <div key={entry.id} className={styles.itemWrap}>
                        <button
                            role="menuitem"
                            className={[
                                styles.item,
                                entry.danger ? styles.danger : "",
                                isSubOpen ? styles.itemOpen : "",
                            ].join(" ")}
                            disabled={entry.disabled}
                            onMouseEnter={e =>
                                scheduleSub(hasChildren ? entry : null, e.currentTarget)
                            }
                            onClick={e => {
                                if (hasChildren) {
                                    setOpenSub(entry.id)
                                    setSubAnchor(e.currentTarget.getBoundingClientRect())
                                    return
                                }
                                entry.onSelect?.()
                                onClose()
                            }}
                        >
                            {hasChecks && (
                                <span className={styles.check}>{entry.checked && <Check />}</span>
                            )}
                            <span className={styles.icon}>{entry.icon}</span>
                            <span className={styles.label}>{entry.label}</span>
                            {entry.hint && <span className={styles.hint}>{entry.hint}</span>}
                            {hasChildren && <ChevronRight className={styles.chevron} />}
                        </button>
                        <AnimatePresence>
                            {hasChildren && isSubOpen && subAnchor && (
                                <MenuPanel
                                    key={`sub-${entry.id}`}
                                    items={entry.children!}
                                    x={0}
                                    y={0}
                                    anchor={subAnchor}
                                    onClose={onClose}
                                />
                            )}
                        </AnimatePresence>
                    </div>
                )
            })}
        </motion.div>
    )
}
