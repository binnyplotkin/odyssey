"use client";

function utf8Encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function utf8Decode(input: Uint8Array): string {
  return new TextDecoder().decode(input);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function encodeNumber(value: number): Uint8Array {
  if (Number.isInteger(value) && value >= 0 && value <= 0x7f) {
    return Uint8Array.of(value);
  }
  if (Number.isInteger(value) && value >= -32 && value < 0) {
    return Uint8Array.of(0xe0 | (value + 32));
  }
  if (Number.isInteger(value) && value >= 0 && value <= 0xff) {
    return Uint8Array.of(0xcc, value);
  }
  if (Number.isInteger(value) && value >= -0x80 && value <= 0x7f) {
    return Uint8Array.of(0xd0, value & 0xff);
  }
  if (Number.isInteger(value) && value >= 0 && value <= 0xffff) {
    return Uint8Array.of(0xcd, (value >> 8) & 0xff, value & 0xff);
  }
  if (Number.isInteger(value) && value >= -0x8000 && value <= 0x7fff) {
    return Uint8Array.of(0xd1, (value >> 8) & 0xff, value & 0xff);
  }
  const buffer = new ArrayBuffer(9);
  const view = new DataView(buffer);
  view.setUint8(0, 0xcb);
  view.setFloat64(1, value, false);
  return new Uint8Array(buffer);
}

function encodeArrayHeader(length: number): Uint8Array {
  if (length <= 15) {
    return Uint8Array.of(0x90 | length);
  }
  if (length <= 0xffff) {
    return Uint8Array.of(0xdc, (length >> 8) & 0xff, length & 0xff);
  }
  return Uint8Array.of(
    0xdd,
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
  );
}

function encodeString(value: string): Uint8Array {
  const bytes = utf8Encode(value);
  const length = bytes.length;
  if (length <= 31) {
    return concatBytes([Uint8Array.of(0xa0 | length), bytes]);
  }
  if (length <= 0xff) {
    return concatBytes([Uint8Array.of(0xd9, length), bytes]);
  }
  if (length <= 0xffff) {
    return concatBytes([Uint8Array.of(0xda, (length >> 8) & 0xff, length & 0xff), bytes]);
  }
  return concatBytes([
    Uint8Array.of(0xdb, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff),
    bytes,
  ]);
}

export function msgpackEncode(value: unknown): Uint8Array {
  if (value === null || value === undefined) {
    return Uint8Array.of(0xc0);
  }
  if (typeof value === "boolean") {
    return Uint8Array.of(value ? 0xc3 : 0xc2);
  }
  if (typeof value === "number") {
    return encodeNumber(value);
  }
  if (typeof value === "string") {
    return encodeString(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((entry) => msgpackEncode(entry));
    const length = items.length;
    const header = encodeArrayHeader(length);
    return concatBytes([header, ...items]);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    const length = entries.length;
    let header: Uint8Array;
    if (length <= 15) {
      header = Uint8Array.of(0x80 | length);
    } else if (length <= 0xffff) {
      header = Uint8Array.of(0xde, (length >> 8) & 0xff, length & 0xff);
    } else {
      header = Uint8Array.of(
        0xdf,
        (length >>> 24) & 0xff,
        (length >>> 16) & 0xff,
        (length >>> 8) & 0xff,
        length & 0xff,
      );
    }
    const chunks: Uint8Array[] = [header];
    for (const [key, entryValue] of entries) {
      chunks.push(encodeString(key));
      chunks.push(msgpackEncode(entryValue));
    }
    return concatBytes(chunks);
  }
  throw new Error("Unsupported MessagePack value.");
}

export function msgpackEncodeAudioFrame(samples: Float32Array): Uint8Array {
  const sampleBytes = new Uint8Array(samples.length * 5);
  const sampleView = new DataView(
    sampleBytes.buffer,
    sampleBytes.byteOffset,
    sampleBytes.byteLength,
  );
  for (let i = 0; i < samples.length; i += 1) {
    const offset = i * 5;
    sampleView.setUint8(offset, 0xca);
    sampleView.setFloat32(offset + 1, samples[i], false);
  }
  const chunks: Uint8Array[] = [
    Uint8Array.of(0x82),
    encodeString("type"),
    encodeString("Audio"),
    encodeString("pcm"),
    encodeArrayHeader(samples.length),
    sampleBytes,
  ];
  return concatBytes(chunks);
}

export function msgpackDecode(bytes: Uint8Array): unknown {
  let offset = 0;

  const read = (): unknown => {
    const prefix = bytes[offset++];
    if (prefix <= 0x7f) return prefix;
    if ((prefix & 0xe0) === 0xa0) {
      const length = prefix & 0x1f;
      const out = utf8Decode(bytes.subarray(offset, offset + length));
      offset += length;
      return out;
    }
    if ((prefix & 0xf0) === 0x90) {
      const length = prefix & 0x0f;
      const out: unknown[] = [];
      for (let i = 0; i < length; i += 1) out.push(read());
      return out;
    }
    if ((prefix & 0xf0) === 0x80) {
      const length = prefix & 0x0f;
      const out: Record<string, unknown> = {};
      for (let i = 0; i < length; i += 1) {
        const key = read();
        out[String(key)] = read();
      }
      return out;
    }
    if (prefix >= 0xe0) return prefix - 0x100;
    switch (prefix) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xcc: {
        return bytes[offset++];
      }
      case 0xcd: {
        const value = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        return value;
      }
      case 0xd0: {
        const value = (bytes[offset] << 24) >> 24;
        offset += 1;
        return value;
      }
      case 0xd1: {
        const value = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        return (value << 16) >> 16;
      }
      case 0xd9: {
        const length = bytes[offset++];
        const out = utf8Decode(bytes.subarray(offset, offset + length));
        offset += length;
        return out;
      }
      case 0xda: {
        const length = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        const out = utf8Decode(bytes.subarray(offset, offset + length));
        offset += length;
        return out;
      }
      case 0xdb: {
        const length =
          (bytes[offset] << 24) |
          (bytes[offset + 1] << 16) |
          (bytes[offset + 2] << 8) |
          bytes[offset + 3];
        offset += 4;
        const out = utf8Decode(bytes.subarray(offset, offset + length));
        offset += length;
        return out;
      }
      case 0xdc: {
        const length = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        const out: unknown[] = [];
        for (let i = 0; i < length; i += 1) out.push(read());
        return out;
      }
      case 0xde: {
        const length = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        const out: Record<string, unknown> = {};
        for (let i = 0; i < length; i += 1) {
          const key = read();
          out[String(key)] = read();
        }
        return out;
      }
      case 0xca: {
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
        const value = view.getFloat32(0, false);
        offset += 4;
        return value;
      }
      case 0xcb: {
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
        const value = view.getFloat64(0, false);
        offset += 8;
        return value;
      }
      default:
        throw new Error(`Unsupported MessagePack prefix 0x${prefix.toString(16)}.`);
    }
  };

  const value = read();
  if (offset !== bytes.length) {
    throw new Error("Unexpected trailing MessagePack bytes.");
  }
  return value;
}

export const MOSHI_WS_URL =
  "wss://binnyplotkin--audio-rt-moshi-server-serve.modal.run/api/asr-streaming?auth_id=public_token";

export const MOSHI_TTS_BASE_URL =
  "wss://binnyplotkin--audio-rt-moshi-tts-serve.modal.run/api/tts_streaming";

/** HTTP origin (no path) — used to GET the container root for prewarm. */
export const MOSHI_TTS_BASE_URL_HTTP = MOSHI_TTS_BASE_URL.replace(/^wss?:/, "https:").split(
  "/api/",
)[0];
/** Same for the STT moshi-server. */
export const MOSHI_STT_BASE_URL_HTTP = MOSHI_WS_URL.replace(/^wss?:/, "https:").split(
  "/api/",
)[0];

export const MOSHI_TTS_DEFAULT_VOICE =
  "expresso/ex03-ex01_happy_001_channel1_334s.wav";

export type MoshiPrewarmResult = {
  /** Round-trip ms for the STT container's first response, or null on error. */
  sttMs: number | null;
  /** Round-trip ms for the TTS container's first response, or null on error. */
  ttsMs: number | null;
};

/**
 * Fire HTTP probes to nudge Modal into spinning up the moshi-server containers
 * before the user's first turn lands. Each probe is a single GET to the server
 * root (which 404s but still triggers a container start). Safe to call multiple
 * times; safe to call when containers are already warm.
 *
 * Returns a promise that resolves once both probes have completed. The result
 * carries the round-trip ms for each — callers can use this to flip a UI from
 * "warming" to "ready" once both endpoints have responded. With `mode: no-cors`
 * the response body is opaque (status 0), so we only know that the request
 * completed, not whether it 200'd or 404'd.
 */
export async function prewarmMoshiServers(): Promise<MoshiPrewarmResult> {
  const sttBase = MOSHI_WS_URL.replace(/^wss?:/, "https:").split("/api/")[0];
  const ttsBase = MOSHI_TTS_BASE_URL.replace(/^wss?:/, "https:").split("/api/")[0];

  const probe = (url: string): Promise<number | null> => {
    const startedAt = performance.now();
    // `no-cors` mode: response is opaque, but the request still reaches
    // Modal and triggers a container start. moshi-server doesn't set
    // Access-Control-Allow-Origin, so without this every prewarm noisily
    // fails CORS and shows red errors in console.
    return fetch(url, { method: "GET", cache: "no-store", mode: "no-cors" })
      .then(() => performance.now() - startedAt)
      .catch(() => null);
  };

  const [sttMs, ttsMs] = await Promise.all([probe(sttBase), probe(ttsBase)]);
  return { sttMs, ttsMs };
}

export const MOSHI_TARGET_SAMPLE_RATE = 24000;
export const MOSHI_FRAME_SIZE = 1920; // 80ms at 24kHz, matches mimi frame_size
const LIVE_STT_TARGET_RMS = 0.075;
const LIVE_STT_MIN_GAIN_RMS = 0.012;
const LIVE_STT_MAX_GAIN = 3.5;

export type MoshiServerMessage =
  | { type: "Step"; prs?: number[]; step_idx?: number }
  | { type: "Word"; text: string; start_time: number }
  | { type: "EndWord"; stop_time: number }
  | { type: "Marker"; id: number }
  | { type: "Ready" }
  | { type: "Error"; message?: string };

type PcmFrameStats = {
  rms: number;
  peak: number;
};

function measurePcmFrame(samples: Float32Array): PcmFrameStats {
  let sq = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i];
    sq += v * v;
    const abs = v < 0 ? -v : v;
    if (abs > peak) peak = abs;
  }
  return {
    rms: Math.sqrt(sq / Math.max(1, samples.length)),
    peak,
  };
}

function prepareLiveSttFrame(samples: Float32Array): {
  samples: Float32Array;
  rawRms: number;
  rawPeak: number;
  sentRms: number;
  sentPeak: number;
  gain: number;
  clippedSamples: number;
} {
  const raw = measurePcmFrame(samples);
  const gain =
    raw.rms >= LIVE_STT_MIN_GAIN_RMS
      ? Math.max(1, Math.min(LIVE_STT_MAX_GAIN, LIVE_STT_TARGET_RMS / raw.rms))
      : 1;

  if (gain === 1) {
    return {
      samples,
      rawRms: raw.rms,
      rawPeak: raw.peak,
      sentRms: raw.rms,
      sentPeak: raw.peak,
      gain,
      clippedSamples: 0,
    };
  }

  const boosted = new Float32Array(samples.length);
  let clippedSamples = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i] * gain;
    if (v > 0.98) {
      boosted[i] = 0.98;
      clippedSamples += 1;
    } else if (v < -0.98) {
      boosted[i] = -0.98;
      clippedSamples += 1;
    } else {
      boosted[i] = v;
    }
  }
  const sent = measurePcmFrame(boosted);
  return {
    samples: boosted,
    rawRms: raw.rms,
    rawPeak: raw.peak,
    sentRms: sent.rms,
    sentPeak: sent.peak,
    gain,
    clippedSamples,
  };
}

export type MoshiTtsServerMessage =
  | { type: "Audio"; pcm: number[] }
  | { type: "Text"; text: string }
  | { type: "Ready" }
  | { type: "Error"; message?: string };

export type MoshiBatchResult = {
  transcript: string;
  words: Array<{ text: string; startTime: number }>;
};

export type MoshiTtsResult = {
  audioBase64: string;
  mimeType: string;
  pcm: Float32Array;
  sampleRate: number;
  durationMs: number;
  firstAudioMs: number;
  totalMs: number;
};

/** Encode a Float32 PCM buffer (mono, given sampleRate) as a 16-bit PCM WAV file. */
export function encodeFloat32ToWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const pcmLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + pcmLength);
  const view = new DataView(buffer);

  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + pcmLength, true); // file size - 8
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, pcmLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(binary);
}

/** Decode an audio Blob (any browser-supported format) to mono Float32 PCM at 24 kHz. */
export async function decodeBlobToPCM24k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const channels = buffer.numberOfChannels;
    const length = buffer.length;
    const channel0 = buffer.getChannelData(0);

    let mono: Float32Array;
    if (channels === 1) {
      mono = new Float32Array(channel0);
    } else {
      mono = new Float32Array(length);
      for (let c = 0; c < channels; c += 1) {
        const ch = buffer.getChannelData(c);
        for (let i = 0; i < length; i += 1) {
          mono[i] += ch[i];
        }
      }
      for (let i = 0; i < length; i += 1) {
        mono[i] /= channels;
      }
    }

    const sourceRate = buffer.sampleRate;
    if (sourceRate === MOSHI_TARGET_SAMPLE_RATE) {
      return mono;
    }

    const ratio = sourceRate / MOSHI_TARGET_SAMPLE_RATE;
    const targetLength = Math.floor(mono.length / ratio);
    const result = new Float32Array(targetLength);
    for (let i = 0; i < targetLength; i += 1) {
      const sourcePos = i * ratio;
      const lo = Math.floor(sourcePos);
      const frac = sourcePos - lo;
      if (lo + 1 < mono.length) {
        result[i] = mono[lo] * (1 - frac) + mono[lo + 1] * frac;
      } else {
        result[i] = mono[lo] ?? 0;
      }
    }
    return result;
  } finally {
    try {
      await audioContext.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Open a one-shot WebSocket to moshi-server, stream PCM frames, await the
 * Marker echo, and return the joined transcript plus per-word timings.
 *
 * Mirrors the protocol used by `scripts/stt_from_file_rust_server.py`:
 *   - 1s leading silence
 *   - audio in FRAME_SIZE chunks (last chunk zero-padded)
 *   - 5s trailing silence
 *   - Marker
 *   - 10s post-marker silence so the model has room to flush its delay buffer
 *
 * Resolves on receipt of a Marker (or returns whatever was collected if the
 * WS closes first). Rejects on WS error or timeout.
 */
export async function transcribeBatchViaRustServer(
  samples: Float32Array,
  options: { timeoutMs?: number; onWord?: (word: { text: string; startTime: number }) => void } = {},
): Promise<MoshiBatchResult> {
  const timeoutMs = options.timeoutMs ?? 60000;
  const collected: Array<{ text: string; startTime: number }> = [];

  return new Promise((resolve, reject) => {
    let resolved = false;
    const ws = new WebSocket(MOSHI_WS_URL);
    ws.binaryType = "arraybuffer";

    const finish = (result: MoshiBatchResult | null, error: Error | null) => {
      if (resolved) return;
      resolved = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (error) {
        reject(error);
      } else if (result) {
        resolve(result);
      }
    };

    const timeout = window.setTimeout(() => {
      finish(
        null,
        new Error(`moshi-server WS timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);

	    ws.onopen = () => {
	      const sendAudio = (frame: Float32Array) => {
	        if (ws.readyState !== WebSocket.OPEN) return;
	        ws.send(msgpackEncodeAudioFrame(frame));
	      };

      // 1s leading silence
      sendAudio(new Float32Array(MOSHI_TARGET_SAMPLE_RATE));

      // Audio in 1920-sample frames; pad the last partial frame.
      for (let i = 0; i < samples.length; i += MOSHI_FRAME_SIZE) {
        const slice = samples.subarray(i, Math.min(i + MOSHI_FRAME_SIZE, samples.length));
        if (slice.length === MOSHI_FRAME_SIZE) {
          sendAudio(slice);
        } else {
          const padded = new Float32Array(MOSHI_FRAME_SIZE);
          padded.set(slice);
          sendAudio(padded);
        }
      }

      // 5s trailing silence (in 1s chunks for parity with the reference script)
      for (let s = 0; s < 5; s += 1) {
        sendAudio(new Float32Array(MOSHI_TARGET_SAMPLE_RATE));
      }

      ws.send(msgpackEncode({ type: "Marker", id: 0 }));

      // 10s post-marker silence so the model can flush words around the delay.
      for (let s = 0; s < 10; s += 1) {
        sendAudio(new Float32Array(MOSHI_TARGET_SAMPLE_RATE));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = msgpackDecode(
          new Uint8Array(event.data as ArrayBuffer),
        ) as MoshiServerMessage;

        if (data.type === "Word") {
          const entry = { text: data.text, startTime: data.start_time };
          collected.push(entry);
          options.onWord?.(entry);
        } else if (data.type === "Marker") {
          window.clearTimeout(timeout);
          finish(
            {
              transcript: collected.map((w) => w.text).join(" "),
              words: collected,
            },
            null,
          );
        } else if (data.type === "Error") {
          window.clearTimeout(timeout);
          finish(null, new Error(data.message ?? "moshi-server reported error"));
        }
      } catch (decodeError) {
        // Don't fail the whole turn on a single malformed frame; just log.
        console.error("moshi-client: failed to decode WS frame", decodeError);
      }
    };

    ws.onerror = () => {
      window.clearTimeout(timeout);
      finish(null, new Error("moshi-server WebSocket error"));
    };

    ws.onclose = (event) => {
      window.clearTimeout(timeout);
      if (resolved) return;
      // If the server closed cleanly after emitting words, return what we have.
      if (collected.length > 0) {
        finish(
          {
            transcript: collected.map((w) => w.text).join(" "),
            words: collected,
          },
          null,
        );
      } else {
        finish(
          null,
          new Error(
            `moshi-server WS closed before transcript: code=${event.code} reason=${event.reason || "(none)"}`,
          ),
        );
      }
    };
  });
}

/**
 * Open a WebSocket to the Kyutai TTS server, stream `text` word-by-word, send
 * Eos, and collect Audio frames into a single Float32 PCM buffer plus a
 * 16-bit PCM WAV blob (base64) ready for `decodeAudioData`-based playback.
 *
 * Mirrors the protocol used by `scripts/tts_rust_server.py`:
 *   - send `{type: "Text", text: "<word>"}` per word
 *   - send `{type: "Eos"}` once
 *   - receive `{type: "Audio", pcm: number[]}` frames at 24 kHz mono
 *
 * Returns when the server closes the WS (normal completion) or rejects on
 * error/timeout. Optional `onAudio` callback fires per frame for live playback.
 */
export async function synthesizeBatchViaKyutai(
  text: string,
  options: {
    voice?: string;
    timeoutMs?: number;
    onAudio?: (samples: Float32Array) => void;
  } = {},
): Promise<MoshiTtsResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("synthesizeBatchViaKyutai: text is empty");
  }
  const voice = options.voice ?? MOSHI_TTS_DEFAULT_VOICE;
  const timeoutMs = options.timeoutMs ?? 120000;

  const url = new URL(MOSHI_TTS_BASE_URL);
  url.searchParams.set("voice", voice);
  url.searchParams.set("format", "PcmMessagePack");
  url.searchParams.set("auth_id", "public_token");

  const startedAt = performance.now();
  let firstAudioAt: number | null = null;
  const chunks: Float32Array[] = [];
  let totalSamples = 0;

  return new Promise((resolve, reject) => {
    let resolved = false;
    const ws = new WebSocket(url.toString());
    ws.binaryType = "arraybuffer";

    const finish = (result: MoshiTtsResult | null, error: Error | null) => {
      if (resolved) return;
      resolved = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (error) reject(error);
      else if (result) resolve(result);
    };

    const timeout = window.setTimeout(() => {
      finish(null, new Error(`Kyutai TTS WS timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.onopen = () => {
      const words = trimmed.split(/\s+/).filter(Boolean);
      for (const word of words) {
        ws.send(msgpackEncode({ type: "Text", text: word }));
      }
      ws.send(msgpackEncode({ type: "Eos" }));
    };

    ws.onmessage = (event) => {
      try {
        const data = msgpackDecode(
          new Uint8Array(event.data as ArrayBuffer),
        ) as MoshiTtsServerMessage;

        if (data.type === "Audio") {
          if (firstAudioAt === null) {
            firstAudioAt = performance.now();
          }
          const samples = new Float32Array(data.pcm);
          chunks.push(samples);
          totalSamples += samples.length;
          options.onAudio?.(samples);
        } else if (data.type === "Error") {
          window.clearTimeout(timeout);
          finish(null, new Error(data.message ?? "Kyutai TTS reported error"));
        }
      } catch (decodeError) {
        console.error("synthesizeBatchViaKyutai: failed to decode WS frame", decodeError);
      }
    };

    ws.onerror = () => {
      window.clearTimeout(timeout);
      finish(null, new Error("Kyutai TTS WebSocket error"));
    };

    ws.onclose = (event) => {
      window.clearTimeout(timeout);
      if (resolved) return;
      if (totalSamples === 0) {
        finish(
          null,
          new Error(
            `Kyutai TTS WS closed before audio: code=${event.code} reason=${event.reason || "(none)"}`,
          ),
        );
        return;
      }
      const merged = new Float32Array(totalSamples);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      const wav = encodeFloat32ToWav(merged, MOSHI_TARGET_SAMPLE_RATE);
      const finishedAt = performance.now();
      finish(
        {
          audioBase64: uint8ToBase64(wav),
          mimeType: "audio/wav",
          pcm: merged,
          sampleRate: MOSHI_TARGET_SAMPLE_RATE,
          durationMs: Math.round((merged.length / MOSHI_TARGET_SAMPLE_RATE) * 1000),
          firstAudioMs: firstAudioAt !== null ? Math.round(firstAudioAt - startedAt) : -1,
          totalMs: Math.round(finishedAt - startedAt),
        },
        null,
      );
    };
  });
}

/* ── Streaming STT session (live word emission) ─────────────────── */

export type MoshiStreamingSttHandlers = {
  /** Startup/capture lifecycle hooks used by the voice UI readiness checklist. */
  onMicPermissionPending?: () => void;
  onMicCapture?: () => void;
  onWorkletLoading?: () => void;
  onWorkletReady?: (sampleRate: number) => void;
  onSocketConnecting?: (url: string) => void;
  /** Called whenever an audio frame is actually sent to the STT websocket. */
  onFrameSent?: (stats: {
    framesSent: number;
    rms: number;
    peak: number;
    rawRms: number;
    rawPeak: number;
    gain: number;
    clippedSamples: number;
    samples: number;
  }) => void;
  /** Called for every decoded server message, including Step keepalives. */
  onServerMessage?: (type: MoshiServerMessage["type"]) => void;
  /** Called for every Word event the server emits as the user speaks. */
  onWord?: (text: string, startTime: number) => void;
  /** Pause prediction probability (0–1) from semantic VAD head 2 (~2s pause). */
  onPausePrediction?: (probability: number) => void;
  /** RMS level of the captured audio frame, for UI meters. */
  onLevel?: (rms: number) => void;
  /** Connection state hooks. */
  onOpen?: () => void;
  onError?: (message: string) => void;
  onClose?: () => void;
};

const PAUSE_PREDICTION_HEAD_INDEX = 2;

/**
 * Live STT session: opens mic + AudioWorklet + WebSocket to moshi-server and
 * emits Word/Step events to handlers as the user speaks. Caller is responsible
 * for calling `stop()` (manually or in response to onPausePrediction crossing
 * a threshold).
 */
export class MoshiStreamingSttSession {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private stopped = false;
  private words: Array<{ text: string; startTime: number }> = [];

  /** All words received during the session, in order. */
  get allWords() {
    return [...this.words];
  }

  /** Joined transcript so far. */
  get transcript() {
    return this.words.map((w) => w.text).join(" ");
  }

  /**
   * Clear the in-memory transcript buffer. Use this at turn boundaries when
   * the session is staying alive across multiple turns (always-on STT mode).
   * Does NOT touch the underlying server state — moshi-server keeps its own
   * streaming context, which is fine because Words after this point are
   * naturally a new utterance.
   */
  resetTranscript() {
    this.words = [];
  }

  async start(handlers: MoshiStreamingSttHandlers = {}): Promise<void> {
    if (this.stopped) {
      throw new Error("Cannot reuse a stopped MoshiStreamingSttSession");
    }
    console.log("[MoshiStreamingSttSession] start()");

    let stream: MediaStream;
    try {
      handlers.onMicPermissionPending?.();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (primaryError) {
      console.warn(
        "[MoshiStreamingSttSession] constrained mic request failed, retrying with plain audio",
        primaryError,
      );
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    this.stream = stream;
    handlers.onMicCapture?.();
    console.log("[MoshiStreamingSttSession] mic stream acquired");

    const audioContext = new AudioContext();
    this.audioContext = audioContext;
    handlers.onWorkletLoading?.();
    await audioContext.audioWorklet.addModule("/audio-worklet/pcm-capture-worklet.js");
    handlers.onWorkletReady?.(audioContext.sampleRate);
    console.log(
      "[MoshiStreamingSttSession] audio worklet loaded, contextRate=",
      audioContext.sampleRate,
    );

    const source = audioContext.createMediaStreamSource(stream);
    this.sourceNode = source;

    const node = new AudioWorkletNode(audioContext, "pcm-capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    });
    this.workletNode = node;

    console.log("[MoshiStreamingSttSession] opening ws to", MOSHI_WS_URL);
    handlers.onSocketConnecting?.(MOSHI_WS_URL);
    const ws = new WebSocket(MOSHI_WS_URL);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      console.log("[MoshiStreamingSttSession] ws.onopen");
      handlers.onOpen?.();

	      // 1s of leading silence — required by some Kyutai STT models, harmless
	      // for the 1B en_fr default.
	      const silence = new Float32Array(MOSHI_TARGET_SAMPLE_RATE);
	      ws.send(msgpackEncodeAudioFrame(silence));

      // ── TEMP DIAGNOSTIC — log frame RMS + peak as they're sent to Moshi.
      // If sent-RMS is near zero while mic-level RMS is non-zero, the audio
      // is being lost between worklet and WS (transfer-list issue, etc).
      // Removable once the chat-vs-voice-page asymmetry is resolved.
      const sentStats = { frames: 0, sumRms: 0, peak: 0 };
      let framesSent = 0;
      let lastSentLogAt = 0;

      node.port.onmessage = (event) => {
        const data = event.data as
          | { type: "frame"; samples: Float32Array }
          | { type: "level"; rms: number };
	        if (data.type === "frame") {
	          if (ws.readyState === WebSocket.OPEN) {
	            const prepared = prepareLiveSttFrame(data.samples);
	            framesSent += 1;
	            sentStats.frames += 1;
	            sentStats.sumRms += prepared.sentRms;
	            if (prepared.sentPeak > sentStats.peak) sentStats.peak = prepared.sentPeak;
	            handlers.onFrameSent?.({
	              framesSent,
	              rms: prepared.sentRms,
	              peak: prepared.sentPeak,
	              rawRms: prepared.rawRms,
	              rawPeak: prepared.rawPeak,
	              gain: prepared.gain,
	              clippedSamples: prepared.clippedSamples,
	              samples: prepared.samples.length,
	            });
	            const now = performance.now();
	            if (now - lastSentLogAt > 1000) {
              lastSentLogAt = now;
              const meanRms = sentStats.sumRms / Math.max(1, sentStats.frames);
              console.log(
                `[moshi-send] last 1s: frames=${sentStats.frames} mean-rms=${meanRms.toFixed(4)} peak=${sentStats.peak.toFixed(4)}`,
              );
              sentStats.frames = 0;
	              sentStats.sumRms = 0;
	              sentStats.peak = 0;
	            }
	
	            ws.send(msgpackEncodeAudioFrame(prepared.samples));
	          }
	        } else if (data.type === "level") {
          handlers.onLevel?.(data.rms);
        }
      };

      source.connect(node);
    };

    // ── TEMP DIAGNOSTIC — logs every inbound Moshi message type. Remove once
    // the chat-vs-voice-page transcript asymmetry is resolved.
    const recvCounts: Record<string, number> = {};
    let lastLogAt = 0;
    ws.onmessage = (event) => {
      try {
        const data = msgpackDecode(new Uint8Array(event.data as ArrayBuffer)) as MoshiServerMessage;
        handlers.onServerMessage?.(data.type);
        // Throttled aggregate log so the console doesn't drown in Step events.
        recvCounts[data.type] = (recvCounts[data.type] ?? 0) + 1;
        const now = performance.now();
        if (now - lastLogAt > 1000) {
          lastLogAt = now;
          console.log("[moshi-recv] last 1s:", { ...recvCounts });
          for (const k of Object.keys(recvCounts)) recvCounts[k] = 0;
        }
        // Always log non-Step messages immediately — they're the interesting ones.
        if (data.type !== "Step") {
          console.log("[moshi-recv]", data.type, data);
        }

        if (data.type === "Word") {
          this.words.push({ text: data.text, startTime: data.start_time });
          handlers.onWord?.(data.text, data.start_time);
        } else if (data.type === "Step") {
          const prs = data.prs;
          if (Array.isArray(prs) && prs.length > PAUSE_PREDICTION_HEAD_INDEX) {
            handlers.onPausePrediction?.(prs[PAUSE_PREDICTION_HEAD_INDEX]);
          }
        } else if (data.type === "Error") {
          handlers.onError?.(data.message ?? "moshi-server reported error");
        }
      } catch (decodeError) {
        console.error("MoshiStreamingSttSession: decode error", decodeError);
      }
    };

    ws.onerror = (event) => {
      if (this.stopped) {
        console.log("[MoshiStreamingSttSession] ws.onerror after stop (suppressed)");
        return;
      }
      console.error("[MoshiStreamingSttSession] ws.onerror", event);
      // Defer surfacing — onclose will fire next with the actual close code.
    };

    ws.onclose = (event) => {
      const detail = `code=${event.code} reason="${event.reason || "(none)"}" wasClean=${event.wasClean}`;
      console.log("[MoshiStreamingSttSession] ws.onclose", detail);
      if (!this.stopped && !event.wasClean) {
        handlers.onError?.(`moshi-server WS closed unexpectedly (${detail})`);
      }
      handlers.onClose?.();
    };
  }

  /**
   * Stop the session. WS close is sent FIRST with explicit code 1000 so the
   * server-side container can reclaim the concurrency slot immediately —
   * audio-rt holds the Modal worker hostage until it sees a clean close frame.
   * Audio teardown can drag (audioContext.close awaits a tick); we don't want
   * that latency in front of the close frame.
   *
   * Safe to call from synchronous unload paths — this method does the WS close
   * and worklet disconnect synchronously before any await, so the close frame
   * is queued before the page tears down even if the caller doesn't await.
   */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    // 1. Close WS first, explicit code, before anything async. ws.close() is
    //    synchronous: it queues the close frame and the browser flushes it on
    //    the next tick, even if the page is unloading.
    if (this.ws) {
      try {
        this.ws.close(1000, "client stopping");
      } catch {
        /* ignore */
      }
      this.ws = null;
    }

    // 2. Detach worklet and source synchronously so no more frames are
    //    produced (and no more `port.onmessage` calls into a closed WS).
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      try {
        this.workletNode.disconnect();
      } catch {
        /* ignore */
      }
      this.workletNode = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        /* ignore */
      }
      this.sourceNode = null;
    }

    // 3. Release the mic stream — also synchronous, important so the browser's
    //    "tab is using mic" indicator clears immediately.
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }

    // 4. Audio context close last — awaitable, so any straggler GC can settle.
    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch {
        /* ignore */
      }
      this.audioContext = null;
    }
  }
}

/* ── Streaming TTS player (Web Audio playback as frames arrive) ──── */

export type MoshiStreamingTtsHandlers = {
  onFirstAudio?: (latencyMs: number) => void;
  onProgress?: (samplesGenerated: number) => void;
  onError?: (message: string) => void;
  onComplete?: (totals: { samples: number; durationMs: number; firstAudioMs: number }) => void;
};

/**
 * Open a WS to Kyutai TTS, send `text` word-by-word + Eos, then schedule each
 * incoming Audio frame for playback at the AudioContext's clock so frames
 * concatenate seamlessly. Returns once the server closes the WS.
 *
 * Audio starts playing as soon as the first frame arrives — typically ~0.7s
 * after the Eos, well before all frames have been generated.
 */
export async function streamingSpeak(
  text: string,
  options: {
    voice?: string;
    handlers?: MoshiStreamingTtsHandlers;
    /** Optional pre-existing AudioContext (avoids creating one per call). */
    audioContext?: AudioContext;
  } = {},
): Promise<{ samples: number; durationMs: number; firstAudioMs: number }> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("streamingSpeak: text is empty");
  }
  const voice = options.voice ?? MOSHI_TTS_DEFAULT_VOICE;
  const handlers = options.handlers ?? {};

  const url = new URL(MOSHI_TTS_BASE_URL);
  url.searchParams.set("voice", voice);
  url.searchParams.set("format", "PcmMessagePack");
  url.searchParams.set("auth_id", "public_token");

  const ownsContext = !options.audioContext;
  const audioContext =
    options.audioContext ?? new AudioContext({ sampleRate: MOSHI_TARGET_SAMPLE_RATE });
  if (audioContext.state === "suspended") {
    try {
      await audioContext.resume();
    } catch {
      /* autoplay-policy may block; caller should have an interaction-tied resume */
    }
  }

  const startedAt = performance.now();
  let firstAudioAt: number | null = null;
  let totalSamples = 0;
  // The next absolute AudioContext time at which a buffer should start.
  let nextStartTime = audioContext.currentTime;

  return await new Promise((resolve, reject) => {
    let resolved = false;
    const ws = new WebSocket(url.toString());
    ws.binaryType = "arraybuffer";

    const finish = (
      result: { samples: number; durationMs: number; firstAudioMs: number } | null,
      error: Error | null,
    ) => {
      if (resolved) return;
      resolved = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (ownsContext) {
        // Don't close the context immediately — playback may still be scheduled.
        // Close once everything has played out.
        const remaining = Math.max(0, nextStartTime - audioContext.currentTime);
        setTimeout(() => {
          audioContext.close().catch(() => {
            /* ignore */
          });
        }, remaining * 1000 + 200);
      }
      if (error) reject(error);
      else if (result) resolve(result);
    };

    ws.onopen = () => {
      const words = trimmed.split(/\s+/).filter(Boolean);
      for (const word of words) {
        ws.send(msgpackEncode({ type: "Text", text: word }));
      }
      ws.send(msgpackEncode({ type: "Eos" }));
    };

    ws.onmessage = (event) => {
      try {
        const data = msgpackDecode(new Uint8Array(event.data as ArrayBuffer)) as
          | { type: "Audio"; pcm: number[] }
          | { type: "Text"; text: string }
          | { type: "Ready" }
          | { type: "Error"; message?: string };

        if (data.type === "Audio") {
          const samples = new Float32Array(data.pcm);
          if (samples.length === 0) return;

          if (firstAudioAt === null) {
            firstAudioAt = performance.now();
            handlers.onFirstAudio?.(Math.round(firstAudioAt - startedAt));
          }

          const buffer = audioContext.createBuffer(1, samples.length, MOSHI_TARGET_SAMPLE_RATE);
          buffer.copyToChannel(samples, 0);
          const source = audioContext.createBufferSource();
          source.buffer = buffer;
          source.connect(audioContext.destination);

          const now = audioContext.currentTime;
          const startAt = Math.max(now, nextStartTime);
          source.start(startAt);
          nextStartTime = startAt + samples.length / MOSHI_TARGET_SAMPLE_RATE;

          totalSamples += samples.length;
          handlers.onProgress?.(totalSamples);
        } else if (data.type === "Error") {
          handlers.onError?.(data.message ?? "Kyutai TTS error");
          finish(null, new Error(data.message ?? "Kyutai TTS error"));
        }
      } catch (decodeError) {
        console.error("streamingSpeak: decode error", decodeError);
      }
    };

    ws.onerror = () => {
      const message = "Kyutai TTS WebSocket error";
      handlers.onError?.(message);
      finish(null, new Error(message));
    };

    ws.onclose = (event) => {
      if (resolved) return;
      const result = {
        samples: totalSamples,
        durationMs: Math.round((totalSamples / MOSHI_TARGET_SAMPLE_RATE) * 1000),
        firstAudioMs: firstAudioAt !== null ? Math.round(firstAudioAt - startedAt) : -1,
      };
      if (totalSamples === 0) {
        finish(
          null,
          new Error(
            `Kyutai TTS WS closed before audio: code=${event.code} reason=${event.reason || "(none)"}`,
          ),
        );
        return;
      }
      handlers.onComplete?.(result);
      finish(result, null);
    };
  });
}

/* ── Streaming TTS pipeline (LLM → TTS without waiting) ─────────── */

export type MoshiStreamingTtsPipelineOptions = {
  voice?: string;
  audioContext: AudioContext;
  handlers?: MoshiStreamingTtsHandlers;
};

export type MoshiTtsPipelineResult = {
  samples: number;
  durationMs: number;
  firstAudioMs: number;
};

/**
 * Pipelined LLM → TTS. Open the WS up front, push token deltas via
 * `pushText()` as they arrive from the LLM SSE, and call `finish()` when the
 * LLM's stream ends.
 *
 * Internally:
 *   - buffers tokens until a whitespace boundary, then sends complete words
 *     as `{type: "Text", text: word}` immediately
 *   - schedules every received Audio frame on the AudioContext clock so
 *     playback starts the moment the first frame arrives (typically ~700ms
 *     after the first complete word lands at the server) and continues
 *     seamlessly as more frames stream in
 *   - sends `{type: "Eos"}` only on `finish()`
 *
 * Net effect: audio plays for sentence 1 while the LLM is still generating
 * sentences 2, 3, etc. — no "wait for full reply, then synthesize."
 */
export class MoshiStreamingTtsPipeline {
  private ws: WebSocket;
  private audioContext: AudioContext;
  private gainNode: GainNode;
  private nextStartTime: number;
  private buffer = "";
  private wsReady: Promise<void>;
  private wsReadyResolve: () => void = () => {};
  private wsReadyReject: (e: Error) => void = () => {};
  private wsReadyResolved = false;
  private donePromise: Promise<MoshiTtsPipelineResult>;
  private doneResolve: (r: MoshiTtsPipelineResult) => void = () => {};
  private doneReject: (e: Error) => void = () => {};
  private doneSettled = false;
  private firstAudioAt: number | null = null;
  private startedAt: number;
  private totalSamples = 0;
  private finished = false;
  private cancelled = false;
  private handlers: MoshiStreamingTtsHandlers;

  constructor(options: MoshiStreamingTtsPipelineOptions) {
    this.audioContext = options.audioContext;
    this.nextStartTime = this.audioContext.currentTime;
    this.startedAt = performance.now();
    this.handlers = options.handlers ?? {};

    // Per-pipeline GainNode so `cancel()` can silence already-scheduled audio
    // buffers without affecting future TTS turns. All buffer sources route
    // through this node instead of straight to destination.
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 1;
    this.gainNode.connect(this.audioContext.destination);

    this.wsReady = new Promise<void>((resolve, reject) => {
      this.wsReadyResolve = () => {
        this.wsReadyResolved = true;
        resolve();
      };
      this.wsReadyReject = reject;
    });
    this.donePromise = new Promise<MoshiTtsPipelineResult>((resolve, reject) => {
      this.doneResolve = (r) => {
        if (this.doneSettled) return;
        this.doneSettled = true;
        resolve(r);
      };
      this.doneReject = (e) => {
        if (this.doneSettled) return;
        this.doneSettled = true;
        reject(e);
      };
    });

    const url = new URL(MOSHI_TTS_BASE_URL);
    url.searchParams.set("voice", options.voice ?? MOSHI_TTS_DEFAULT_VOICE);
    url.searchParams.set("format", "PcmMessagePack");
    url.searchParams.set("auth_id", "public_token");

    this.ws = new WebSocket(url.toString());
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      console.log(
        "[MoshiStreamingTtsPipeline] ws.onopen, ctx.state=",
        this.audioContext.state,
        "ctx.sampleRate=",
        this.audioContext.sampleRate,
      );
      // The user-gesture that opened the mic counted for AudioContext creation,
      // but if more than a few hundred ms passed before the first audio frame,
      // some browsers suspend the context. Resume early — this is idempotent
      // when already running.
      if (this.audioContext.state === "suspended") {
        this.audioContext.resume().catch((err) => {
          console.error("[MoshiStreamingTtsPipeline] resume() failed", err);
        });
      }
      this.wsReadyResolve();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = msgpackDecode(new Uint8Array(event.data as ArrayBuffer)) as
          | { type: "Audio"; pcm: number[] }
          | { type: "Text"; text: string }
          | { type: "Ready" }
          | { type: "Error"; message?: string };

        if (data.type === "Audio" && !this.cancelled) {
          const samples = new Float32Array(data.pcm);
          if (samples.length === 0) return;
          if (this.firstAudioAt === null) {
            this.firstAudioAt = performance.now();
            console.log(
              "[MoshiStreamingTtsPipeline] first audio frame, ctx.state=",
              this.audioContext.state,
              "samples=",
              samples.length,
            );
            // Belt-and-suspenders: resume on first audio in case the WS opened
            // before the gesture handler had a chance to authorize playback.
            if (this.audioContext.state === "suspended") {
              this.audioContext.resume().catch(() => {
                /* ignore — onerror handler will surface playback issues */
              });
            }
            this.handlers.onFirstAudio?.(Math.round(this.firstAudioAt - this.startedAt));
          }
          const buffer = this.audioContext.createBuffer(
            1,
            samples.length,
            MOSHI_TARGET_SAMPLE_RATE,
          );
          buffer.copyToChannel(samples, 0);
          const source = this.audioContext.createBufferSource();
          source.buffer = buffer;
          source.connect(this.gainNode);
          const now = this.audioContext.currentTime;
          const startAt = Math.max(now, this.nextStartTime);
          source.start(startAt);
          this.nextStartTime = startAt + samples.length / MOSHI_TARGET_SAMPLE_RATE;
          this.totalSamples += samples.length;
          this.handlers.onProgress?.(this.totalSamples);
        } else if (data.type === "Error") {
          const err = new Error(data.message ?? "Kyutai TTS error");
          this.handlers.onError?.(err.message);
          if (!this.wsReadyResolved) this.wsReadyReject(err);
          this.doneReject(err);
        }
      } catch (decodeError) {
        console.error("MoshiStreamingTtsPipeline: decode error", decodeError);
      }
    };

    this.ws.onerror = (event) => {
      if (this.cancelled) {
        // We initiated the close; the resulting onerror in some browsers is
        // expected and shouldn't surface as a user-facing failure. The
        // onclose handler below will resolve the donePromise cleanly.
        console.log("[MoshiStreamingTtsPipeline] ws.onerror after cancel (suppressed)");
        return;
      }
      console.error("[MoshiStreamingTtsPipeline] ws.onerror", event);
      // Don't surface here — the onclose handler will fire next with the
      // close code, which is far more useful than the empty error event.
    };

    this.ws.onclose = (event) => {
      const detail = `code=${event.code} reason="${event.reason || "(none)"}" wasClean=${event.wasClean}`;
      console.log("[MoshiStreamingTtsPipeline] ws.onclose", detail);
      if (this.cancelled) {
        this.doneResolve({
          samples: this.totalSamples,
          durationMs: Math.round((this.totalSamples / MOSHI_TARGET_SAMPLE_RATE) * 1000),
          firstAudioMs:
            this.firstAudioAt !== null
              ? Math.round(this.firstAudioAt - this.startedAt)
              : -1,
        });
        return;
      }
      if (this.totalSamples === 0) {
        const message = `Kyutai TTS WS closed before audio: ${detail}`;
        this.handlers.onError?.(message);
        if (!this.wsReadyResolved) this.wsReadyReject(new Error(message));
        this.doneReject(new Error(message));
        return;
      }
      const result: MoshiTtsPipelineResult = {
        samples: this.totalSamples,
        durationMs: Math.round((this.totalSamples / MOSHI_TARGET_SAMPLE_RATE) * 1000),
        firstAudioMs:
          this.firstAudioAt !== null
            ? Math.round(this.firstAudioAt - this.startedAt)
            : -1,
      };
      this.handlers.onComplete?.(result);
      this.doneResolve(result);
    };
  }

  /**
   * Push a streaming text delta from the LLM. Whole words flush to the TTS
   * WS as soon as a whitespace boundary follows them; partial trailing
   * tokens stay buffered until the next delta closes them.
   */
  async pushText(delta: string): Promise<void> {
    if (this.cancelled || this.finished) return;
    if (!delta) return;
    this.buffer += delta;
    if (!this.wsReadyResolved) {
      try {
        await this.wsReady;
      } catch {
        return; // wsReadyReject already triggered an error path
      }
    }
    if (this.cancelled || this.ws.readyState !== WebSocket.OPEN) return;
    // Send everything before the last whitespace as completed words; keep
    // anything after as a partial buffer.
    const lastSpaceMatch = this.buffer.match(/^([\s\S]*\s)(\S*)$/);
    if (!lastSpaceMatch) return; // no whitespace yet — keep buffering
    const ready = lastSpaceMatch[1];
    const remaining = lastSpaceMatch[2];
    const words = ready.split(/\s+/).filter(Boolean);
    for (const word of words) {
      this.ws.send(msgpackEncode({ type: "Text", text: word }));
    }
    this.buffer = remaining;
  }

  /**
   * Flush any remaining buffered text + send Eos. Returns when the server has
   * delivered all audio and closed the WS.
   */
  async finish(): Promise<MoshiTtsPipelineResult> {
    if (this.finished || this.cancelled) return this.donePromise;
    this.finished = true;
    if (!this.wsReadyResolved) {
      try {
        await this.wsReady;
      } catch (err) {
        this.doneReject(err instanceof Error ? err : new Error(String(err)));
        return this.donePromise;
      }
    }
    if (this.cancelled || this.ws.readyState !== WebSocket.OPEN) {
      return this.donePromise;
    }
    const remaining = this.buffer.trim();
    if (remaining) {
      const words = remaining.split(/\s+/).filter(Boolean);
      for (const word of words) {
        this.ws.send(msgpackEncode({ type: "Text", text: word }));
      }
      this.buffer = "";
    }
    this.ws.send(msgpackEncode({ type: "Eos" }));
    return this.donePromise;
  }

  /**
   * Abort the TTS for barge-in. Closes the WS so no more audio frames will
   * arrive, and ramps the per-pipeline gain to 0 over 60ms so any
   * already-scheduled buffers fade out instead of clicking off mid-sample.
   */
  cancel(): void {
    if (this.cancelled || this.finished) return;
    this.cancelled = true;
    const now = this.audioContext.currentTime;
    try {
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(0, now + 0.06);
    } catch {
      /* ignore */
    }
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

/* ── Barge-in monitor (mic-level threshold during character TTS) ──── */

export type MoshiBargeInOptions = {
  /** RMS threshold above which the user is considered to be speaking. */
  threshold?: number;
  /** Sustained ms above threshold before firing onBargeIn. */
  sustainMs?: number;
  /** Fires once when the threshold has been sustained. Monitor stops itself. */
  onBargeIn: () => void;
  /** Optional level callback for a UI meter. */
  onLevel?: (rms: number) => void;
  /** Optional error callback (e.g. mic permission denied mid-stream). */
  onError?: (message: string) => void;
};

/**
 * Lightweight mic-level monitor for barge-in detection during TTS playback.
 *
 * Uses a separate AudioContext + AnalyserNode on a fresh getUserMedia stream
 * so the analysis runs entirely independent of the TTS playback path. The
 * browser's built-in echo cancellation removes most of the character's own
 * voice from the mic input, so a moderate threshold (~0.03 RMS) reliably
 * distinguishes user speech from speaker bleed.
 */
export class MoshiBargeInMonitor {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private rafId: number | null = null;
  private aboveThresholdSinceMs: number | null = null;
  private stopped = false;
  private fired = false;

  async start(options: MoshiBargeInOptions): Promise<void> {
    const threshold = options.threshold ?? 0.03;
    const sustainMs = options.sustainMs ?? 150;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (this.stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;

      const context = new AudioContext();
      this.context = context;
      const source = context.createMediaStreamSource(stream);
      this.sourceNode = source;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(analyser);
      this.analyser = analyser;

      const buffer = new Uint8Array(analyser.fftSize);

      const tick = () => {
        if (this.stopped || this.fired || !this.analyser) return;
        this.analyser.getByteTimeDomainData(buffer);
        let sumSq = 0;
        for (let i = 0; i < buffer.length; i += 1) {
          const v = (buffer[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / buffer.length);
        options.onLevel?.(rms);

        const now = performance.now();
        if (rms > threshold) {
          if (this.aboveThresholdSinceMs === null) {
            this.aboveThresholdSinceMs = now;
          } else if (now - this.aboveThresholdSinceMs >= sustainMs) {
            this.fired = true;
            this.stop();
            options.onBargeIn();
            return;
          }
        } else {
          this.aboveThresholdSinceMs = null;
        }

        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Mic access failed.";
      options.onError?.(message);
      void this.stop();
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        /* ignore */
      }
      this.sourceNode = null;
    }
    this.analyser = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        /* ignore */
      }
      this.context = null;
    }
  }
}
