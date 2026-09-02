import { syntaxTree } from "@codemirror/language"
import { EditorState, type Extension, type Range, StateField } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view"

import type { OperationKind } from "@/shared/types"

export interface DocOperationRange {
    name: string | null
    kind: OperationKind
    from: number
    to: number
}

export interface ActiveOperation {
    name: string | null
    kind: OperationKind
    index: number
    /** Whether the cursor is inside the operation's lines, or in the gap before/after it. */
    placement: "inside" | "before" | "after"
}

/** Top-level operations from the lezer tree — available even while the document doesn't parse with graphql-js. */
export function findOperations(state: EditorState): DocOperationRange[] {
    const out: DocOperationRange[] = []
    const tree = syntaxTree(state)
    for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
        if (node.name !== "OperationDefinition") continue
        let name: string | null = null
        let kind: OperationKind = "query"
        for (let c = node.firstChild; c; c = c.nextSibling) {
            if (c.name === "OperationType") kind = state.sliceDoc(c.from, c.to) as OperationKind
            else if (c.name === "Name" && !name) name = state.sliceDoc(c.from, c.to)
            else if (c.name === "SelectionSet") break
        }
        out.push({ name, kind, from: node.from, to: node.to })
    }
    return out
}

/** Operation whose lines contain the cursor; falls back to the nearest one when the cursor sits in a gap. */
export function activeOperationIndex(state: EditorState, ops: DocOperationRange[]): number {
    return locateOperation(state, ops).index
}

/** Nearest operation plus where the cursor sits relative to it. */
export function locateOperation(
    state: EditorState,
    ops: DocOperationRange[],
): { index: number; placement: ActiveOperation["placement"] } {
    if (!ops.length) return { index: -1, placement: "inside" }
    const head = state.selection.main.head
    const line = state.doc.lineAt(head)
    let best = -1
    let bestDist = Infinity
    let placement: ActiveOperation["placement"] = "inside"
    ops.forEach((op, i) => {
        const from = state.doc.lineAt(op.from).from
        const to = state.doc.lineAt(op.to).to
        if (line.from >= from && line.to <= to) {
            best = i
            bestDist = -1
            placement = "inside"
            return
        }
        const dist = head < from ? from - head : head - to
        if (bestDist >= 0 && dist < bestDist) {
            best = i
            bestDist = dist
            placement = head < from ? "before" : "after"
        }
    })
    return { index: best, placement }
}

export function activeOperation(state: EditorState): ActiveOperation | null {
    const ops = findOperations(state)
    const { index, placement } = locateOperation(state, ops)
    if (index < 0) return null
    const op = ops[index]!
    return { name: op.name, kind: op.kind, index, placement }
}

/** Move the cursor to the start of the named operation's body so it becomes the active one. */
export function revealOperation(view: EditorView, name: string) {
    const op = findOperations(view.state).find(o => o.name === name)
    if (!op) return
    view.dispatch({ selection: { anchor: op.from }, scrollIntoView: true })
    view.focus()
}

// --- decorations ---------------------------------------------------------------

class SeparatorWidget extends WidgetType {
    toDOM() {
        const el = document.createElement("div")
        el.className = "cm-op-separator"
        el.setAttribute("aria-hidden", "true")
        return el
    }
    eq() {
        return true
    }
    get estimatedHeight() {
        return 17
    }
    ignoreEvent() {
        return true
    }
}

const separator = Decoration.widget({ widget: new SeparatorWidget(), block: true, side: -1 })
const dimLine = Decoration.line({ class: "cm-op-dim" })

function buildDecorations(state: EditorState): DecorationSet {
    const ops = findOperations(state)
    if (ops.length < 2) return Decoration.none
    const active = activeOperationIndex(state, ops)
    const ranges: Range<Decoration>[] = []
    ops.forEach((op, i) => {
        const first = state.doc.lineAt(op.from)
        const last = state.doc.lineAt(op.to)
        if (i > 0) ranges.push(separator.range(first.from))
        if (i === active) return
        for (let n = first.number; n <= last.number; n++)
            ranges.push(dimLine.range(state.doc.line(n).from))
    })
    return Decoration.set(ranges, true)
}

const focusField = StateField.define<DecorationSet>({
    create: buildDecorations,
    update(deco, tr) {
        if (!tr.docChanged && !tr.selection && syntaxTree(tr.startState) === syntaxTree(tr.state))
            return deco
        return buildDecorations(tr.state)
    },
    provide: f => EditorView.decorations.from(f),
})

const focusTheme = EditorView.baseTheme({
    ".cm-op-dim": { opacity: "0.45", transition: "opacity 0.15s ease" },
    // No margins: CodeMirror measures block widgets without them, which would desync the gutter.
    ".cm-op-separator": { position: "relative", height: "17px" },
    ".cm-op-separator::after": {
        content: '""',
        position: "absolute",
        left: "4px",
        right: "12px",
        top: "8px",
        height: "1px",
        background: "var(--border)",
    },
})

export interface OperationFocusOptions {
    /** Fired when the operation under the cursor changes (or disappears). */
    onActiveChange?: (op: ActiveOperation | null) => void
}

/**
 * Multi-operation documents: the operation containing the cursor is the one that runs.
 * Others are dimmed and operations are visually separated.
 */
export function operationFocus(opts: OperationFocusOptions = {}): Extension {
    let last: ActiveOperation | null | undefined
    const notify = (state: EditorState) => {
        const next = activeOperation(state)
        if (
            last !== undefined &&
            last?.name === next?.name &&
            last?.kind === next?.kind &&
            last?.index === next?.index &&
            last?.placement === next?.placement
        )
            return
        last = next
        opts.onActiveChange?.(next)
    }
    return [
        focusField,
        focusTheme,
        EditorView.updateListener.of(u => {
            if (
                u.docChanged ||
                u.selectionSet ||
                syntaxTree(u.startState) !== syntaxTree(u.state) ||
                last === undefined
            )
                notify(u.state)
        }),
    ]
}
