import { type Event, type Store, createEvent } from "effector"

/** Emits the latest store value after `ms` of silence. */
export function debounce<T>(source: Store<T>, ms: number): Event<T> {
    const out = createEvent<T>()
    let timer: ReturnType<typeof setTimeout> | null = null
    source.updates.watch(value => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => out(value), ms)
    })
    return out
}
