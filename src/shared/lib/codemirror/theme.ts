import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
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
    ".cm-content": { fontFamily: "var(--font-mono)" },
})

export const themeExtension = [editorTheme, syntaxHighlighting(highlightStyle)]

/** JSON viewer: keys get their own color so they stand apart from string values. */
export const jsonHighlightStyle = HighlightStyle.define([
    { tag: t.propertyName, color: v("key") },
    { tag: t.string, color: v("string") },
    { tag: t.number, color: v("number") },
    { tag: [t.bool, t.null], color: v("bool") },
    { tag: [t.punctuation, t.brace, t.squareBracket, t.separator], color: v("punct") },
])
