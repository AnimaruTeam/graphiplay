# Graphiplay

An embeddable GraphQL playground. Schema explorer, editor with autocompletion, collections, history,
subscriptions — everything stored locally in the browser. Light and dark themes, follows the system
by default.

Drop it into any page with two CDN tags, or use it as a React component.

## CDN

```html
<link rel="stylesheet" href="https://unpkg.com/@animaru/graphiplay/dist/graphiplay.css" />
<div id="playground" style="height: 100vh"></div>

<script src="https://unpkg.com/@animaru/graphiplay/dist/graphiplay.min.js"></script>
<script>
    Graphiplay.mount("#playground", {
        endpoint: "https://api.example.com/graphql",
        headers: { Authorization: "Bearer …" },
        theme: "system",
        defaultQuery: "{ countries { code name } }",
    })
</script>
```

The script is self-contained (React included) and exposes a global `Graphiplay`. `mount()` returns
`{ unmount() }`. The playground fills whatever box you give it — set a height on the container.

## npm / React

```sh
npm i @animaru/graphiplay
```

```tsx
import { Graphiplay } from "@animaru/graphiplay"
import "@animaru/graphiplay/graphiplay.css"

;<div style={{ height: "100vh" }}>
    <Graphiplay endpoint="https://api.example.com/graphql" theme="dark" />
</div>
```

`react` / `react-dom` 18 or 19 are peer dependencies. `mount()` is exported here too for apps
without React.

## Options

All optional. Anything not given comes from what the user persisted last time.

| Option             | Type                            | Meaning                                                                              |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------------ |
| `endpoint`         | `string`                        | GraphQL URL to open. Overrides the last used one.                                    |
| `headers`          | `Record<string, string>`        | Persistent headers for that endpoint — sent with every request and introspection.    |
| `wsUrl`            | `string`                        | WebSocket URL for subscriptions (defaults to the endpoint with a `ws(s)://` scheme). |
| `theme`            | `"light" \| "dark" \| "system"` | Overrides the persisted theme choice.                                                |
| `defaultQuery`     | `string`                        | Opened in a tab when the workspace has no operations yet.                            |
| `defaultVariables` | `string`                        | JSON for `defaultQuery`.                                                             |
| `globalShortcuts`  | `boolean`                       | Fire ⌘K / ⌘↵ / ⌘B anywhere on the page. Off by default: only while focus is inside.  |

Good to know:

- **One playground per page.** Two instances would share state.
- **Nothing leaks into the host page.** Styles, theme and overlays stay inside the playground's
  container.
- **Fonts.** Designed for Inter + JetBrains Mono, falls back to system fonts. Add a Google Fonts
  link for the intended look.
- **Storage is per origin.** Tabs, collections and history for an endpoint are shared between every
  page on the same origin that embeds the playground.

## Features

- **Endpoint bar** — URL with live schema status, saved endpoints, one‑click re‑introspection.
- **Workspaces per URL** — tabs, collections, headers, subscription settings and the cached schema
  belong to the endpoint URL. Switching URL swaps the whole workspace; switching back restores it.
- **Headers** — persistent per endpoint, sent with every request and introspection; per‑tab headers
  override them for a single request. Both support bulk JSON editing.
- **Schema explorer** — browse root types, objects, inputs, enums, interfaces, unions, scalars;
  drill into fields and arguments, search across the schema, view the whole SDL.
- **Operations panel** — every query / mutation / subscription with a generated preview; insert into
  the editor or open in a new tab.
- **Editor** — GraphQL autocompletion, linting, folding, hover docs (`Esc` dismisses them),
  prettify, multi‑operation picker. Operation keywords and type names are colour‑coded by kind.
  Variables are type‑checked against the query: keys the running operation doesn't declare are
  greyed out, missing or invalid values flagged with quick fixes.
- **Tabs** — drag to reorder, drag onto a collection to save, right‑click for run / rename /
  duplicate / save / close.
- **Response** — highlighted JSON, HTTP status, duration, size, and a Headers tab with everything
  the server sent back. Subscriptions stream live over WebSocket or SSE.
- **Collections** — save operations (query + variables + headers) into color‑coded collections; tabs
  stay linked so `⌘S` updates the saved item.
- **History** — the last 200 requests, grouped by day, one click to replay.
- **Command palette** (`⌘K`) — jump to operations, types, collections, tabs and actions.
- **Responsive** — editor and response stack when the workspace is narrow; on phones panels move to
  a bottom bar, modals become bottom sheets.

## Shortcuts

| Keys              | Action                                  |
| ----------------- | --------------------------------------- |
| `⌘/Ctrl ↵`        | Run / stop                              |
| `⌘/Ctrl S`        | Save to collection / update linked item |
| `⌘/Ctrl K`        | Command palette                         |
| `⌘/Ctrl B`        | Toggle sidebar                          |
| `Shift Alt F`     | Prettify                                |
| `Alt T` / `Alt W` | New / close tab                         |
| `Alt Space`       | Suggest fields & types at the cursor    |
