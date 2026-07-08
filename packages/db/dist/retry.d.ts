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
export declare function isTransientFetchError(error: unknown): boolean;
/**
 * Up to 4 attempts with exponential backoff (80ms → 240ms → 720ms).
 * The 80→240→720 schedule was tuned against eval sweeps that fire 600+
 * reads in a narrow window — a single 80ms retry hit the same flaky
 * window, so the backoff gives Neon ~1s to recover. Total worst-case
 * extra latency: ~1s for transient cases, ~0ms for healthy cases.
 */
export declare function retryRead<T>(op: () => Promise<T>): Promise<T>;
//# sourceMappingURL=retry.d.ts.map