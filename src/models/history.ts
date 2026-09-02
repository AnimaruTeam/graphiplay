import { createEffect, createEvent, createStore, sample } from "effector"

import { db } from "@/shared/db"
import type { HistoryEntry } from "@/shared/types"

const MAX_HISTORY = 200

export const historyAdded = createEvent<HistoryEntry>()
export const historyCleared = createEvent()
export const historyEntryDeleted = createEvent<string>()

export const $history = createStore<HistoryEntry[]>([])

export const loadHistoryFx = createEffect(() =>
    db.history.orderBy("createdAt").reverse().limit(MAX_HISTORY).toArray(),
)

const addFx = createEffect(async (entry: HistoryEntry) => {
    await db.history.add(entry)
    const count = await db.history.count()
    if (count > MAX_HISTORY) {
        const stale = await db.history
            .orderBy("createdAt")
            .limit(count - MAX_HISTORY)
            .primaryKeys()
        await db.history.bulkDelete(stale)
    }
})
const clearFx = createEffect(() => db.history.clear())
const deleteFx = createEffect((id: string) => db.history.delete(id))

$history
    .on(loadHistoryFx.doneData, (_, list) => list)
    .on(historyAdded, (list, entry) => [entry, ...list].slice(0, MAX_HISTORY))
    .on(historyEntryDeleted, (list, id) => list.filter(h => h.id !== id))
    .reset(historyCleared)

sample({ clock: historyAdded, target: addFx })
sample({ clock: historyCleared, target: clearFx })
sample({ clock: historyEntryDeleted, target: deleteFx })
