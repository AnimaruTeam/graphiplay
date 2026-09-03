import { syntaxTree } from "@codemirror/language"
import { type Extension, RangeSetBuilder } from "@codemirror/state"
import {
    Decoration,
    type DecorationSet,
    EditorView,
    ViewPlugin,
    type ViewUpdate,
} from "@codemirror/view"
import { getSchema } from "cm6-graphql"

import { typeGroup } from "@/shared/lib/graphql"

/**
 * Colour passes the lezer tags can't express on their own:
 *  - `query` / `mutation` / `subscription` / `fragment` share one keyword tag, so each
 *    operation kind is marked separately;
 *  - a type name's colour depends on what the schema says it is (scalar, object, input).
 */

const mark = (cls: string) => Decoration.mark({ class: cls })

const KEYWORD: Record<string, Decoration | undefined> = {
    query: mark("cm-gql-kw-query"),
    mutation: mark("cm-gql-kw-mutation"),
    subscription: mark("cm-gql-kw-subscription"),
}

const FRAGMENT = mark("cm-gql-kw-fragment")

const TYPE = {
    scalar: mark("cm-gql-t-scalar"),
    object: mark("cm-gql-t-object"),
    input: mark("cm-gql-t-input"),
} as const

/**
 * SDL declares the kind in the source (`type X`, `input Y`), so the name a definition
 * introduces is coloured from the grammar — no schema needed. `TypeExtension` variants
 * of the same nodes are matched by prefix.
 */
const DEFINITION_GROUP: Record<string, keyof typeof TYPE | undefined> = {
    Scalar: "scalar",
    Object: "object",
    Interface: "object",
    Union: "object",
    Enum: "input",
    InputObject: "input",
}

function definedTypeGroup(parent: string | undefined): keyof typeof TYPE | undefined {
    const m = parent?.match(/^(\w+?)Type(Definition|Extension)$/)
    return m ? DEFINITION_GROUP[m[1]!] : undefined
}

function build(view: EditorView): DecorationSet {
    const schema = getSchema(view.state)
    const builder = new RangeSetBuilder<Decoration>()
    const tree = syntaxTree(view.state)
    for (const { from, to } of view.visibleRanges) {
        tree.iterate({
            from,
            to,
            enter: node => {
                if (node.name === "OperationType") {
                    const deco = KEYWORD[view.state.sliceDoc(node.from, node.to)]
                    if (deco) builder.add(node.from, node.to, deco)
                    return false
                }
                // `FragmentKeyword` wraps the `fragment` token; decorate the outer node only.
                if (node.name === "FragmentKeyword" || node.name === "fragment") {
                    builder.add(node.from, node.to, FRAGMENT)
                    return false
                }
                if (node.name === "NamedType") {
                    const type = schema?.getType(view.state.sliceDoc(node.from, node.to))
                    if (type) builder.add(node.from, node.to, TYPE[typeGroup(type)])
                    return false
                }
                if (node.name === "Name") {
                    const group = definedTypeGroup(node.node.parent?.name)
                    if (group) builder.add(node.from, node.to, TYPE[group])
                    return false
                }
                return undefined
            },
        })
    }
    return builder.finish()
}

// The syntax-highlight mark for the same token may render as a nested span, so each rule
// also targets the spans inside it — otherwise the tag colour would win over ours.
const theme = EditorView.baseTheme({
    ".cm-gql-kw-query, .cm-gql-kw-query span": { color: "var(--query)" },
    ".cm-gql-kw-mutation, .cm-gql-kw-mutation span": { color: "var(--mutation)" },
    ".cm-gql-kw-subscription, .cm-gql-kw-subscription span": { color: "var(--subscription)" },
    ".cm-gql-kw-fragment, .cm-gql-kw-fragment span": { color: "var(--syn-fragment)" },
    ".cm-gql-t-scalar, .cm-gql-t-scalar span": { color: "var(--syn-type-scalar)" },
    ".cm-gql-t-object, .cm-gql-t-object span": { color: "var(--syn-type-object)" },
    ".cm-gql-t-input, .cm-gql-t-input span": { color: "var(--syn-type-input)" },
})

const plugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet
        constructor(view: EditorView) {
            this.decorations = build(view)
        }
        update(u: ViewUpdate) {
            if (
                u.docChanged ||
                u.viewportChanged ||
                syntaxTree(u.startState) !== syntaxTree(u.state) ||
                getSchema(u.startState) !== getSchema(u.state)
            )
                this.decorations = build(u.view)
        }
    },
    { decorations: v => v.decorations },
)

export const graphqlDecorations: Extension = [plugin, theme]
