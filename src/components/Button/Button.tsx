import type { ButtonHTMLAttributes, ReactNode } from "react"

import styles from "./Button.module.css"

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "ghost" | "soft" | "danger"
    size?: "sm" | "md"
    icon?: ReactNode
    loading?: boolean
}

export function Button({
    variant = "soft",
    size = "md",
    icon,
    loading,
    children,
    className,
    ...rest
}: ButtonProps) {
    return (
        <button
            className={[
                styles.button,
                styles[variant],
                styles[size],
                loading ? styles.loading : "",
                className ?? "",
            ].join(" ")}
            disabled={rest.disabled || loading}
            {...rest}
        >
            {loading ? (
                <span className={styles.spinner} />
            ) : icon ? (
                <span className={styles.icon}>{icon}</span>
            ) : null}
            {children && <span className={styles.label}>{children}</span>}
        </button>
    )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    label: string
    active?: boolean
    size?: "sm" | "md"
    tone?: "default" | "danger"
}

export function IconButton({
    label,
    active,
    size = "md",
    tone = "default",
    children,
    className,
    ...rest
}: IconButtonProps) {
    return (
        <button
            aria-label={label}
            title={label}
            className={[
                styles.iconButton,
                styles[size],
                active ? styles.active : "",
                tone === "danger" ? styles.dangerTone : "",
                className ?? "",
            ].join(" ")}
            {...rest}
        >
            {children}
        </button>
    )
}
