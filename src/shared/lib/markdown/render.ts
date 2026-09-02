/**
 * Minimal, safe Markdown → DOM renderer for schema descriptions (GraphQL descriptions are
 * CommonMark). Builds nodes directly — never innerHTML — so untrusted text from a remote
 * schema cannot inject markup. Supports: paragraphs, headings, fenced/indented code, inline
 * code, bold/italic/strikethrough, links (http/https/mailto only), lists, blockquotes, rules.
 */

const SAFE_HREF = /^(https?:|mailto:)/i

function el(tag: string, cls?: string) {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    return node
}

// --- inline ------------------------------------------------------------------

const INLINE =
    /(`+)([\s\S]*?[^`])\1(?!`)|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|(?<![\w*])\*([^*\n]+?)\*(?![\w*])|(?<![\w_])_([^_\n]+?)_(?![\w_])|\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g

/** Append `text` to `into` with inline markdown rendered. */
export function renderInline(into: Node, text: string) {
    let last = 0
    for (const m of text.matchAll(INLINE)) {
        const idx = m.index ?? 0
        if (idx > last) into.appendChild(document.createTextNode(text.slice(last, idx)))
        last = idx + m[0].length
        const [, , code, bold, bold2, strike, em, em2, linkText, href, autolink, bare] = m
        if (code !== undefined) {
            const c = el("code")
            c.textContent = code.trim()
            into.appendChild(c)
        } else if (bold !== undefined || bold2 !== undefined) {
            const b = el("strong")
            renderInline(b, (bold ?? bold2)!)
            into.appendChild(b)
        } else if (strike !== undefined) {
            const s = el("del")
            renderInline(s, strike)
            into.appendChild(s)
        } else if (em !== undefined || em2 !== undefined) {
            const i = el("em")
            renderInline(i, (em ?? em2)!)
            into.appendChild(i)
        } else if (linkText !== undefined) {
            into.appendChild(link(href!, linkText))
        } else if (autolink !== undefined || bare !== undefined) {
            const url = (autolink ?? bare)!
            into.appendChild(link(url, url, true))
        }
    }
    if (last < text.length) into.appendChild(document.createTextNode(text.slice(last)))
}

/** `plain` keeps the label as text — autolink labels are URLs and would match again forever. */
function link(href: string, text: string, plain = false): Node {
    const safe = SAFE_HREF.test(href)
    const node = safe ? (el("a") as HTMLAnchorElement) : el("span")
    if (safe) {
        const a = node as HTMLAnchorElement
        a.href = href
        a.target = "_blank"
        a.rel = "noopener noreferrer"
    }
    if (plain) node.appendChild(document.createTextNode(text))
    else renderInline(node, text)
    return node
}

// --- blocks ------------------------------------------------------------------

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*(\S*)/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const UL = /^(\s*)[-*+]\s+(.*)$/
const OL = /^(\s*)\d{1,9}[.)]\s+(.*)$/

/** Render a markdown document into `into` (appends block elements). */
export function renderMarkdown(into: Node, source: string) {
    const lines = source.replace(/\r\n?/g, "\n").split("\n")
    let i = 0
    const para: string[] = []
    const flushPara = () => {
        if (!para.length) return
        const p = el("p")
        renderInline(p, para.join(" ").trim())
        into.appendChild(p)
        para.length = 0
    }

    while (i < lines.length) {
        const line = lines[i]!

        if (!line.trim()) {
            flushPara()
            i++
            continue
        }

        const fence = FENCE.exec(line)
        if (fence) {
            flushPara()
            const marker = fence[1]!
            const body: string[] = []
            i++
            while (i < lines.length && !lines[i]!.trim().startsWith(marker)) body.push(lines[i++]!)
            i++ // closing fence (or EOF)
            const pre = el("pre")
            const code = el("code")
            if (fence[2]) code.dataset.lang = fence[2]
            code.textContent = body.join("\n")
            pre.appendChild(code)
            into.appendChild(pre)
            continue
        }

        const heading = HEADING.exec(line)
        if (heading) {
            flushPara()
            const h = el(`h${heading[1]!.length}`)
            renderInline(h, heading[2]!)
            into.appendChild(h)
            i++
            continue
        }

        if (RULE.test(line)) {
            flushPara()
            into.appendChild(el("hr"))
            i++
            continue
        }

        if (QUOTE.test(line)) {
            flushPara()
            const body: string[] = []
            while (i < lines.length && QUOTE.test(lines[i]!))
                body.push(QUOTE.exec(lines[i++]!)![1]!)
            const q = el("blockquote")
            renderMarkdown(q, body.join("\n"))
            into.appendChild(q)
            continue
        }

        const listMatch = (l: string) => UL.exec(l) ?? OL.exec(l)
        const first = listMatch(line)
        if (first && !para.length) {
            const ordered = OL.test(line)
            const list = el(ordered ? "ol" : "ul")
            const indent = first[1]!.length
            const isSibling = (l: string | undefined) => {
                const m = l ? listMatch(l) : null
                return !!m && m[1]!.length === indent && OL.test(l!) === ordered
            }
            while (i < lines.length && isSibling(lines[i])) {
                const text = [listMatch(lines[i]!)![2]!]
                const nested: string[] = []
                i++
                // Deeper-indented lines belong to this item: plain text continues it, anything after a
                // nested list (or the list itself) is rendered as nested blocks.
                while (i < lines.length && lines[i]!.trim()) {
                    const l = lines[i]!
                    const lm = listMatch(l)
                    const lineIndent = /^\s*/.exec(l)![0].length
                    if ((lm ? lm[1]!.length : lineIndent) <= indent) break
                    if (lm || nested.length) nested.push(l.slice(Math.min(indent + 2, lineIndent)))
                    else text.push(l.trim())
                    i++
                }
                const item = el("li")
                renderInline(item, text.join(" "))
                if (nested.length) renderMarkdown(item, nested.join("\n"))
                list.appendChild(item)
                // A single blank line between items keeps the list going.
                if (i < lines.length && !lines[i]!.trim() && isSibling(lines[i + 1])) i++
            }
            into.appendChild(list)
            continue
        }

        // Indented code block (4 spaces / tab) outside a paragraph.
        if (/^(\s{4}|\t)/.test(line) && !para.length) {
            const body: string[] = []
            while (i < lines.length && (/^(\s{4}|\t)/.test(lines[i]!) || !lines[i]!.trim()))
                body.push(lines[i++]!.replace(/^(\s{4}|\t)/, ""))
            while (body.length && !body[body.length - 1]!.trim()) body.pop()
            const pre = el("pre")
            const code = el("code")
            code.textContent = body.join("\n")
            pre.appendChild(code)
            into.appendChild(pre)
            continue
        }

        para.push(line.trim())
        i++
    }
    flushPara()
}

/** Convenience: render into a fresh element. */
export function markdownElement(source: string, cls?: string): HTMLElement {
    const root = el("div", cls)
    renderMarkdown(root, source)
    return root
}

const BLOCK_MARKERS = /^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d{1,9}[.)]\s+)/
const stripFences = (s: string) => s.replace(/(`{3,}|~{3,})[\s\S]*?(\1|$)/g, "")

/** Inline-only rendering: block markers dropped, lines joined — for clamped rows and labels. */
export function renderInlineOnly(into: Node, source: string) {
    const text = stripFences(source)
        .split("\n")
        .map(l => l.replace(BLOCK_MARKERS, "").trim())
        .filter(Boolean)
        .join(" ")
    renderInline(into, text)
}

/** Strip inline markdown syntax from a single line. */
function stripInline(line: string): string {
    return line
        .replace(BLOCK_MARKERS, "")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~/g, "$1$2$3")
        .replace(/(?<![\w*])\*([^*\n]+?)\*(?![\w*])|(?<![\w_])_([^_\n]+?)_(?![\w_])/g, "$1$2")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .trim()
}

/** First line of a description with markdown syntax stripped — for one-line previews. */
export function markdownSummary(source: string): string {
    const line =
        stripFences(source)
            .split("\n")
            .find(l => l.trim()) ?? ""
    return stripInline(line)
}

/** Whole description as plain text (e.g. for `title` attributes). */
export function markdownPlain(source: string): string {
    return stripFences(source).split("\n").map(stripInline).filter(Boolean).join("\n")
}
