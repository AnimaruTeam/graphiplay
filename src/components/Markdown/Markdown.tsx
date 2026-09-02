import { type ElementType, useLayoutEffect, useRef } from "react"

import { renderInlineOnly, renderMarkdown } from "@/shared/lib/markdown"

interface MarkdownProps {
    source: string
    /** `inline` drops block structure (headings, lists, code blocks) so the text can be line-clamped. */
    mode?: "block" | "inline"
    as?: ElementType
    className?: string
}

/**
 * Schema description rendered as Markdown. The renderer builds DOM nodes itself (no HTML
 * strings), so the output is safe for descriptions coming from a remote schema.
 * Global `.md` styles apply in block mode.
 */
export function Markdown({ source, mode = "block", as: Tag = "div", className }: MarkdownProps) {
    const ref = useRef<HTMLElement>(null)

    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        el.replaceChildren()
        if (mode === "inline") renderInlineOnly(el, source)
        else renderMarkdown(el, source)
    }, [source, mode])

    const cls = [mode === "block" ? "md" : "", className].filter(Boolean).join(" ")
    return <Tag ref={ref} className={cls || undefined} />
}
