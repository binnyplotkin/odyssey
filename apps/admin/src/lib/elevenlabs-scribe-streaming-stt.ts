"use client";

const ELEVENLABS_SCRIBE_REALTIME_URL =
  "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
const SOURCE_SAMPLE_RATE = 24_000;
const TARGET_SAMPLE_RATE = 16_000;
const MODEL_ID = "scribe_v2_realtime";

type ScribeMessage =
  | { message_type: "session_started"; session_id?: string }
  | { message_type: "partial_transcript"; text?: string }
  | { message_type: "committed_transcript"; text?: string }
  | { message_type: "committed_transcript_with_timestamps"; text?: string }
  | { message_type: string; error?: string; message?: string; detail?: string };

export type ElevenLabsScribeStreamingSttHandlers = {
  onOpen?: () => void;
  onPartialTranscript?: (text: string) => void;
  onCommittedTranscript?: (text: string) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
};

export class ElevenLabsScribeStreamingSttSession {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private stopped = false;
  private opened = false;

  async start(
    stream: MediaStream,
    handlers: ElevenLabsScribeStreamingSttHandlers = {},
  ) {
    if (this.stopped) throw new Error("Cannot reuse a stopped STT session.");

    const token = await fetchScribeToken();
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

    const url = new URL(ELEVENLABS_SCRIBE_REALTIME_URL);
    url.searchParams.set("model_id", MODEL_ID);
    url.searchParams.set("token", token);
    url.searchParams.set("audio_format", "pcm_16000");
    url.searchParams.set("commit_strategy", "vad");
    url.searchParams.set("vad_silence_threshold_secs", "0.8");
    url.searchParams.set("min_speech_duration_ms", "100");
    url.searchParams.set("min_silence_duration_ms", "100");
    url.searchParams.set("include_timestamps", "false");

    const ws = new WebSocket(url.toString());
    this.ws = ws;

    ws.onopen = () => {
      node.port.onmessage = (event) => {
        const data = event.data as
          | { type: "frame"; samples: Float32Array }
          | { type: "level"; rms: number };
        if (data.type !== "frame" || ws.readyState !== WebSocket.OPEN) return;
        ws.send(
          JSON.stringify({
            message_type: "input_audio_chunk",
            audio_base_64: pcm16Base64(downsample24kTo16k(data.samples)),
            sample_rate: TARGET_SAMPLE_RATE,
          }),
        );
      };
      source.connect(node);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as ScribeMessage;
        if (message.message_type === "session_started") {
          this.opened = true;
          handlers.onOpen?.();
          return;
        }
        if (message.message_type === "partial_transcript") {
          handlers.onPartialTranscript?.(messageText(message));
          return;
        }
        if (
          message.message_type === "committed_transcript" ||
          message.message_type === "committed_transcript_with_timestamps"
        ) {
          handlers.onCommittedTranscript?.(messageText(message));
          return;
        }
        if (message.message_type.toLowerCase().includes("error")) {
          handlers.onError?.(messageError(message));
        }
      } catch (err) {
        handlers.onError?.(err instanceof Error ? err.message : String(err));
      }
    };
    ws.onerror = () => {
      if (!this.stopped) handlers.onError?.("ElevenLabs Scribe websocket error");
    };
    ws.onclose = () => {
      if (!this.stopped && !this.opened) {
        handlers.onError?.("ElevenLabs Scribe websocket closed before session start");
      }
      handlers.onClose?.();
    };
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

function messageText(message: ScribeMessage): string {
  return "text" in message ? message.text?.trim() ?? "" : "";
}

function messageError(message: ScribeMessage): string {
  if (!("error" in message) && !("message" in message) && !("detail" in message)) {
    return message.message_type;
  }
  return (
    ("error" in message ? message.error : undefined) ??
    ("message" in message ? message.message : undefined) ??
    ("detail" in message ? message.detail : undefined) ??
    message.message_type
  );
}

async function fetchScribeToken(): Promise<string> {
  const response = await fetch("/api/audio/elevenlabs-scribe-token", {
    method: "POST",
  });
  const payload = (await response.json().catch(() => ({}))) as {
    token?: string;
    error?: string;
  };
  if (!response.ok || !payload.token) {
    throw new Error(payload.error ?? `scribe token: ${response.status}`);
  }
  return payload.token;
}

function downsample24kTo16k(samples: Float32Array): Float32Array {
  const ratio = SOURCE_SAMPLE_RATE / TARGET_SAMPLE_RATE;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(samples.length - 1, lo + 1);
    const frac = pos - lo;
    out[i] = samples[lo] * (1 - frac) + samples[hi] * frac;
  }
  return out;
}

function pcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, Math.round(clamped * 0x7fff), true);
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
