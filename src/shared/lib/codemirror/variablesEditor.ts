import {
    type Completion,
    type CompletionContext,
    type CompletionResult,
    snippet,
    startCompletion,
} from "@codemirror/autocomplete"
import { jsonLanguage } from "@codemirror/lang-json"
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language"
import { type Diagnostic, linter } from "@codemirror/lint"
import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state"
import {
    Decoration,
    type DecorationSet,
    EditorView,
    type Tooltip,
    hoverTooltip,
} from "@codemirror/view"
import {
    type GraphQLInputType,
    getNamedType,
    getNullableType,
    isEnumType,
    isInputObjectType,
    isListType,
    isNonNullType,
} from "graphql"

import { markdownElement } from "@/shared/lib/markdown"

import {
    type GraphQLHoverOptions,
    el,
    renderDefault,
    renderDeprecation,
    renderDescription,
    renderScalarNote,
    renderType,
    renderVariants,
    text,
} from "./graphqlHover"
import {
    type Member,
    type SyntaxNode,
    VALUE_NODES,
    containerAt,
    keyOf,
    memberOf,
    membersOf,
    pathOf,
    placeholderFor,
    setVariablesContext,
    typeAt,
    validateVariables,
    variablesContextField,
} from "./variables"

/**
 * Variables JSON editor extensions: lint against the query's variable declarations,
 * hover docs for keys / enum values, and completion of keys and values by input type.
 */

// --- Lint ------------------------------------------------------------------------

const variablesLinter = linter(
    view => {
        const ctx = view.state.field(variablesContextField)
        const doc = view.state.doc.toString()
        const tree = ensureSyntaxTree(view.state, doc.length, 200) ?? syntaxTree(view.state)
        return validateVariables(ctx, doc, tree).map((issue): Diagnostic => ({
            from: issue.from,
            to: issue.to,
            severity: issue.severity,
            message: issue.message,
            markClass: issue.kind === "unused" ? "cm-lintRange-unused" : undefined,
            actions: issue.fix
                ? [
                      {
                          name: issue.fix.label,
                          apply: v => {
                              const { from, to, insert } = issue.fix!
                              v.dispatch({ changes: { from, to, insert } })
                          },
                      },
                  ]
                : undefined,
        }))
    },
    {
        delay: 300,
        needsRefresh: u =>
            u.transactions.some(tr => tr.effects.some(e => e.is(setVariablesContext))),
    },
)

// --- Hover -----------------------------------------------------------------------

function memberTooltip(m: Member, opts: GraphQLHoverOptions): HTMLElement {
    const head = el("div", "cm-gql-hover-head")
    if (m.variable) head.append(text(`$${m.name}`, "cm-gql-hover-variable"))
    else {
        if (m.parent) head.append(renderType(m.parent, opts), text(".", "cm-gql-hover-punct"))
        head.append(text(m.name, "cm-gql-hover-field"))
    }
    head.append(text(": ", "cm-gql-hover-punct"))
    head.append(m.type ? renderType(m.type, opts) : text(m.typeText, "cm-gql-hover-typeName"))
    return el(
        "div",
        "cm-gql-hover",
        head,
        renderDeprecation(m.deprecationReason),
        renderDescription(m.description ?? (m.type ? getNamedType(m.type).description : null)),
        renderDefault(m.defaultValue),
        m.variable
            ? el(
                  "div",
                  "cm-gql-hover-meta",
                  "used in: ",
                  text(m.variable.operations.join(", "), "cm-gql-hover-code"),
              )
            : null,
        renderScalarNote(m.type),
        renderVariants(m.type, opts),
    )
}

function enumValueTooltip(type: GraphQLInputType, value: string, opts: GraphQLHoverOptions) {
    const named = getNamedType(type)
    if (!isEnumType(named)) return null
    const v = named.getValue(value)
    if (!v) return null
    return el(
        "div",
        "cm-gql-hover",
        el(
            "div",
            "cm-gql-hover-head",
            renderType(named, opts),
            text(".", "cm-gql-hover-punct"),
            text(v.name, "cm-gql-hover-enum"),
        ),
        renderDeprecation(v.deprecationReason),
        renderDescription(v.description),
        renderVariants(named, opts, v.name),
    )
}

export function variablesHover(opts: GraphQLHoverOptions = {}): Extension {
    return hoverTooltip(
        (view, pos): Tooltip | null => {
            const ctx = view.state.field(variablesContextField)
            const doc = view.state.doc.toString()
            const node = syntaxTree(view.state).resolveInner(pos, 0)
            let dom: HTMLElement | null = null

            if (node.name === "PropertyName") {
                const container = containerAt(ctx, pathOf(doc, node))
                const member = container && memberOf(ctx, container, keyOf(doc, node))
                dom = member ? memberTooltip(member, opts) : null
            } else if (node.name === "String") {
                const type = typeAt(ctx, pathOf(doc, node))
                dom = type ? enumValueTooltip(type, keyOf(doc, node), opts) : null
            }
            if (!dom) return null
            return { pos: node.from, end: node.to, above: true, create: () => ({ dom }) }
        },
        { hideOnChange: true },
    )
}

// --- Completion -----------------------------------------------------------------

const memberDoc = (m: Member) => {
    const body = m.description || (m.type ? getNamedType(m.type).description : "") || ""
    const dep = m.deprecationReason ? `**Deprecated.** ${m.deprecationReason}` : ""
    const md = [dep, body].filter(Boolean).join("\n\n")
    return md ? () => markdownElement(md, "md cm-completion-doc") : undefined
}

/** Snippet for a member's value: cursor lands inside quotes / brackets, or on the literal. */
function valueSnippet(m: Member): string {
    const json = placeholderFor(m)
    if (json === '""') return '"#{}"'
    if (json === "{}") return "{#{}}"
    if (json === "[]") return "[#{}]"
    if (/[{}]/.test(json)) return json // objects/arrays from defaults: plain text
    if (json.startsWith('"')) return `"#{${json.slice(1, -1)}}"`
    return `#{${json}}`
}

/** Value types where popping the value list right after inserting a key is useful. */
function wantsValueCompletion(type: GraphQLInputType | null) {
    if (!type) return false
    const named = getNamedType(type)
    return isEnumType(named) || isInputObjectType(named) || named.name === "Boolean"
}

interface KeySite {
    /** Replaced range; `from` is right after the opening quote so typed text filters labels. */
    from: number
    to: number
    hasOpenQuote: boolean
    /** Property already has `: value`; only the name is being edited. */
    nameOnly: boolean
    object: SyntaxNode
    /** Property being edited, excluded from "already present" keys. */
    current: SyntaxNode | null
}

function keyCompletions(cx: CompletionContext, site: KeySite): CompletionResult | null {
    const ctx = cx.state.field(variablesContextField)
    const doc = cx.state.doc.toString()
    const container = containerAt(ctx, pathOf(doc, site.object))
    if (!container) return null

    const present = new Set<string>()
    let prev: SyntaxNode | null = null
    let next: SyntaxNode | null = null
    for (const p of site.object.getChildren("Property")) {
        if (p === site.current) continue
        const nameNode = p.getChild("PropertyName")
        if (nameNode) present.add(keyOf(doc, nameNode))
        if (p.to <= site.from) prev = p
        if (!next && p.from >= site.to) next = p
    }
    const start = site.hasOpenQuote ? site.from - 1 : site.from
    const commaBefore = prev && !cx.state.sliceDoc(prev.to, start).includes(",")
    const commaAfter = next && !cx.state.sliceDoc(site.to, next.from).includes(",")

    const options = membersOf(ctx, container)
        .filter(m => !present.has(m.name))
        .map((m): Completion => {
            const foreign = m.variable && ctx.active && !m.variable.inActive
            return {
                label: m.name,
                detail: foreign ? `${m.typeText} · ${m.variable!.operations[0]}` : m.typeText,
                type: m.variable ? "variable" : "property",
                boost: (m.required ? 1 : 0) + (foreign ? -2 : 0) + (m.deprecationReason ? -1 : 0),
                info: memberDoc(m),
                apply: (view, completion, from, to) => {
                    let replaceFrom = site.hasOpenQuote ? from - 1 : from
                    let replaceTo = to
                    if (commaBefore) {
                        view.dispatch({ changes: { from: prev!.to, insert: "," } })
                        replaceFrom++
                        replaceTo++
                    }
                    const body = site.nameOnly
                        ? JSON.stringify(m.name)
                        : `${JSON.stringify(m.name)}: ${valueSnippet(m)}${commaAfter ? "," : ""}`
                    snippet(body)(view, completion, replaceFrom, replaceTo)
                    if (!site.nameOnly && wantsValueCompletion(m.type)) startCompletion(view)
                },
            }
        })
    if (!options.length) return null
    return { from: site.from, to: site.to, options, validFor: /^\w*$/ }
}

function valueCompletions(
    type: GraphQLInputType | null,
    member: Member | null,
    from: number,
    to: number,
    inString: boolean,
): CompletionResult | null {
    if (!type) return null
    const nullable = getNullableType(type)
    const named = getNamedType(type)
    const options: Completion[] = []
    const lit = (label: string, tpl: string, extra: Partial<Completion> = {}): Completion => ({
        label,
        apply: (view, c, f, t) => snippet(tpl)(view, c, f, t),
        ...extra,
    })

    if (isEnumType(named)) {
        for (const v of named.getValues()) {
            options.push({
                label: `"${v.name}"`,
                type: "enum",
                detail: v.deprecationReason != null ? "deprecated" : undefined,
                boost: v.deprecationReason != null ? -1 : 0,
                info: v.description
                    ? () => markdownElement(v.description!, "md cm-completion-doc")
                    : undefined,
            })
        }
    }
    if (!inString) {
        if (member?.defaultValue !== undefined) {
            options.push({
                label: JSON.stringify(member.defaultValue),
                detail: "default",
                boost: 2,
            })
        }
        if (isListType(nullable)) options.push(lit("[ ]", "[#{}]", { detail: String(nullable) }))
        else if (isInputObjectType(named))
            options.push(lit("{ }", "{#{}}", { detail: named.name, type: "type" }))
        else if (named.name === "Boolean") options.push({ label: "true" }, { label: "false" })
        else if (!isEnumType(named) && named.name !== "Int" && named.name !== "Float")
            options.push(lit('""', '"#{}"', { detail: named.name }))
        if (!isNonNullType(type)) options.push({ label: "null", boost: -2 })
    }
    // A default that's also a literal (e.g. `true`) would otherwise show up twice.
    const unique = options.filter((o, i) => options.findIndex(x => x.label === o.label) === i)
    if (!unique.length) return null
    return { from, to, options: unique, validFor: /^"?\w*$/ }
}

function completionSource(cx: CompletionContext): CompletionResult | null {
    const ctx = cx.state.field(variablesContextField, false)
    if (!ctx) return null
    const doc = cx.state.doc.toString()
    let node = syntaxTree(cx.state).resolveInner(cx.pos, -1)
    // Right after `{`, `,`, `[` or `:` the innermost node is that token; its parent is the context.
    if (["{", ",", "[", ":"].includes(node.name) && node.parent) node = node.parent
    const parent = node.parent
    const slice = (from: number, to: number) => cx.state.sliceDoc(from, to)

    // Blank document: offer a template with the operation's variables.
    if (node.name === "JsonText" || (node.type.isError && parent?.name === "JsonText")) {
        if (doc.trim() || !cx.explicit) return null
        const vars = membersOf(ctx, { kind: "root" }).filter(
            m => !m.variable || m.variable.inActive || !ctx.active,
        )
        if (!vars.length) return null
        const body = vars.map(m => `  ${JSON.stringify(m.name)}: ${valueSnippet(m)}`).join(",\n")
        return {
            from: 0,
            to: doc.length,
            options: [
                {
                    label: "{ all variables }",
                    detail: ctx.active?.label,
                    apply: (view, c, f, t) => snippet(`{\n${body}\n}`)(view, c, f, t),
                },
            ],
        }
    }

    // Keys ------------------------------------------------------------------------
    const quoted = (n: SyntaxNode) => slice(n.from, n.from + 1) === '"'
    const closed = (n: SyntaxNode) => n.to - n.from >= 2 && slice(n.to - 1, n.to) === '"'
    const keySite = (n: SyntaxNode, object: SyntaxNode, current: SyntaxNode | null): KeySite => {
        const hasOpenQuote = quoted(n)
        return {
            from: hasOpenQuote ? n.from + 1 : n.from,
            to: n.to,
            hasOpenQuote,
            nameOnly: /^\s*:/.test(slice(n.to, n.to + 40)),
            object,
            current,
        }
    }
    if (node.name === "PropertyName" && parent?.parent?.name === "Object") {
        if (closed(node) && cx.pos >= node.to) return null
        return keyCompletions(cx, keySite(node, parent.parent, parent))
    }
    if (node.name === "String" && parent?.name === "Object") {
        if (closed(node) && cx.pos >= node.to) return null
        return keyCompletions(cx, keySite(node, parent, null))
    }
    if (node.type.isError) {
        // `{ na` or `{ "na` — a key being typed, with or without its opening quote.
        if (parent?.name === "Object") return keyCompletions(cx, keySite(node, parent, null))
        if (
            parent?.name === "Property" &&
            parent.parent?.name === "Object" &&
            !parent.getChild("PropertyName")
        )
            return keyCompletions(cx, keySite(node, parent.parent, parent))
    }
    if (node.name === "Object") {
        // Whitespace between properties; nothing typed yet.
        if (!cx.explicit && !/[{,\s]$/.test(slice(Math.max(0, cx.pos - 1), cx.pos))) return null
        const site: KeySite = {
            from: cx.pos,
            to: cx.pos,
            hasOpenQuote: false,
            nameOnly: false,
            object: node,
            current: null,
        }
        const keys = keyCompletions(cx, site)
        if (!keys || !cx.explicit) return keys
        // Empty root object: also offer filling every variable in one go.
        if (node.parent?.name === "JsonText" && !node.getChild("Property")) {
            const vars = membersOf(ctx, { kind: "root" }).filter(
                m => !m.variable || m.variable.inActive || !ctx.active,
            )
            if (vars.length > 1) {
                const body = vars
                    .map(m => `  ${JSON.stringify(m.name)}: ${valueSnippet(m)}`)
                    .join(",\n")
                keys.options = [
                    {
                        label: "{ all variables }",
                        detail: ctx.active?.label,
                        boost: 5,
                        apply: (view, c) => snippet(`{\n${body}\n}`)(view, c, node.from, node.to),
                    },
                    ...keys.options,
                ]
            }
        }
        return keys
    }

    // Values ----------------------------------------------------------------------
    const memberAt = (path: ReturnType<typeof pathOf>): Member | null => {
        const key = path[path.length - 1]
        if (typeof key !== "string") return null
        const container = containerAt(ctx, path.slice(0, -1))
        return container ? memberOf(ctx, container, key) : null
    }
    if (node.name === "Property") {
        const nameNode = node.getChild("PropertyName")
        if (!nameNode || !/:\s*$/.test(slice(nameNode.to, cx.pos))) return null
        const path = [...pathOf(doc, node), keyOf(doc, nameNode)]
        return valueCompletions(typeAt(ctx, path), memberAt(path), cx.pos, cx.pos, false)
    }
    if (node.name === "Array") {
        const path = [...pathOf(doc, node), 0]
        return valueCompletions(typeAt(ctx, path), null, cx.pos, cx.pos, false)
    }
    const inValue =
        parent?.name === "Array" || (parent?.name === "Property" && node.name !== "PropertyName")
    if (inValue && (VALUE_NODES.has(node.name) || node.type.isError)) {
        if (node.type.isError && parent!.name === "Property" && !parent!.getChild("PropertyName"))
            return null
        const path = pathOf(doc, node)
        const inString = node.name === "String" || quoted(node)
        return valueCompletions(typeAt(ctx, path), memberAt(path), node.from, node.to, inString)
    }
    return null
}

export const variablesCompletion = jsonLanguage.data.of({ autocomplete: completionSource })

// --- Dimming ----------------------------------------------------------------------

const foreignMark = Decoration.mark({ class: "cm-gql-var-foreign" })

/**
 * Top-level entries the operation that will run doesn't declare — variables of another
 * operation, or leftovers of an edited query. Dimmed so the ones actually sent stand out.
 */
function dimForeignVariables(state: EditorState): DecorationSet {
    const ctx = state.field(variablesContextField, false)
    if (!ctx) return Decoration.none
    const root = syntaxTree(state).topNode.firstChild
    if (!root || root.name !== "Object") return Decoration.none
    const doc = state.doc.toString()
    const ranges: Range<Decoration>[] = []
    for (const prop of root.getChildren("Property")) {
        const nameNode = prop.getChild("PropertyName")
        if (!nameNode) continue
        const declared = ctx.vars.get(keyOf(doc, nameNode))
        // With several operations in the document, only the active one's variables are sent.
        if (!declared || (ctx.active !== null && !declared.inActive))
            ranges.push(foreignMark.range(prop.from, prop.to))
    }
    return Decoration.set(ranges)
}

const foreignVariablesField = StateField.define<DecorationSet>({
    create: dimForeignVariables,
    update(deco, tr) {
        if (
            !tr.docChanged &&
            syntaxTree(tr.startState) === syntaxTree(tr.state) &&
            !tr.effects.some(e => e.is(setVariablesContext))
        )
            return deco
        return dimForeignVariables(tr.state)
    },
    provide: f => EditorView.decorations.from(f),
})

// `span` too: the JSON highlight marks nest inside this one and would keep their colour.
const foreignTheme = EditorView.baseTheme({
    ".cm-gql-var-foreign, .cm-gql-var-foreign span": { color: "var(--text-3)" },
})

// --- Bundle -----------------------------------------------------------------------

/** Everything the variables JSON editor needs on top of `json()`. Drive it with `setVariablesContext`. */
export function variablesSupport(opts: GraphQLHoverOptions = {}): Extension {
    return [
        variablesContextField,
        variablesLinter,
        variablesHover(opts),
        variablesCompletion,
        foreignVariablesField,
        foreignTheme,
    ]
}
