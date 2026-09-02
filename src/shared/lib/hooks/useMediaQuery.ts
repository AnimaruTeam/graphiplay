import { useSyncExternalStore } from "react"

/** Keep in sync with the `@media (max-width: 767px)` blocks in *.module.css. */
export const MOBILE_QUERY = "(max-width: 767px)"

export function useMediaQuery(query: string): boolean {
    return useSyncExternalStore(
        onChange => {
            const media = window.matchMedia(query)
            media.addEventListener("change", onChange)
            return () => media.removeEventListener("change", onChange)
        },
        () => window.matchMedia(query).matches,
        () => false,
    )
}

/** Phone layout: bottom navigation, sidebar as an overlay, editor/response as swipeable views. */
export const useIsMobile = () => useMediaQuery(MOBILE_QUERY)

/** Primary input is a finger (phones, tablets) — no hover, no right click, long press instead. */
export const useIsTouch = () => useMediaQuery("(hover: none) and (pointer: coarse)")
