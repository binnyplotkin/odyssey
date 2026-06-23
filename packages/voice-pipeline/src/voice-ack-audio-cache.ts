const DEFAULT_TTL_MS = 2 * 60 * 1000;
const MAX_ENTRIES = 100;

export type CachedVoiceAckAudioFrame = {
  pcmFloat32Base64: string;
  samples: number;
  sampleRate: number;
};

export type CachedVoiceAckAudio = {
  key: string;
  ackText: string;
  frames: CachedVoiceAckAudioFrame[];
  totalSamples: number;
  createdAt: string;
  expiresAt: number;
};

const globalForVoiceAckAudio = globalThis as typeof globalThis & {
  __odysseyVoiceAckAudioCache?: Map<string, CachedVoiceAckAudio>;
  __odysseyVoiceAckAudioInflight?: Map<string, Promise<CachedVoiceAckAudio>>;
};

function cache() {
  if (!globalForVoiceAckAudio.__odysseyVoiceAckAudioCache) {
    globalForVoiceAckAudio.__odysseyVoiceAckAudioCache = new Map();
  }
  return globalForVoiceAckAudio.__odysseyVoiceAckAudioCache;
}

function inflight() {
  if (!globalForVoiceAckAudio.__odysseyVoiceAckAudioInflight) {
    globalForVoiceAckAudio.__odysseyVoiceAckAudioInflight = new Map();
  }
  return globalForVoiceAckAudio.__odysseyVoiceAckAudioInflight;
}

export function voiceAckAudioCacheKey(input: {
  contextCacheKey: string;
  ttsProvider: string;
  ttsVoice: string;
  ackText: string;
}): string {
  return [
    "voice-ack-audio",
    input.contextCacheKey,
    input.ttsProvider,
    input.ttsVoice,
    input.ackText,
  ].join(":");
}

export function getCachedVoiceAckAudio(key: string): CachedVoiceAckAudio | null {
  const hit = cache().get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache().delete(key);
    return null;
  }
  return hit;
}

export function startVoiceAckAudioWarm(input: {
  key: string;
  ackText: string;
  synthesize: () => Promise<CachedVoiceAckAudioFrame[]>;
}): Promise<CachedVoiceAckAudio> {
  const hit = getCachedVoiceAckAudio(input.key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight().get(input.key);
  if (pending) return pending;
  const promise = input.synthesize()
    .then((frames) => storeCachedVoiceAckAudio({
      key: input.key,
      ackText: input.ackText,
      frames,
    }))
    .finally(() => {
      inflight().delete(input.key);
    });
  inflight().set(input.key, promise);
  return promise;
}

export function storeCachedVoiceAckAudio(input: {
  key: string;
  ackText: string;
  frames: CachedVoiceAckAudioFrame[];
}): CachedVoiceAckAudio {
  if (input.frames.length === 0) {
    throw new Error("Cannot cache empty acknowledgement audio.");
  }
  const now = Date.now();
  const entry: CachedVoiceAckAudio = {
    key: input.key,
    ackText: input.ackText,
    frames: input.frames,
    totalSamples: input.frames.reduce((sum, frame) => sum + frame.samples, 0),
    createdAt: new Date(now).toISOString(),
    expiresAt: now + DEFAULT_TTL_MS,
  };
  const store = cache();
  store.set(entry.key, entry);
  evictOldest(store);
  return entry;
}

export function clearVoiceAckAudioCache() {
  cache().clear();
  inflight().clear();
}

function evictOldest(store: Map<string, CachedVoiceAckAudio>) {
  if (store.size <= MAX_ENTRIES) return;
  const entries = Array.from(store.entries()).sort(
    (a, b) => a[1].expiresAt - b[1].expiresAt,
  );
  for (const [key] of entries.slice(0, store.size - MAX_ENTRIES)) {
    store.delete(key);
  }
}
