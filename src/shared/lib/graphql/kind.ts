import {
    type GraphQLType,
    getNamedType,
    isEnumType,
    isInputObjectType,
    isScalarType,
} from "graphql"

/**
 * Colour group a type name is painted with, everywhere a type is shown (editor,
 * hover docs, schema explorer): scalars, composite output types (object /
 * interface / union) and input-side types (input objects and enums).
 */
export type TypeGroup = "scalar" | "object" | "input"

export function typeGroup(type: GraphQLType | null | undefined): TypeGroup {
    if (!type) return "object"
    const named = getNamedType(type)
    if (isScalarType(named)) return "scalar"
    if (isInputObjectType(named) || isEnumType(named)) return "input"
    return "object"
}

/**
 * Global class that paints a type name for its group (defined in `global.css`). Use it
 * wherever a type name is rendered so every panel agrees; the editor mirrors the same
 * colours through its own theme.
 */
export const typeGroupClass = (type: GraphQLType | null | undefined) => `gp-t-${typeGroup(type)}`
