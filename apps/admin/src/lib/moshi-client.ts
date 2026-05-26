"use client";

/**
 * Legacy audio client for the older voice panel/debug surfaces.
 *
 * The "Moshi" name is historical: the current production audio runtime is
 * the audio-rt service. New character sandbox work should use
 * `audio-rt-streaming-stt.ts` instead of adding new imports here. This file
 * stays in place until the older voice panel and debug tools are migrated.
 */

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
  "wss://audio-rt-production.up.railway.app/api/asr-streaming";

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

export type MoshiBatchResult = {
  transcript: string;
  words: Array<{ text: string; startTime: number }>;
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

/* ── Streaming STT session (live word emission) ─────────────────── */

export type MoshiStreamingSttHandlers = {
  /** Startup/capture lifecycle hooks used by the voice UI readiness checklist. */
  onMicPermissionPending?: () => void;
  onMicCapture?: (stream: MediaStream) => void;
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
    handlers.onMicCapture?.(stream);
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
