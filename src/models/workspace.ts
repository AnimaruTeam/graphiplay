import { createEffect, sample } from "effector"

import { loadCollectionsFx } from "./collections"
import { loadWorkspaceSettingsFx, workspaceSwitched } from "./endpoint"
import { loadCachedSchemaFx } from "./schema"
import { loadTabsFx } from "./tabs"

/**
 * Load everything scoped to an endpoint URL. Settings go first: when nothing is
 * cached the schema gets introspected, and that must use this workspace's headers.
 * Each loader ignores its own result if the workspace changed again meanwhile.
 */
export const loadWorkspaceFx = createEffect(async (url: string) => {
    await loadWorkspaceSettingsFx(url)
    await Promise.all([loadTabsFx(url), loadCollectionsFx(url), loadCachedSchemaFx(url)])
})

sample({ clock: workspaceSwitched, target: loadWorkspaceFx })
