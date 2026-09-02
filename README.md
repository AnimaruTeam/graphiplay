# Graphiplay

A custom GraphQL playground in the spirit of Apollo Studio / Hive Laboratory — React + effector +
CSS modules, everything stored locally in the browser (IndexedDB). Light and dark themes (follows
the system by default) in the Animaru visual language: neutral surfaces, one violet accent, Inter +
JetBrains Mono.

Ships as an **embeddable library**: drop it into any page with two CDN tags, or use it as a React
component.

## Embedding

### CDN (any page, no build step)

```html
<link rel="stylesheet" href="https://unpkg.com/@animaru/graphiplay/dist/graphiplay.css" />
<div id="playground" style="height: 100vh"></div>

<script src="https://unpkg.com/@animaru/graphiplay/dist/graphiplay.min.js"></script>
<script>
    Graphiplay.mount("#playground", {
        endpoint: "https://countries.trevorblades.com/graphql",
        headers: { Authorization: "Bearer …" },
        theme: "system",
        defaultQuery: "{ countries { code name } }",
    })
</script>
```

`graphiplay.min.js` is self-contained (React included) and exposes a global `Graphiplay`. `mount()`
returns `{ unmount() }`. The playground fills whatever box you give it — set a height on the
container. See [examples/cdn.html](examples/cdn.html).

### npm / React

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

The ESM build treats `react` / `react-dom` (18 or 19) as peer dependencies. `mount()` is exported
here too for non-React apps that still use a bundler.

### Options

All optional; anything not given comes from what the user persisted last time.

| Option             | Type                            | Meaning                                                                              |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------------ |
| `endpoint`         | `string`                        | GraphQL URL to open. Overrides the last used one.                                    |
| `headers`          | `Record<string, string>`        | Persistent headers for that endpoint — sent with every request and introspection.    |
| `wsUrl`            | `string`                        | WebSocket URL for subscriptions (defaults to the endpoint with a `ws(s)://` scheme). |
| `theme`            | `"light" \| "dark" \| "system"` | Overrides the persisted theme choice.                                                |
| `defaultQuery`     | `string`                        | Opened in a tab when the workspace has no operations yet.                            |
| `defaultVariables` | `string`                        | JSON for `defaultQuery`.                                                             |
| `globalShortcuts`  | `boolean`                       | Fire ⌘K / ⌘↵ / ⌘B anywhere on the page. Off by default: only while focus is inside.  |

Notes:

- **One playground per page.** State lives in module-level stores and one IndexedDB database; two
  instances would share it.
- **Nothing leaks into the host.** All styles are scoped to the `.graphiplay` root, the theme
  attribute lives on it, overlays (modals, palette, toasts, context menus) render inside it. The
  host `<html>`/`<body>` are never touched.
- **Fonts.** The UI is designed for Inter + JetBrains Mono and falls back to system fonts. Add the
  Google Fonts link (see the example) if you want the intended look.
- **Storage is shared with the standalone app** — tabs, collections and history for an endpoint are
  the same wherever the playground is opened on that origin.

## Development

```sh
pnpm install
pnpm dev          # standalone page, http://localhost:5173
pnpm build        # typecheck + dist/graphiplay.js (ESM) + dist/graphiplay.min.js (CDN) + css + .d.ts
pnpm build:site   # standalone page → site/
```

## Features

- **Endpoint bar** — URL with live schema status, saved endpoints, one‑click re‑introspection.
- **Workspaces per URL** — tabs, collections, persistent headers, subscription settings and the
  cached schema all belong to the endpoint URL. Committing a different URL (Enter / blur, or picking
  a saved endpoint) swaps the whole workspace; switching back restores it as you left it.
- **Persistent headers** (rail → key icon) — sent with every request _and_ introspection; **per‑tab
  headers** override them for a single request. Both support bulk JSON editing.
- **Schema explorer** — browse root types, objects, inputs, enums, interfaces, unions, scalars;
  drill into fields/args, search across the schema, or view the whole SDL with syntax highlighting.
- **Operations panel** — every query / mutation / subscription with a highlighted, generated
  preview; insert into the editor or open in a new tab.
- **Editor** — CodeMirror 6 with GraphQL autocompletion, linting, folding; JSON variables editor
  type‑checked against the query's declarations (unused keys dimmed, missing/invalid values flagged
  with quick fixes), with hover docs and key/value completion; prettify, multi‑operation picker.
- **Tabs** — new tabs open first; drag to reorder, drag onto a collection (or onto the “new
  collection” zone) to save; right‑click for a context menu with run / rename / duplicate /
  save‑or‑move to collection / close actions.
- **Response** — highlighted JSON, HTTP status, duration, size; subscriptions stream live over
  `graphql-ws` (or SSE, switchable in endpoint settings).
- **Collections** — save operations (query + variables + headers) into colour‑coded collections;
  tabs stay linked so `⌘S` updates the saved item.
- **History** — the last 200 requests, grouped by day, one click to replay.
- **Command palette** (`⌘K`) — jump to operations, types, collections, tabs and actions.
- **Themes** — light / dark / system toggle in the top bar; all colours (including syntax
  highlighting) come from CSS variables in `src/styles/global.css`.
- **Responsive** — the top bar sheds status text / labels / shortcuts in stages (1320 → 1000 →
  900px); the sidebar is capped so the workspace keeps ≥ 400px; editor and response stack vertically
  when the workspace is narrower than 680px (measured, not viewport‑based); the editor and response
  toolbars adapt to their own pane width via `@container`.
- **Phone layout** (< 768px, `useIsMobile` + `@media (max-width: 767px)`) — panels move to a bottom
  navigation bar and open full‑screen, editor and response become a Query / Response switcher
  (auto‑jumps to Response on run), modals turn into bottom sheets, long‑press on a tab opens its
  menu.

## Shortcuts

| Keys                    | Action                                  |
| ----------------------- | --------------------------------------- |
| `⌘/Ctrl ↵`              | Run / stop                              |
| `⌘/Ctrl S`              | Save to collection / update linked item |
| `⌘/Ctrl K`              | Command palette                         |
| `Shift Alt F`           | Prettify                                |
| `⌘/Ctrl T` / `⌘/Ctrl W` | New / close tab                         |
| `⌘/Ctrl B`              | Toggle sidebar                          |

## Layout

```
src/
  app/            App shell, global shortcuts, ambient background
  components/     Reusable UI — each folder is Component.tsx + Component.module.css
  screens/        Panels & screens (TopBar, Rail, Sidebar, Workspace, …), same convention
  models/         effector stores/events/effects (endpoint, schema, tabs, collections, history, execution, ui)
  shared/         types, Dexie DB, GraphQL helpers, CodeMirror theme
  styles/         global.css — design tokens + CodeMirror overrides
```
