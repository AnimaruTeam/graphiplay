import { useUnit } from "effector-react"
import { type GraphQLType, getNamedType } from "graphql"

import { docsPushed } from "@/models"

import styles from "./SchemaExplorer.module.css"

export function TypeLink({ type }: { type: GraphQLType }) {
    const push = useUnit(docsPushed)
    const named = getNamedType(type)
    const str = type.toString()
    const idx = str.indexOf(named.name)
    const before = str.slice(0, idx)
    const after = str.slice(idx + named.name.length)
    // Rendered as a span (not a button) so it can sit inside clickable rows.
    const go = (e: React.SyntheticEvent) => {
        e.stopPropagation()
        push({ kind: "type", name: named.name })
    }
    return (
        <span className={styles.typeRef}>
            {before && <span className={styles.typeWrap}>{before}</span>}
            <span
                role="link"
                tabIndex={0}
                className={styles.typeLink}
                onClick={go}
                onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        go(e)
                    }
                }}
            >
                {named.name}
            </span>
            {after && <span className={styles.typeWrap}>{after}</span>}
        </span>
    )
}
