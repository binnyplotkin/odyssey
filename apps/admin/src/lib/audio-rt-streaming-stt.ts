"use client";

const AUDIO_RT_STREAMING_STT_WS_URL =
  "wss://audio-rt-production.up.railway.app/api/asr-streaming";
const TARGET_SAMPLE_RATE = 24_000;
const TARGET_RMS = 0.075;
const MIN_GAIN_RMS = 0.012;
const MAX_GAIN = 3.5;

export type AudioRtEndpointTiming = {
  voiceStopToEndpointMs: number | null;
  endpointToSttMs: number;
  voiceStopToTranscriptMs: number | null;
  /** True when the transcript came from a speculative decode that overlapped
   * the silence hold (STREAMING_DECODE_ENABLED), so endpoint→STT is ~0. */
  speculative?: boolean;
};

type SttMessage =
  | { type: "Ready" }
  | { type: "Step"; prs?: number[]; step_idx?: number }
  | { type: "Word"; text: string; start_time: number }
  | ({ type: "Timing" } & AudioRtEndpointTiming)
  | { type: "Error"; message?: string };

export type AudioRtStreamingSttHandlers = {
  onOpen?: () => void;
  onWord?: (word: string, startTime: number) => void;
  /** Endpointing latency for a clean end-of-turn (voice stop → transcript). */
  onTiming?: (timing: AudioRtEndpointTiming) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
};

export class AudioRtStreamingSttSession {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private stopped = false;

  async start(stream: MediaStream, handlers: AudioRtStreamingSttHandlers = {}) {
    if (this.stopped) throw new Error("Cannot reuse a stopped STT session.");

    const audioContext = new AudioContext();
    this.audioContext = audioContext;
    await audioContext.audioWorklet.addModule("/audio-worklet/pcm-capture-worklet.js");

    const source = audioContext.createMediaStreamSource(stream);
    this.sourceNode = source;
    const node = new AudioWorkletNode(audioContext, "pcm-capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    });
    this.workletNode = node;

    const ws = new WebSocket(AUDIO_RT_STREAMING_STT_WS_URL);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      handlers.onOpen?.();
      ws.send(encodeAudioFrame(new Float32Array(TARGET_SAMPLE_RATE)));
      node.port.onmessage = (event) => {
        const data = event.data as
          | { type: "frame"; samples: Float32Array }
          | { type: "level"; rms: number };
        if (data.type !== "frame" || ws.readyState !== WebSocket.OPEN) return;
        ws.send(encodeAudioFrame(prepareFrame(data.samples)));
      };
      source.connect(node);
    };

    ws.onmessage = (event) => {
      try {
        const message = decodeMsgpack(new Uint8Array(event.data as ArrayBuffer)) as SttMessage;
        if (message.type === "Word") {
          handlers.onWord?.(message.text, message.start_time);
        } else if (message.type === "Timing") {
          handlers.onTiming?.({
            voiceStopToEndpointMs: message.voiceStopToEndpointMs,
            endpointToSttMs: message.endpointToSttMs,
            voiceStopToTranscriptMs: message.voiceStopToTranscriptMs,
            speculative: message.speculative,
          });
        } else if (message.type === "Error") {
          handlers.onError?.(message.message ?? "streaming STT failed");
        }
      } catch (err) {
        handlers.onError?.(err instanceof Error ? err.message : String(err));
      }
    };
    ws.onerror = () => {
      if (!this.stopped) handlers.onError?.("streaming STT websocket error");
    };
    ws.onclose = () => handlers.onClose?.();
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    try {
      this.ws?.close(1000, "client stopping");
    } catch {
      /* noop */
    }
    this.ws = null;
    this.workletNode?.port && (this.workletNode.port.onmessage = null);
    try {
      this.workletNode?.disconnect();
      this.sourceNode?.disconnect();
    } catch {
      /* noop */
    }
    this.workletNode = null;
    this.sourceNode = null;
    if (this.audioContext) {
      await this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
  }
}

function prepareFrame(samples: Float32Array): Float32Array {
  let sq = 0;
  let peak = 0;
  for (const sample of samples) {
    sq += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  void peak;
  const rms = Math.sqrt(sq / Math.max(1, samples.length));
  const gain = rms >= MIN_GAIN_RMS ? Math.max(1, Math.min(MAX_GAIN, TARGET_RMS / rms)) : 1;
  if (gain === 1) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = Math.max(-1, Math.min(1, samples[i] * gain));
  }
  return out;
}

function utf8(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function text(input: Uint8Array): string {
  return new TextDecoder().decode(input);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function encodeString(value: string): Uint8Array {
  const bytes = utf8(value);
  if (bytes.length <= 31) return concat([Uint8Array.of(0xa0 | bytes.length), bytes]);
  return concat([Uint8Array.of(0xd9, bytes.length), bytes]);
}

function encodeArrayHeader(length: number): Uint8Array {
  return length <= 15
    ? Uint8Array.of(0x90 | length)
    : Uint8Array.of(0xdc, (length >> 8) & 0xff, length & 0xff);
}

function encodeAudioFrame(samples: Float32Array): Uint8Array {
  const sampleBytes = new Uint8Array(samples.length * 5);
  const view = new DataView(sampleBytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    view.setUint8(i * 5, 0xca);
    view.setFloat32(i * 5 + 1, samples[i], false);
  }
  return concat([
    Uint8Array.of(0x82),
    encodeString("type"),
    encodeString("Audio"),
    encodeString("pcm"),
    encodeArrayHeader(samples.length),
    sampleBytes,
  ]);
}

function decodeMsgpack(bytes: Uint8Array): unknown {
  let offset = 0;
  const read = (): unknown => {
    const prefix = bytes[offset++];
    if (prefix <= 0x7f) return prefix;
    if ((prefix & 0xe0) === 0xa0) {
      const length = prefix & 0x1f;
      const out = text(bytes.subarray(offset, offset + length));
      offset += length;
      return out;
    }
    if ((prefix & 0xf0) === 0x90) {
      const length = prefix & 0x0f;
      return Array.from({ length }, () => read());
    }
    if ((prefix & 0xf0) === 0x80) {
      const length = prefix & 0x0f;
      const out: Record<string, unknown> = {};
      for (let i = 0; i < length; i += 1) out[String(read())] = read();
      return out;
    }
    switch (prefix) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
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
      case 0xcc:
        return bytes[offset++];
      case 0xcd: {
        const value = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        return value;
      }
      case 0xd9: {
        const length = bytes[offset++];
        const out = text(bytes.subarray(offset, offset + length));
        offset += length;
        return out;
      }
      case 0xda: {
        const length = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        const out = text(bytes.subarray(offset, offset + length));
        offset += length;
        return out;
      }
      case 0xdc: {
        const length = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        return Array.from({ length }, () => read());
      }
      case 0xde: {
        const length = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        const out: Record<string, unknown> = {};
        for (let i = 0; i < length; i += 1) out[String(read())] = read();
        return out;
      }
      default:
        throw new Error(`Unsupported MessagePack prefix 0x${prefix.toString(16)}.`);
    }
  };
  return read();
}
