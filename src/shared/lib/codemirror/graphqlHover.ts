import type { Extension } from "@codemirror/state"
import { type Tooltip, hoverTooltip } from "@codemirror/view"
import { getSchema, offsetToPos } from "cm6-graphql"
import {
    type FragmentDefinitionNode,
    type GraphQLArgument,
    type GraphQLEnumValue,
    type GraphQLField,
    type GraphQLInputField,
    type GraphQLNamedType,
    type GraphQLSchema,
    type GraphQLType,
    getNamedType,
    isEnumType,
    isInputObjectType,
    isInterfaceType,
    isObjectType,
    isScalarType,
    isUnionType,
    parse,
} from "graphql"
import {
    type State,
    collectVariables,
    getContextAtPosition,
    getFragmentDefinitions,
    getTypeInfo,
} from "graphql-language-service"

import { typeGroupClass } from "@/shared/lib/graphql"
import { markdownElement, markdownSummary } from "@/shared/lib/markdown"

type AllTypeInfo = ReturnType<typeof getTypeInfo>

export interface GraphQLHoverOptions {
    /** Called when a type name inside the tooltip is clicked (e.g. to open it in the schema explorer). */
    onTypeClick?: (typeName: string) => void
}

// --- DOM helpers -------------------------------------------------------------

export function el(tag: string, cls?: string, ...children: (Node | string | null | undefined)[]) {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    for (const c of children) if (c != null) node.append(c)
    return node
}

export const text = (s: string, cls?: string) => el("span", cls, s)

export function renderType(t: GraphQLType, opts: GraphQLHoverOptions): HTMLElement {
    const named = getNamedType(t)
    const str = t.toString()
    const idx = str.indexOf(named.name)
    const wrap = el("span", "cm-gql-hover-type")
    if (idx > 0) wrap.append(text(str.slice(0, idx), "cm-gql-hover-punct"))
    const name = text(named.name, `cm-gql-hover-typeName ${typeGroupClass(named)}`)
    if (opts.onTypeClick) {
        name.classList.add("cm-gql-hover-link")
        name.title = `Open ${named.name} in schema`
        name.addEventListener("mousedown", e => {
            e.preventDefault()
            e.stopPropagation()
            opts.onTypeClick?.(named.name)
        })
    }
    wrap.append(name)
    const after = str.slice(idx + named.name.length)
    if (after) wrap.append(text(after, "cm-gql-hover-punct"))
    return wrap
}

function renderArgs(
    args: ReadonlyArray<GraphQLArgument>,
    opts: GraphQLHoverOptions,
): (Node | string)[] {
    if (!args.length) return []
    const out: (Node | string)[] = [text("(", "cm-gql-hover-punct")]
    args.forEach((a, i) => {
        if (i) out.push(text(", ", "cm-gql-hover-punct"))
        out.push(
            text(a.name, "cm-gql-hover-arg"),
            text(": ", "cm-gql-hover-punct"),
            renderType(a.type, opts),
        )
    })
    out.push(text(")", "cm-gql-hover-punct"))
    return out
}

export function renderDescription(desc: string | null | undefined) {
    const d = desc?.trim()
    return d ? markdownElement(d, "cm-gql-hover-desc md") : null
}

export function renderDeprecation(reason: string | null | undefined) {
    if (reason == null) return null
    return el(
        "div",
        "cm-gql-hover-deprecated",
        "Deprecated",
        reason.trim() ? text(` — ${reason.trim()}`) : null,
    )
}

export function renderDefault(value: unknown) {
    if (value === undefined) return null
    return el(
        "div",
        "cm-gql-hover-meta",
        "default: ",
        text(JSON.stringify(value), "cm-gql-hover-code"),
    )
}

// --- "Variants" — what can be written under / for this type ----------------

interface Variant {
    name: string
    type?: GraphQLType
    description?: string | null
    deprecated?: boolean
}

function variantsOf(named: GraphQLNamedType): { title: string; items: Variant[] } | null {
    if (isEnumType(named)) {
        return {
            title: "Values",
            items: named.getValues().map((v: GraphQLEnumValue) => ({
                name: v.name,
                description: v.description,
                deprecated: v.deprecationReason != null,
            })),
        }
    }
    if (isObjectType(named) || isInterfaceType(named)) {
        return {
            title: "Fields",
            items: Object.values(named.getFields()).map((f: GraphQLField<unknown, unknown>) => ({
                name: f.args.length ? `${f.name}(…)` : f.name,
                type: f.type,
                description: f.description,
                deprecated: f.deprecationReason != null,
            })),
        }
    }
    if (isInputObjectType(named)) {
        return {
            title: "Input fields",
            items: Object.values(named.getFields()).map((f: GraphQLInputField) => ({
                name: f.name,
                type: f.type,
                description: f.description,
                deprecated: f.deprecationReason != null,
            })),
        }
    }
    if (isUnionType(named)) {
        return {
            title: "Possible types",
            items: named
                .getTypes()
                .map(t => ({ name: `... on ${t.name}`, description: t.description })),
        }
    }
    return null
}

export function renderVariants(
    t: GraphQLType | null | undefined,
    opts: GraphQLHoverOptions,
    highlight?: string,
) {
    if (!t) return null
    const named = getNamedType(t)
    const v = variantsOf(named)
    if (!v || !v.items.length) return null

    const list = el("ul", "cm-gql-hover-list")
    for (const item of v.items) {
        const li = el(
            "li",
            `cm-gql-hover-item${item.deprecated ? " cm-gql-hover-item-deprecated" : ""}${item.name === highlight ? " cm-gql-hover-item-active" : ""}`,
            text(item.name, isEnumType(named) ? "cm-gql-hover-enum" : "cm-gql-hover-field"),
        )
        if (item.type) li.append(text(": ", "cm-gql-hover-punct"), renderType(item.type, opts))
        const d = item.description?.trim()
        if (d) li.append(text(markdownSummary(d), "cm-gql-hover-itemDesc"))
        list.append(li)
    }

    return el(
        "div",
        "cm-gql-hover-section",
        el("div", "cm-gql-hover-sectionTitle", `${v.title} · ${named.name}`),
        list,
    )
}

export function renderScalarNote(t: GraphQLType | null | undefined) {
    if (!t) return null
    const named = getNamedType(t)
    if (!isScalarType(named) || !named.description) return null
    return el(
        "div",
        "cm-gql-hover-section",
        el("div", "cm-gql-hover-sectionTitle", named.name),
        renderDescription(named.description),
    )
}

// --- Per-token renderers -----------------------------------------------------

function fieldTooltip(info: AllTypeInfo, opts: GraphQLHoverOptions) {
    const f = info.fieldDef!
    const head = el("div", "cm-gql-hover-head")
    if (info.parentType && !f.name.startsWith("__"))
        head.append(renderType(info.parentType, opts), text(".", "cm-gql-hover-punct"))
    head.append(text(f.name, "cm-gql-hover-field"))
    if ("args" in f && f.args) head.append(...renderArgs(f.args, opts))
    if (info.type) head.append(text(": ", "cm-gql-hover-punct"), renderType(info.type, opts))
    return el(
        "div",
        "cm-gql-hover",
        head,
        renderDeprecation(f.deprecationReason),
        renderDescription(f.description),
        renderScalarNote(info.type),
        renderVariants(info.type, opts),
    )
}

function argTooltip(info: AllTypeInfo, opts: GraphQLHoverOptions) {
    const a = info.argDef!
    const head = el("div", "cm-gql-hover-head")
    if (info.directiveDef) head.append(text(`@${info.directiveDef.name}`, "cm-gql-hover-directive"))
    else if (info.fieldDef) head.append(text(info.fieldDef.name, "cm-gql-hover-field"))
    head.append(text("(", "cm-gql-hover-punct"), text(a.name, "cm-gql-hover-arg"))
    if (info.inputType)
        head.append(text(": ", "cm-gql-hover-punct"), renderType(info.inputType, opts))
    head.append(text(")", "cm-gql-hover-punct"))
    return el(
        "div",
        "cm-gql-hover",
        head,
        renderDeprecation((a as GraphQLArgument).deprecationReason),
        renderDescription(a.description),
        renderDefault((a as GraphQLArgument).defaultValue),
        renderScalarNote(info.inputType),
        renderVariants(info.inputType, opts),
    )
}

function enumValueTooltip(info: AllTypeInfo, opts: GraphQLHoverOptions) {
    const v = info.enumValue!
    const head = el("div", "cm-gql-hover-head")
    if (info.inputType)
        head.append(renderType(info.inputType, opts), text(".", "cm-gql-hover-punct"))
    head.append(text(v.name, "cm-gql-hover-enum"))
    return el(
        "div",
        "cm-gql-hover",
        head,
        renderDeprecation(v.deprecationReason),
        renderDescription(v.description),
        renderVariants(info.inputType, opts, v.name),
    )
}

function directiveTooltip(info: AllTypeInfo, opts: GraphQLHoverOptions) {
    const d = info.directiveDef!
    const head = el(
        "div",
        "cm-gql-hover-head",
        text(`@${d.name}`, "cm-gql-hover-directive"),
        ...renderArgs(d.args, opts),
    )
    return el(
        "div",
        "cm-gql-hover",
        head,
        renderDescription(d.description),
        el("div", "cm-gql-hover-meta", "on: ", text(d.locations.join(", "), "cm-gql-hover-code")),
    )
}

function typeTooltip(t: GraphQLType, opts: GraphQLHoverOptions, label?: string) {
    const named = getNamedType(t)
    const head = el("div", "cm-gql-hover-head")
    if (label) head.append(text(label, "cm-gql-hover-variable"), text(": ", "cm-gql-hover-punct"))
    head.append(renderType(t, opts))
    return el(
        "div",
        "cm-gql-hover",
        head,
        renderDescription(named.description),
        renderVariants(t, opts),
    )
}

function fragmentTooltip(
    schema: GraphQLSchema,
    def: FragmentDefinitionNode,
    opts: GraphQLHoverOptions,
) {
    const typeName = def.typeCondition.name.value
    const t = schema.getType(typeName)
    const head = el(
        "div",
        "cm-gql-hover-head",
        text("fragment ", "cm-gql-hover-keyword"),
        text(def.name.value, "cm-gql-hover-field"),
        text(" on ", "cm-gql-hover-keyword"),
    )
    head.append(t ? renderType(t, opts) : text(typeName, "cm-gql-hover-typeName"))
    return el(
        "div",
        "cm-gql-hover",
        head,
        t ? renderDescription(t.description) : null,
        t ? renderVariants(t, opts) : null,
    )
}

/** In `query ($id: ID!)` the online parser has no input type yet; resolve it from the parsed document. */
function declaredVariableType(
    schema: GraphQLSchema,
    query: string,
    name: string,
): GraphQLType | null {
    try {
        return collectVariables(schema, parse(query))[name] ?? null
    } catch {
        return null
    }
}

function buildTooltip(
    schema: GraphQLSchema,
    query: string,
    state: State,
    info: AllTypeInfo,
    fragments: ReadonlyArray<FragmentDefinitionNode>,
    opts: GraphQLHoverOptions,
): HTMLElement | null {
    const { kind, step } = state
    if (
        (kind === "Field" && step === 0) ||
        (kind === "AliasedField" && step === 2) ||
        (kind === "ObjectField" && step === 0)
    ) {
        return info.fieldDef ? fieldTooltip(info, opts) : null
    }
    if ((kind === "Argument" || kind === "FragmentArgument") && step === 0)
        return info.argDef ? argTooltip(info, opts) : null
    if (kind === "EnumValue") return info.enumValue ? enumValueTooltip(info, opts) : null
    if (kind === "Directive" && step === 1)
        return info.directiveDef ? directiveTooltip(info, opts) : null
    if (kind === "Variable" && state.name) {
        const t = info.inputType ?? declaredVariableType(schema, query, state.name)
        return t ? typeTooltip(t, opts, `$${state.name}`) : null
    }
    if (kind === "NamedType") return info.type ? typeTooltip(info.type, opts) : null
    if (kind === "TypeCondition" || kind === "InlineFragment" || kind === "FragmentDefinition") {
        const t = state.type ? schema.getType(state.type) : null
        return t ? typeTooltip(t, opts) : null
    }
    if (kind === "FragmentSpread" && state.name) {
        const def = fragments.find(f => f.name.value === state.name)
        return def ? fragmentTooltip(schema, def, opts) : null
    }
    return null
}

// --- Extension ---------------------------------------------------------------

/**
 * Shows schema docs for the token under the pointer: field signature, description,
 * and the values/fields/input-fields that are valid to write for its type.
 */
export function graphqlHover(opts: GraphQLHoverOptions = {}): Extension {
    return hoverTooltip(
        (view, pos): Tooltip | null => {
            const schema = getSchema(view.state)
            if (!schema) return null
            const word = view.state.wordAt(pos)
            if (!word) return null

            const doc = view.state.doc
            const query = doc.toString()
            let fragments: ReadonlyArray<FragmentDefinitionNode> = []
            try {
                fragments = getFragmentDefinitions(query)
            } catch {
                /* partial documents may not parse; hover still works without fragments */
            }
            const ctx = getContextAtPosition(
                query,
                offsetToPos(doc, word.from),
                schema,
                undefined,
                { fragmentDefinitions: fragments },
            )
            if (!ctx) return null

            const dom = buildTooltip(schema, query, ctx.state, ctx.typeInfo, fragments, opts)
            if (!dom) return null
            return { pos: word.from, end: word.to, above: true, create: () => ({ dom }) }
        },
        // Typing dismisses the tooltip: it describes the token that was under the pointer,
        // which the edit has already moved or changed.
        { hoverTime: 250, hideOnChange: true },
    )
}
