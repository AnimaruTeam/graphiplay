import { HighlightStyle, foldGutter, syntaxHighlighting } from "@codemirror/language"
import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { tags as t } from "@lezer/highlight"

// Colors resolve to CSS variables so the editor follows the app theme without a rebuild.
const v = (name: string) => `var(--syn-${name})`

// Tag mapping follows cm6-graphql styleTags: Name→atom, FieldName→propertyName,
// ArgumentAttributeName→attributeName, EnumValue→special(name), DirectiveName→modifier.
export const highlightStyle = HighlightStyle.define([
    {
        tag: [t.keyword, t.definitionKeyword, t.controlKeyword],
        color: v("keyword"),
        fontWeight: "500",
    },
    { tag: t.modifier, color: v("directive") },
    { tag: [t.typeName, t.className, t.namespace, t.atom], color: v("type") },
    {
        tag: [t.variableName, t.definition(t.variableName), t.special(t.variableName)],
        color: v("variable"),
    },
    { tag: [t.propertyName, t.definition(t.propertyName), t.labelName], color: v("field") },
    { tag: t.attributeName, color: v("arg") },
    { tag: t.special(t.name), color: v("enum") },
    { tag: [t.string, t.special(t.string)], color: v("string") },
    { tag: [t.number, t.integer, t.float], color: v("number") },
    { tag: [t.bool, t.null], color: v("bool") },
    {
        tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
        color: v("comment"),
        fontStyle: "italic",
    },
    {
        tag: [t.punctuation, t.bracket, t.paren, t.brace, t.squareBracket, t.separator],
        color: v("punct"),
    },
    { tag: [t.operator, t.definitionOperator], color: v("punct") },
    { tag: t.invalid, color: "var(--danger)", textDecoration: "underline wavy" },
    { tag: t.heading, color: v("type"), fontWeight: "bold" },
    { tag: t.name, color: v("field") },
])

export const editorTheme = EditorView.theme({
    "&": { color: "var(--text)", backgroundColor: "transparent", height: "100%" },
    // Ligatures off: JetBrains Mono turns `://` and `//` inside strings into what looks like
    // a missing slash, and GraphQL/JSON have no operators that gain from them.
    ".cm-content": { fontFamily: "var(--font-mono)", fontVariantLigatures: "none" },
})

export const themeExtension = [editorTheme, syntaxHighlighting(highlightStyle)]

// --- fold gutter ---------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg"

/**
 * The gutter's default markers are the characters `⌄` and `›`, so their shape, weight and
 * baseline are whatever the mono font happens to give — ragged next to the line numbers.
 * These are lucide's chevron-down / chevron-right, drawn as SVG at a fixed size instead.
 */
function foldMarker(open: boolean): HTMLElement {
    const svg = document.createElementNS(SVG_NS, "svg")
    svg.setAttribute("viewBox", "0 0 24 24")
    svg.setAttribute("fill", "none")
    svg.setAttribute("stroke", "currentColor")
    svg.setAttribute("stroke-width", "2.5")
    svg.setAttribute("stroke-linecap", "round")
    svg.setAttribute("stroke-linejoin", "round")
    const path = document.createElementNS(SVG_NS, "path")
    path.setAttribute("d", open ? "m6 9 6 6 6-6" : "m9 18 6-6-6-6")
    svg.append(path)
    // markerDOM must return an HTMLElement, and the wrapper is what gets centred in the gutter.
    const wrap = document.createElement("span")
    wrap.className = "cm-foldMarker"
    wrap.title = open ? "Fold" : "Unfold"
    wrap.append(svg)
    return wrap
}

export const foldGutterIcons: Extension = foldGutter({ markerDOM: foldMarker })

/** JSON viewer: keys get their own color so they stand apart from string values. */
export const jsonHighlightStyle = HighlightStyle.define([
    { tag: t.propertyName, color: v("key") },
    { tag: t.string, color: v("string") },
    { tag: t.number, color: v("number") },
    { tag: [t.bool, t.null], color: v("bool") },
    { tag: [t.punctuation, t.brace, t.squareBracket, t.separator], color: v("punct") },
])
