import type { TimeIndex } from "@odyssey/db";
import {
  curate,
  type CurateResult,
  type Scene,
  type SemanticSeed,
} from "@odyssey/wiki-curator";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 200;

export type SandboxVoiceContextCacheEntry = CurateResult & {
  key: string;
  characterId: string;
  sessionId: string | null;
  scene: Scene | undefined;
  tokenBudget: number;
  sourceQuery: string | null;
  builtAt: string;
  expiresAt: number;
  cacheScope: "session" | "character";
};

type CacheLookup = {
  characterId: string;
  sessionId?: string | null;
  scene?: Scene;
  tokenBudget: number;
  /** Scene knowledge horizon — part of the cache key: a context curated for
   *  one dramatic present must never serve a turn with another (or none). */
  currentMoment?: TimeIndex | null;
};

type CacheBuildInput = CacheLookup & {
  query?: string;
  semanticSeeds?: SemanticSeed[];
  /** Drop the voice_identity sheet from the curated context (persona lives in the envelope). */
  excludeVoiceIdentity?: boolean;
};

const globalForSandboxVoiceCache = globalThis as typeof globalThis & {
  __odysseySandboxVoiceContextCache?: Map<string, SandboxVoiceContextCacheEntry>;
  __odysseySandboxVoiceContextInflight?: Map<string, Promise<SandboxVoiceContextCacheEntry>>;
};

function cache() {
  if (!globalForSandboxVoiceCache.__odysseySandboxVoiceContextCache) {
    globalForSandboxVoiceCache.__odysseySandboxVoiceContextCache = new Map();
  }
  return globalForSandboxVoiceCache.__odysseySandboxVoiceContextCache;
}

function inflight() {
  if (!globalForSandboxVoiceCache.__odysseySandboxVoiceContextInflight) {
    globalForSandboxVoiceCache.__odysseySandboxVoiceContextInflight = new Map();
  }
  return globalForSandboxVoiceCache.__odysseySandboxVoiceContextInflight;
}

export function getSandboxVoiceContextCache(
  lookup: CacheLookup,
): SandboxVoiceContextCacheEntry | null {
  const now = Date.now();
  const keys = candidateKeys(lookup);
  const store = cache();
  for (const key of keys) {
    const hit = store.get(key);
    if (!hit) continue;
    if (hit.expiresAt <= now) {
      store.delete(key);
      continue;
    }
    return hit;
  }
  return null;
}

export async function getOrWaitSandboxVoiceContextCache(
  lookup: CacheLookup,
  waitMs: number,
): Promise<SandboxVoiceContextCacheEntry | null> {
  const hit = getSandboxVoiceContextCache(lookup);
  if (hit || waitMs <= 0) return hit;
  const pending = candidateKeys(lookup)
    .map((key) => inflight().get(key))
    .find(Boolean);
  if (!pending) return null;
  return Promise.race([
    pending.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs)),
  ]);
}

export function startSandboxVoiceContextCacheWarm(
  input: CacheBuildInput,
): Promise<SandboxVoiceContextCacheEntry> {
  const key = cacheKey({
    characterId: input.characterId,
    sessionId: input.sessionId,
    scene: input.scene,
    tokenBudget: input.tokenBudget,
    currentMoment: input.currentMoment,
  });
  const pending = inflight().get(key);
  if (pending) return pending;
  const promise = buildAndStoreSandboxVoiceContextCache(input).finally(() => {
    inflight().delete(key);
  });
  inflight().set(key, promise);
  return promise;
}

export async function buildAndStoreSandboxVoiceContextCache(
  input: CacheBuildInput,
): Promise<SandboxVoiceContextCacheEntry> {
  const tokenBudget = input.tokenBudget;
  const result = await curate({
    characterId: input.characterId,
    query: input.query?.trim() || undefined,
    scene: input.scene,
    semanticSeeds: input.semanticSeeds,
    tokenBudget,
    excludeVoiceIdentity: input.excludeVoiceIdentity,
    currentMoment: input.currentMoment ?? undefined,
  });
  return storeSandboxVoiceContextCache({
    ...input,
    tokenBudget,
    result,
  });
}

export function storeSandboxVoiceContextCache(input: CacheBuildInput & {
  result: CurateResult;
}): SandboxVoiceContextCacheEntry {
  const now = Date.now();
  const sessionId = input.sessionId?.trim() || null;
  const entry: SandboxVoiceContextCacheEntry = {
    ...input.result,
    key: cacheKey({
      characterId: input.characterId,
      sessionId,
      scene: input.scene,
      tokenBudget: input.tokenBudget,
      currentMoment: input.currentMoment,
    }),
    characterId: input.characterId,
    sessionId,
    scene: normalizeScene(input.scene),
    tokenBudget: input.tokenBudget,
    sourceQuery: input.query?.trim() || null,
    builtAt: new Date(now).toISOString(),
    expiresAt: now + DEFAULT_TTL_MS,
    cacheScope: sessionId ? "session" : "character",
  };
  const store = cache();
  store.set(entry.key, entry);
  evictOldest(store);
  return entry;
}

export function clearSandboxVoiceContextCache() {
  cache().clear();
  inflight().clear();
}

export function sandboxVoiceContextCacheKeyForDebug(lookup: CacheLookup): string {
  return cacheKey(lookup);
}

function candidateKeys(lookup: CacheLookup): string[] {
  const sessionId = lookup.sessionId?.trim() || null;
  const keys: string[] = [];
  if (sessionId) keys.push(cacheKey({ ...lookup, sessionId }));
  keys.push(cacheKey({ ...lookup, sessionId: null }));
  if (lookup.scene) {
    if (sessionId) keys.push(cacheKey({ ...lookup, sessionId, scene: undefined }));
    keys.push(cacheKey({ ...lookup, sessionId: null, scene: undefined }));
  }
  return keys;
}

function cacheKey(lookup: CacheLookup): string {
  return [
    "sandbox-voice-context",
    lookup.characterId,
    lookup.sessionId?.trim() || "character",
    lookup.tokenBudget,
    stableJson(normalizeScene(lookup.scene) ?? {}),
    // Horizoned and horizon-less contexts are curated from different page
    // pools — never let one satisfy the other's lookup.
    stableJson(lookup.currentMoment ?? null),
  ].join(":");
}

function normalizeScene(scene: Scene | undefined): Scene | undefined {
  if (!scene) return undefined;
  const activeEntities = Array.from(
    new Set((scene.activeEntities ?? []).map((value) => value.trim()).filter(Boolean)),
  ).sort();
  const location = scene.location?.trim() || undefined;
  if (activeEntities.length === 0 && !location) return undefined;
  return {
    ...(activeEntities.length ? { activeEntities } : {}),
    ...(location ? { location } : {}),
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function evictOldest(store: Map<string, SandboxVoiceContextCacheEntry>) {
  if (store.size <= MAX_ENTRIES) return;
  const entries = Array.from(store.entries()).sort(
    (a, b) => a[1].expiresAt - b[1].expiresAt,
  );
  for (const [key] of entries.slice(0, store.size - MAX_ENTRIES)) {
    store.delete(key);
  }
}
