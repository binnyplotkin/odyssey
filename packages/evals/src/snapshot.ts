import { createHash } from "node:crypto";
import type { CharacterRecord } from "@odyssey/db";
import type { CharacterSnapshot } from "./types";

/**
 * Capture a full picture of the character's authoring state at the
 * moment the eval ran. Persisting this on every EvalRun makes any
 * historical run exactly re-runnable — no need to lock baselines or
 * worry about drift between when a run was captured and now.
 *
 * The `configHash` is a stable sha256 of just the L01–L04 fields that
 * actually influence model output. Two snapshots with the same hash
 * will produce statistically identical character behavior (modulo
 * sampling temperature).
 */
export function captureCharacterSnapshot(
  character: CharacterRecord,
): CharacterSnapshot {
  // Only the four layers that mutate prompt/inference go into the hash.
  // The summary/image/eras/ingestionPrompt fields can change without
  // affecting runtime behavior.
  const hashable = {
    identity: character.identity,
    voiceStyle: character.voiceStyle,
    brainModel: character.brainModel,
    directive: character.directive,
  };

  const configHash = createHash("sha256")
    .update(stableStringify(hashable))
    .digest("hex")
    .slice(0, 16); // 16 hex chars = 64 bits — plenty for our scale

  return {
    characterId: character.id,
    characterSlug: character.slug,
    characterTitle: character.title,
    identity: character.identity,
    voiceStyle: character.voiceStyle,
    brainModel: character.brainModel,
    directive: character.directive,
    configHash,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Order-stable JSON serialization so the hash is deterministic
 * regardless of object property insertion order. Native JSON.stringify
 * preserves insertion order but that order can vary by code path; we
 * want a single canonical hash for any equivalent config.
 */
function stableStringify(value: unknown): string {
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
