import { type RefObject, useLayoutEffect, useState } from "react"

export interface Size {
    width: number
    height: number
}

/** Content box of `ref`, kept up to date with a ResizeObserver. Zero until the first measure. */
export function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>): Size {
    const [size, setSize] = useState<Size>({ width: 0, height: 0 })
    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry!.contentRect
            setSize(s => (s.width === width && s.height === height ? s : { width, height }))
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [ref])
    return size
}
