"use client";

// Local MessagePack codec to avoid hard dependency failures during local dev.
// Supports the primitives and container shapes used by this voice debug page.
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
    let header: Uint8Array;
    if (length <= 15) {
      header = Uint8Array.of(0x90 | length);
    } else if (length <= 0xffff) {
      header = Uint8Array.of(0xdc, (length >> 8) & 0xff, length & 0xff);
    } else {
      header = Uint8Array.of(
        0xdd,
        (length >>> 24) & 0xff,
        (length >>> 16) & 0xff,
        (length >>> 8) & 0xff,
        length & 0xff,
      );
    }
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

export function msgpackDecode(bytes: Uint8Array): unknown {
  let offset = 0;

  const read = () => {
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

export const MOSHI_TTS_DEFAULT_VOICE =
  "expresso/ex03-ex01_happy_001_channel1_334s.wav";

export const MOSHI_TARGET_SAMPLE_RATE = 24000;
export const MOSHI_FRAME_SIZE = 1920; // 80ms at 24kHz, matches mimi frame_size

export type MoshiServerMessage =
  | { type: "Step"; prs?: number[]; step_idx?: number }
  | { type: "Word"; text: string; start_time: number }
  | { type: "EndWord"; stop_time: number }
  | { type: "Marker"; id: number }
  | { type: "Ready" }
  | { type: "Error"; message?: string };

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
        ws.send(
          msgpackEncode({
            type: "Audio",
            pcm: Array.from(frame),
          }),
        );
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
