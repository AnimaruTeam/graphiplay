import {
    type GraphQLSchema,
    type IntrospectionQuery,
    buildClientSchema,
    getIntrospectionQuery,
} from "graphql"

export interface IntrospectResult {
    schema: GraphQLSchema
    introspection: IntrospectionQuery
}

export async function introspectEndpoint(
    url: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
): Promise<IntrospectResult> {
    const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...headers },
        body: JSON.stringify({
            query: getIntrospectionQuery({
                descriptions: true,
                specifiedByUrl: true,
                directiveIsRepeatable: true,
                schemaDescription: true,
                inputValueDeprecation: true,
            }),
            operationName: "IntrospectionQuery",
        }),
        signal,
    })
    if (!res.ok) {
        throw new Error(`Introspection failed: HTTP ${res.status} ${res.statusText}`)
    }
    const json = await res.json()
    if (json.errors?.length) {
        throw new Error(json.errors.map((e: { message: string }) => e.message).join("\n"))
    }
    if (!json.data?.__schema) {
        throw new Error("Response does not contain __schema. Is this a GraphQL endpoint?")
    }
    const introspection = json.data as IntrospectionQuery
    const schema = buildClientSchema(introspection)
    return { schema, introspection }
}
