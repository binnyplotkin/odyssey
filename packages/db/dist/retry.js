/**
 * Shared retry helper for the Neon serverless HTTP driver.
 *
 * Neon's serverless transport occasionally fails mid-flight — connections
 * are short-lived HTTP requests routed through an edge proxy, and the
 * socket layer can drop with `ECONNRESET` / `fetch failed` / a generic
 * `"Failed query:"` wrapper. A single transient blip is enough to abort
 * an entire ingestion op or eval probe, which is far worse than the
 * cost of one extra round-trip.
 *
 * Apply only to reads. Retrying writes risks double-applying when the
 * server actually executed the first attempt but the response was lost.
 */
export function isTransientFetchError(error) {
    var _a, _b;
    if (!error || typeof error !== "object")
        return false;
    const candidates = [
        error,
        error.cause,
        error.sourceError,
    ];
    for (const c of candidates) {
        if (!c || typeof c !== "object")
            continue;
        const code = (_a = c.code) !== null && _a !== void 0 ? _a : "";
        if (code === "ECONNRESET" ||
            code === "ECONNREFUSED" ||
            code === "ETIMEDOUT" ||
            code === "ENETUNREACH" ||
            code === "EAI_AGAIN") {
            return true;
        }
        const message = (_b = c.message) !== null && _b !== void 0 ? _b : "";
        if (message.includes("fetch failed") || message.startsWith("Failed query:"))
            return true;
    }
    return false;
}
/**
 * Up to 4 attempts with exponential backoff (80ms → 240ms → 720ms).
 * The 80→240→720 schedule was tuned against eval sweeps that fire 600+
 * reads in a narrow window — a single 80ms retry hit the same flaky
 * window, so the backoff gives Neon ~1s to recover. Total worst-case
 * extra latency: ~1s for transient cases, ~0ms for healthy cases.
 */
export async function retryRead(op) {
    const delays = [80, 240, 720];
    let lastError;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
            return await op();
        }
        catch (error) {
            lastError = error;
            if (!isTransientFetchError(error))
                throw error;
            if (attempt === delays.length)
                break;
            await new Promise((r) => setTimeout(r, delays[attempt]));
        }
    }
    throw lastError;
}
