import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete"
import { syntaxTree } from "@codemirror/language"
import type { ChangeSpec, EditorState, TransactionSpec } from "@codemirror/state"
import { getOpts, getSchema, graphqlLanguage, offsetToPos } from "cm6-graphql"
import { type GraphQLSchema, getNamedType } from "graphql"
import {
    type CompletionItem,
    CompletionItemKind,
    type State,
    getAutocompleteSuggestions,
    getTokenAtPosition,
    getTypeInfo,
    getVariableCompletions,
} from "graphql-language-service"

import { markdownElement } from "@/shared/lib/markdown"

// @lezer/common isn't a direct dependency; borrow the node type from the tree.
type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"]

/**
 * Replacement for cm6-graphql's completion source. Same schema-driven suggestions, plus
 * proper `$variable` completion: `$` opens the list, the `$` is part of the replaced range
 * (no `$$id`), variables of the argument's type are ranked first, and the variable's type is shown.
 */

const TRIGGER = /^[a-zA-Z0-9_@(]$/

function kindToType(kind: CompletionItem["kind"]): string | undefined {
    switch (kind) {
        case CompletionItemKind.Variable:
            return "variable"
        case CompletionItemKind.EnumMember:
            return "enum"
        case CompletionItemKind.Interface:
        case CompletionItemKind.Constructor:
            return "type"
        case CompletionItemKind.Field:
        case CompletionItemKind.Function:
            return "property"
        default:
            return undefined
    }
}

function doc(item: Pick<CompletionItem, "documentation" | "isDeprecated" | "deprecationReason">) {
    const text = item.documentation || (item.isDeprecated ? item.deprecationReason : "") || ""
    if (!text) return undefined
    return () => markdownElement(text, "md cm-completion-doc")
}

function inVariableDefinition(state: State): boolean {
    for (let s: State | null | undefined = state; s; s = s.prevState)
        if (s.kind === "VariableDefinition") return true
    return false
}

function variableCompletions(
    ctx: CompletionContext,
    schema: GraphQLSchema,
    query: string,
    from: number,
): CompletionResult | null {
    // Resolve the token at the `$` itself: there the parser state is Variable inside the argument,
    // so the expected input type is known; after the name (or at a following `)`) it isn't.
    const token = getTokenAtPosition(query, offsetToPos(ctx.state.doc, from))
    // `query ($id: …)` declares a variable — nothing to suggest for its name.
    if (inVariableDefinition(token.state)) return null

    const info = getTypeInfo(schema, token.state)
    const expected = getNamedType(info.inputType ?? undefined)?.name
    const vars = getVariableCompletions(query, schema, token)
    const options: Completion[] = vars.map(v => ({
        label: v.label,
        detail: v.detail,
        type: "variable",
        boost: v.detail === expected ? 1 : 0,
    }))

    // No declared variable of the argument's type yet → offer `$argName` and declare it in the operation.
    const arg = info.argDef
    if (arg && info.inputType && !vars.some(v => v.label === `$${arg.name}`)) {
        const typeStr = String(info.inputType)
        options.push({
            label: `$${arg.name}`,
            detail: `declare ${typeStr}`,
            type: "variable",
            boost: -1,
            apply: (view, _c, f, t) =>
                view.dispatch(declareVariable(view.state, f, t, arg.name, typeStr)),
        })
    }
    if (!options.length) return null
    return { from, validFor: /^\$\w*$/, options }
}

/** Insert `$name` at [from, to] and add `$name: Type` to the enclosing operation's variable definitions. */
function declareVariable(
    state: EditorState,
    from: number,
    to: number,
    name: string,
    type: string,
): TransactionSpec {
    const changes: ChangeSpec[] = [{ from, to, insert: `$${name}` }]
    let op: SyntaxNode | null = syntaxTree(state).resolveInner(from, -1)
    while (op && op.name !== "OperationDefinition") op = op.parent
    if (op) {
        const defs = op.getChild("VariableDefinitions")
        const nameNode = op.getChild("Name")
        const typeNode = op.getChild("OperationType")
        const close = defs ? state.sliceDoc(defs.from, defs.to).lastIndexOf(")") : -1
        if (defs && close > 0) {
            // `($a: ID!)` → `($a: ID!, $name: Type)`; node bounds are unreliable for a broken `()`, so find the paren
            const inner = state.sliceDoc(defs.from + 1, defs.from + close).trimEnd()
            // Append right after the last definition so multi-line lists keep their closing `)` on its own line.
            changes.push({
                from: defs.from + 1 + inner.length,
                insert: `${inner.trim() ? ", " : ""}$${name}: ${type}`,
            })
        } else if (nameNode) {
            changes.push({ from: nameNode.to, insert: `($${name}: ${type})` })
        } else if (typeNode) {
            changes.push({ from: typeNode.to, insert: ` ($${name}: ${type})` })
        } else {
            // shorthand `{ … }` cannot carry variables — turn it into `query (…) { … }`
            changes.push({ from: op.from, insert: `query ($${name}: ${type}) ` })
        }
    }
    // The declaration is inserted before the cursor, so map the position through the change set.
    const set = state.changes(changes)
    return { changes: set, selection: { anchor: set.mapPos(to, 1) }, userEvent: "input.complete" }
}

function schemaCompletions(
    ctx: CompletionContext,
    schema: GraphQLSchema,
    query: string,
): CompletionResult | null {
    const word = ctx.matchBefore(/\w*/)
    if (!word) return null
    const last = word.text.at(-1)
    if ((!last || !TRIGGER.test(last)) && !ctx.explicit) return null

    const items = getAutocompleteSuggestions(
        schema,
        query,
        offsetToPos(ctx.state.doc, ctx.pos),
        undefined,
        undefined,
        getOpts(ctx.state)?.autocompleteOptions,
    )
    if (!items.length) return null
    return {
        from: word.from,
        options: items.map(item => ({
            label: item.label,
            detail: item.detail || "",
            type: kindToType(item.kind),
            info: doc(item),
        })),
    }
}

export const graphqlCompletion = graphqlLanguage.data.of({
    autocomplete(ctx: CompletionContext): CompletionResult | null {
        const schema = getSchema(ctx.state)
        if (!schema) return null
        const query = ctx.state.doc.toString()
        const dollar = ctx.matchBefore(/\$\w*/)
        return dollar
            ? variableCompletions(ctx, schema, query, dollar.from)
            : schemaCompletions(ctx, schema, query)
    },
})
