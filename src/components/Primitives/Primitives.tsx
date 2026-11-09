import { Check, Minus } from "lucide-react"
import type { InputHTMLAttributes, ReactNode } from "react"

import type { OperationKind } from "@/shared/types"

import styles from "./Primitives.module.css"

export function KindBadge({ kind, compact }: { kind: OperationKind; compact?: boolean }) {
    const short = { query: "Q", mutation: "M", subscription: "S" }[kind]
    return (
        <span
            className={`${styles.kind} ${styles[kind]} ${compact ? styles.compact : ""}`}
            title={kind}
        >
            {compact ? short : kind}
        </span>
    )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
    return <input className={`${styles.input} ${className ?? ""}`} spellCheck={false} {...rest} />
}

export function Field({
    label,
    hint,
    group,
    children,
}: {
    label: string
    hint?: string
    /**
     * The control is a set of buttons (a segmented choice). A `<label>` would hand its name
     * and its clicks to the first button, so clicking the label or the hint would select it.
     */
    group?: boolean
    children: ReactNode
}) {
    const content = (
        <>
            <span className={styles.fieldLabel}>{label}</span>
            {children}
            {hint && <span className={styles.fieldHint}>{hint}</span>}
        </>
    )
    return group ? (
        <div className={styles.field} role="group" aria-label={label}>
            {content}
        </div>
    ) : (
        <label className={styles.field}>{content}</label>
    )
}

export function Kbd({ children }: { children: ReactNode }) {
    return <kbd className={styles.kbd}>{children}</kbd>
}

export function Switch({
    checked,
    onChange,
    label,
    disabled,
}: {
    checked: boolean
    onChange: (v: boolean) => void
    label?: string
    disabled?: boolean
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            title={label}
            disabled={disabled}
            className={`${styles.switch} ${checked ? styles.switchOn : ""}`}
            onClick={() => onChange(!checked)}
        >
            <span className={styles.knob} />
        </button>
    )
}

export function Checkbox({
    checked,
    onChange,
    label,
    disabled,
}: {
    checked: boolean | "mixed"
    onChange: (v: boolean) => void
    label?: string
    disabled?: boolean
}) {
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            aria-label={label}
            title={label}
            disabled={disabled}
            className={`${styles.checkbox} ${checked ? styles.checkboxOn : ""}`}
            onClick={e => {
                e.stopPropagation()
                onChange(checked !== true)
            }}
        >
            {checked === "mixed" ? <Minus /> : checked ? <Check /> : null}
        </button>
    )
}

export function EmptyState({
    icon,
    title,
    description,
    action,
}: {
    icon?: ReactNode
    title: string
    description?: ReactNode
    action?: ReactNode
}) {
    return (
        <div className={styles.empty}>
            {icon && <div className={styles.emptyIcon}>{icon}</div>}
            <div className={styles.emptyTitle}>{title}</div>
            {description && <div className={styles.emptyDescription}>{description}</div>}
            {action && <div className={styles.emptyAction}>{action}</div>}
        </div>
    )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
    return (
        <div className={styles.sectionTitle}>
            <span>{children}</span>
            {right}
        </div>
    )
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = isMac ? "⌘" : "Ctrl"
export const altKey = isMac ? "⌥" : "Alt"
