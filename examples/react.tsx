// npm i @animaru/graphiplay react react-dom
import { Graphiplay } from "@animaru/graphiplay"
import "@animaru/graphiplay/graphiplay.css"

export function ApiPlayground() {
    return (
        <div style={{ height: "100vh" }}>
            <Graphiplay
                endpoint="https://countries.trevorblades.com/graphql"
                headers={{ Authorization: "Bearer …" }}
                theme="dark"
                defaultQuery={"{ countries { code name } }"}
            />
        </div>
    )
}
