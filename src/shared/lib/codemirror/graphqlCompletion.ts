import {
    type Completion,
    type CompletionContext,
    type CompletionResult,
    completionStatus,
    currentCompletions,
    pickedCompletion,
    setSelectedCompletion,
    startCompletion,
} from "@codemirror/autocomplete"
import { insertNewlineAndIndent } from "@codemirror/commands"
import { syntaxTree } from "@codemirror/language"
import {
    type ChangeSpec,
    EditorState,
    type Extension,
    Prec,
    StateEffect,
    StateField,
    type TransactionSpec,
} from "@codemirror/state"
import { keymap } from "@codemirror/view"
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

const TRIGGER = /^[a-zA-Z0-9_@]$/
/**
 * Punctuation that opens a spot where an argument can be written: the `(` of an argument
 * list and the `,` between arguments. The list pops up there without waiting for a letter.
 * A selection set's `{` is deliberately not here — see `completeOnNewline`.
 */
const OPENING = /[(,]\s*$/

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
    const opening = !last && OPENING.test(ctx.state.sliceDoc(Math.max(0, ctx.pos - 40), ctx.pos))
    if (!ctx.explicit && !opening && (!last || !TRIGGER.test(last))) return null

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

// --- Newline inside a selection set ------------------------------------------------

/** Nodes that mean the cursor is in a value / argument slot, not where a field goes. */
const NOT_A_FIELD = new Set([
    "Arguments",
    "VariableDefinitions",
    "ObjectValue",
    "ListValue",
    "StringValue",
    "Comment",
])

function inSelectionSet(state: EditorState): boolean {
    const { head, empty } = state.selection.main
    if (!empty) return false
    for (
        let node: SyntaxNode | null = syntaxTree(state).resolveInner(head, -1);
        node;
        node = node.parent
    ) {
        if (node.name === "SelectionSet") {
            // Strictly between the braces. Right after a closing `}` that set is finished —
            // an enclosing one may still be open, so keep walking up rather than accepting.
            // A set with no `}` yet counts as open however far the parser stretched it.
            if (head > node.from && (head < node.to || node.lastChild?.name !== "}")) return true
        } else if (NOT_A_FIELD.has(node.name)) return false
    }
    return false
}

/** Label of the completion accepted most recently, so the next list can carry on below it. */
const lastAccepted = StateField.define<string | null>({
    create: () => null,
    update: (value, tr) => tr.annotation(pickedCompletion)?.label ?? value,
})

/** Raised while Enter's list is on its way; the results arrive a query later. */
const armSelection = StateEffect.define<boolean>()

const arming = StateField.define<boolean>({
    create: () => false,
    update(value, tr) {
        for (const e of tr.effects) if (e.is(armSelection)) return e.value
        // Typing means the user is filtering the list, not walking down it.
        return value && !tr.docChanged
    },
})

/**
 * Selecting fields is a walk down the list: take `id`, break the line, and the one you want
 * next is `name` — not `id` again. So the list that opens on Enter starts on the entry after
 * the one just taken, leaving its order untouched.
 *
 * The selection has to ride along in the very transaction that opens the list. Setting it
 * afterwards means the popup renders once around the first entry and then jumps; the tooltip
 * even picks which slice of a long list to render from the selection it is built with.
 */
const continueBelowPicked = EditorState.transactionExtender.of(tr => {
    if (!tr.startState.field(arming, false)) return null
    // The state this transaction is about to produce — reading it here is what allows the
    // selection to be part of it instead of a follow-up.
    const status = completionStatus(tr.state)
    if (status === "pending") return null
    if (status !== "active") return { effects: armSelection.of(false) }
    const label = tr.state.field(lastAccepted)
    const options = currentCompletions(tr.state)
    const next = label ? options.findIndex(o => o.label === label) + 1 : 0
    const effects: StateEffect<unknown>[] = [armSelection.of(false)]
    // Not in this list, or it was the last entry: leave the default selection alone.
    if (next >= 1 && next < options.length) effects.push(setSelectedCompletion(next))
    return { effects }
})

/**
 * Breaking a line inside `{ … }` is the moment you ask "what can I write here?", so the field
 * list opens there — typing the brace itself doesn't, it would cover the text being written.
 * Raised above the default Enter binding; the completion popup's own Enter (accept the
 * highlighted option) sits higher still, so an open list keeps priority.
 */
export const completeOnNewline: Extension = [
    lastAccepted,
    arming,
    continueBelowPicked,
    Prec.high(
        keymap.of([
            {
                key: "Enter",
                run: view => {
                    if (completionStatus(view.state) === "active") return false
                    // Read before the edit: the tree is current for the document as it stands.
                    const open = inSelectionSet(view.state)
                    if (!insertNewlineAndIndent(view)) return false
                    if (!open) return true
                    view.dispatch({ effects: armSelection.of(true) })
                    startCompletion(view)
                    return true
                },
            },
        ]),
    ),
]

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
