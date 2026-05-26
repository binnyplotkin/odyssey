/**
 * Order-stable FNV-1a hash + stableStringify pair used by the harness
 * history endpoints (identity / directive / voice-style / brain-model).
 *
 * Why a custom hash, not crypto.subtle? The values are short (well
 * under 4KB) and we don't need collision resistance — just grouping
 * stability. crypto.subtle is async-only in Node 20 (fine but heavier
 * than needed) and importing node:crypto for sync sha256 dwarfs this
 * for our payload sizes. FNV-1a is good enough at scale ≪ 2^32 distinct
 * snapshots per character.
 *
 * Why a separate module? Each history endpoint is independently
 * reachable, and the API surface should compose without each one
 * pulling its own copy. Extracted in L03-8.
 */

/**
 * Hash any JSON-shaped value into a stable 8-char hex string. Two
 * equivalent shapes (same keys/values, regardless of key insertion
 * order) hash to the same value. Returns the literal string "null"
 * for null input — readable in URLs and revert-button keys.
 */
export function hashShape(value: unknown): string {
  if (value === null || value === undefined) return "null";
  let hash = 0x811c9dc5;
  const str = stableStringify(value);
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Recursive JSON serialization with sorted object keys. Native
 * JSON.stringify preserves insertion order, which can vary per
 * write path (e.g. jsonb round-trips through Postgres may rearrange);
 * this gives us a canonical form so two equivalent shapes always
 * produce the same hash input.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k]),
  );
  return "{" + pairs.join(",") + "}";
}
