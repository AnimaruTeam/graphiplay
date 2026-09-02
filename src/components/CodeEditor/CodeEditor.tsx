import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
    completionKeymap,
    startCompletion,
} from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { json, jsonParseLinter } from "@codemirror/lang-json"
import {
    bracketMatching,
    foldGutter,
    foldKeymap,
    indentOnInput,
    syntaxHighlighting,
} from "@codemirror/language"
import { lintKeymap } from "@codemirror/lint"
import { linter } from "@codemirror/lint"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import { EditorState, type Extension } from "@codemirror/state"
import {
    EditorView,
    crosshairCursor,
    drawSelection,
    dropCursor,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    keymap,
    lineNumbers,
    placeholder as placeholderExt,
    rectangularSelection,
} from "@codemirror/view"
import { graphqlLanguageSupport, jump, lint, stateExtensions, updateSchema } from "cm6-graphql"
import type { GraphQLSchema } from "graphql"
import { type Ref, useEffect, useImperativeHandle, useRef } from "react"

import {
    type ActiveOperation,
    activeOperation,
    graphqlCompletion,
    graphqlHover,
    jsonHighlightStyle,
    operationFocus,
    revealOperation,
    setVariablesContext,
    themeExtension,
    variablesSupport,
} from "@/shared/lib/codemirror"

import styles from "./CodeEditor.module.css"

export interface CodeEditorProps {
    value: string
    onChange?: (value: string) => void
    language: "graphql" | "json"
    schema?: GraphQLSchema | null
    /**
     * JSON only: the GraphQL document whose variables this JSON provides. Turns on
     * type-aware lint, hover docs and completion driven by the query's declarations.
     */
    query?: string
    /** JSON only: operation that will run, when the document has several. */
    operationName?: string | null
    readOnly?: boolean
    placeholder?: string
    lineNumbers?: boolean
    onRun?: () => void
    onSave?: () => void
    onFormat?: () => void
    /** Type name clicked inside a hover tooltip. */
    onOpenType?: (typeName: string) => void
    /** GraphQL only: the operation under the cursor changed (null when the document has none). */
    onActiveOperationChange?: (op: ActiveOperation | null) => void
    className?: string
    autoFocus?: boolean
    ref?: Ref<CodeEditorHandle>
}

export interface CodeEditorHandle {
    /** Move the cursor into the named operation and focus the editor. */
    revealOperation: (name: string) => void
    focus: () => void
    /** Apply a single text replacement as one transaction (keeps undo history); optionally moves the cursor. */
    applyChange: (change: { from: number; to: number; insert: string }, cursor?: number) => boolean
}

export function CodeEditor({
    value,
    onChange,
    language,
    schema,
    query,
    operationName,
    readOnly = false,
    placeholder,
    lineNumbers: showLineNumbers = true,
    onRun,
    onSave,
    onFormat,
    onOpenType,
    onActiveOperationChange,
    className,
    autoFocus,
    ref,
}: CodeEditorProps) {
    const hostRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const variablesMode = language === "json" && query !== undefined && !readOnly
    const variablesContext = useRef({
        schema: schema ?? null,
        query: query ?? "",
        operationName: operationName ?? null,
    })
    variablesContext.current = {
        schema: schema ?? null,
        query: query ?? "",
        operationName: operationName ?? null,
    }
    const callbacks = useRef({
        onChange,
        onRun,
        onSave,
        onFormat,
        onOpenType,
        onActiveOperationChange,
    })
    callbacks.current = { onChange, onRun, onSave, onFormat, onOpenType, onActiveOperationChange }

    useImperativeHandle(ref, () => ({
        revealOperation: name => {
            if (viewRef.current) revealOperation(viewRef.current, name)
        },
        focus: () => viewRef.current?.focus(),
        applyChange: (change, cursor) => {
            const view = viewRef.current
            if (!view || change.to > view.state.doc.length) return false
            view.dispatch({
                changes: change,
                ...(cursor !== undefined ? { selection: { anchor: cursor } } : {}),
            })
            return true
        },
    }))

    useEffect(() => {
        const host = hostRef.current
        if (!host) return

        const langExt: Extension =
            language === "graphql"
                ? [
                      // Same set as cm6-graphql's graphql(), with its completion source swapped for ours.
                      graphqlLanguageSupport(),
                      graphqlCompletion,
                      lint,
                      jump,
                      stateExtensions(schema ?? undefined, { showErrorOnInvalidSchema: true }),
                      graphqlHover({ onTypeClick: name => callbacks.current.onOpenType?.(name) }),
                      operationFocus({
                          onActiveChange: op => callbacks.current.onActiveOperationChange?.(op),
                      }),
                  ]
                : [
                      json(),
                      syntaxHighlighting(jsonHighlightStyle),
                      ...(readOnly ? [] : [linter(jsonParseLinter())]),
                      ...(variablesMode
                          ? [
                                variablesSupport({
                                    onTypeClick: name => callbacks.current.onOpenType?.(name),
                                }),
                            ]
                          : []),
                  ]

        const extensions: Extension[] = [
            ...(showLineNumbers
                ? [lineNumbers(), foldGutter({ openText: "⌄", closedText: "›" })]
                : []),
            highlightSpecialChars(),
            history(),
            drawSelection(),
            dropCursor(),
            EditorState.allowMultipleSelections.of(true),
            indentOnInput(),
            bracketMatching(),
            closeBrackets(),
            autocompletion({ activateOnTyping: true, maxRenderedOptions: 40 }),
            rectangularSelection(),
            crosshairCursor(),
            highlightActiveLine(),
            highlightActiveLineGutter(),
            highlightSelectionMatches(),
            keymap.of([
                {
                    key: "Mod-Enter",
                    run: () => {
                        callbacks.current.onRun?.()
                        return true
                    },
                },
                {
                    key: "Mod-s",
                    run: () => {
                        callbacks.current.onSave?.()
                        return true
                    },
                },
                {
                    key: "Shift-Alt-f",
                    run: () => {
                        callbacks.current.onFormat?.()
                        return true
                    },
                },
                { key: "Ctrl-Space", run: startCompletion },
                ...closeBracketsKeymap,
                ...defaultKeymap,
                ...searchKeymap,
                ...historyKeymap,
                ...foldKeymap,
                ...completionKeymap,
                ...lintKeymap,
                indentWithTab,
            ]),
            ...themeExtension,
            langExt,
            EditorView.lineWrapping,
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
            EditorState.tabSize.of(2),
            EditorView.updateListener.of(update => {
                if (update.docChanged) callbacks.current.onChange?.(update.state.doc.toString())
            }),
            ...(placeholder ? [placeholderExt(placeholder)] : []),
        ]

        const view = new EditorView({
            state: EditorState.create({ doc: value, extensions }),
            parent: host,
        })
        viewRef.current = view
        if (autoFocus) view.focus()
        // The update listener only fires on changes; report the initial operation explicitly.
        if (language === "graphql")
            callbacks.current.onActiveOperationChange?.(activeOperation(view.state))
        if (variablesMode)
            view.dispatch({ effects: setVariablesContext.of(variablesContext.current) })

        return () => {
            view.destroy()
            viewRef.current = null
        }
        // Language, readOnly and line-number toggles rebuild the editor; value/schema are synced below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [language, readOnly, showLineNumbers, variablesMode])

    // Sync external value changes without resetting history / cursor when unchanged.
    useEffect(() => {
        const view = viewRef.current
        if (!view) return
        const current = view.state.doc.toString()
        if (current !== value) {
            view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
        }
    }, [value])

    useEffect(() => {
        const view = viewRef.current
        if (view && language === "graphql") updateSchema(view, schema ?? undefined)
    }, [schema, language])

    useEffect(() => {
        const view = viewRef.current
        if (view && variablesMode)
            view.dispatch({ effects: setVariablesContext.of(variablesContext.current) })
    }, [schema, query, operationName, variablesMode])

    return <div ref={hostRef} className={`${styles.host} ${className ?? ""}`} />
}
