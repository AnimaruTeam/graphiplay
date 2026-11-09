import type { BodyCompression } from "@/shared/types"

/** Content-Encoding for request bodies. "deflate" is the zlib format HTTP means by it. */
export type RequestCompression = "none" | "gzip" | "deflate"

export const REQUEST_COMPRESSIONS: RequestCompression[] = ["none", "gzip", "deflate"]

export const canCompressRequests = typeof CompressionStream === "function"

export interface EncodedBody {
    body: string | Uint8Array<ArrayBuffer>
    compression: BodyCompression | null
}

export async function encodeBody(
    text: string,
    compression: RequestCompression,
): Promise<EncodedBody> {
    if (compression === "none" || !canCompressRequests) return { body: text, compression: null }
    const raw = new TextEncoder().encode(text)
    const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream(compression))
    const body = new Uint8Array(await new Response(stream).arrayBuffer())
    return {
        body,
        compression: { encoding: compression, size: raw.byteLength, encodedSize: body.byteLength },
    }
}

/** `headers` with Content-Encoding set to `encoding`, replacing a user-typed one in any case. */
export function withContentEncoding(
    headers: Record<string, string>,
    encoding: string | undefined,
): Record<string, string> {
    if (!encoding) return headers
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() !== "content-encoding") out[key] = value
    }
    out["content-encoding"] = encoding
    return out
}

export interface ResourceTimingWatch {
    /** The entry of the fetch started after the watch began; call once the body is read. */
    entry: () => PerformanceResourceTiming | undefined
    stop: () => void
}

/**
 * Catches the Resource Timing entry of a fetch about to be made to `url`. An observer rather
 * than `getEntriesByName`, because the host page may have filled the global entry buffer.
 */
export function watchResourceTiming(url: string): ResourceTimingWatch {
    const none: ResourceTimingWatch = { entry: () => undefined, stop: () => {} }
    if (typeof PerformanceObserver === "undefined") return none
    let name: string
    try {
        name = new URL(url, document.baseURI).href
    } catch {
        return none
    }
    const since = performance.now()
    const seen: PerformanceEntry[] = []
    const observer = new PerformanceObserver(list => {
        seen.push(...list.getEntries())
    })
    try {
        observer.observe({ type: "resource" })
    } catch {
        return none
    }
    return {
        entry: () => {
            seen.push(...observer.takeRecords())
            // Earliest one after `since`: a background request to the same URL (schema
            // polling) either started before it or after ours.
            return (seen as PerformanceResourceTiming[])
                .filter(e => e.name === name && e.initiatorType === "fetch" && e.startTime >= since)
                .sort((a, b) => a.startTime - b.startTime)[0]
        },
        stop: () => observer.disconnect(),
    }
}

/**
 * How the response body was compressed, or null when it wasn't (or nothing tells).
 *
 * Cross-origin, the encoding needs `Access-Control-Expose-Headers: Content-Encoding`, and the
 * Resource Timing sizes need `Timing-Allow-Origin` — otherwise Content-Length, which is always
 * readable, is the size on the wire when the server sends it.
 */
export function responseCompression(
    res: Response,
    timing: PerformanceResourceTiming | undefined,
    size: number,
): BodyCompression | null {
    const header = res.headers.get("content-encoding")?.trim().toLowerCase()
    const contentLength = Number(res.headers.get("content-length") ?? NaN)
    const encodedSize =
        timing && timing.decodedBodySize > 0
            ? timing.encodedBodySize
            : Number.isFinite(contentLength) && contentLength >= 0
              ? contentLength
              : null
    const encoding =
        header && header !== "identity"
            ? header
            : encodedSize != null && encodedSize < size
              ? "compressed"
              : null
    return encoding ? { encoding, size, encodedSize } : null
}
