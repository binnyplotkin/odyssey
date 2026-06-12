/**
 * Node client for the audio-rt streaming-STT WebSocket. Streams an
 * utterance's frames at real-time pace (so VAD endpointing is honest),
 * keeps pushing trailing silence until the server detects end-of-speech
 * and returns words, then reports the transcript plus the timing marks
 * that make up the voice-to-voice budget's first half.
 *
 * Why real-time pacing matters: the server's 800ms end-of-speech window is
 * counted in audio frames inside its receive loop. Dump frames as fast as
 * possible and the 800ms of trailing silence elapses in ~no wall-clock
 * time, so the measured endpointing delay would be fiction. `--turbo`
 * exists for quick smoke checks and is explicitly non-representative.
 */

import { encodeAudioFrame, decodeMsgpack, type SttMessage } from "./msgpack";
import {
  AUDIO_RT_FRAME_SAMPLES,
  AUDIO_RT_SAMPLE_RATE,
  silenceFrames,
  toFrames,
} from "./wav";

export const DEFAULT_AUDIO_RT_WS_URL =
  process.env.AUDIO_RT_WS_URL ?? "wss://audio-rt-production.up.railway.app/api/asr-streaming";

const FRAME_MS = (AUDIO_RT_FRAME_SAMPLES / AUDIO_RT_SAMPLE_RATE) * 1000; // 80ms
const LEADING_SILENCE_FRAMES = 4; // ~320ms to let VAD settle before speech
const MAX_TRAILING_SILENCE_MS = 6_000; // safety cap waiting for end-of-speech + STT
const WORD_GRACE_MS = 350; // after the last word, wait this long for stragglers

export type SttSttMark = {
  /** connect → Ready frame. */
  wsHandshakeMs: number | null;
  /** connect → last speech frame dispatched (i.e. moment user stopped speaking). */
  speechEndMs: number;
  /** connect → first Word frame. */
  firstWordMs: number | null;
  /** speechEnd → first Word: endpointing (≈800ms) + whisper compute + network. */
  endpointToWordMs: number | null;
  /** first → last Word. */
  wordSpanMs: number | null;
};

export type SttResult = {
  transcript: string;
  words: Array<{ text: string; startTime: number }>;
  marks: SttSttMark;
  /** performance.now() at the instant user speech ended — the voice-to-voice origin. */
  speechEndPerf: number;
  error: string | null;
};

export type StreamUtteranceOptions = {
  samples: Float32Array; // mono 24kHz
  wsUrl?: string;
  /** Send frames as fast as possible instead of real-time. Non-representative. */
  turbo?: boolean;
};

export async function streamUtterance(opts: StreamUtteranceOptions): Promise<SttResult> {
  const wsUrl = opts.wsUrl ?? DEFAULT_AUDIO_RT_WS_URL;
  const frameMs = opts.turbo ? 0 : FRAME_MS;
  const t0 = performance.now();
  const since = () => performance.now() - t0;

  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  const words: Array<{ text: string; startTime: number }> = [];
  let wsHandshakeMs: number | null = null;
  let firstWordMs: number | null = null;
  let firstWordPerf: number | null = null;
  let lastWordPerf: number | null = null;
  let error: string | null = null;
  let ready = false;

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("audio-rt websocket error"));
  }).catch((err) => {
    error = err instanceof Error ? err.message : String(err);
  });

  if (error) {
    return emptyResult(error, since());
  }

  ws.onmessage = (event: MessageEvent) => {
    try {
      const msg = decodeMsgpack(new Uint8Array(event.data as ArrayBuffer)) as SttMessage;
      if (msg.type === "Ready") {
        ready = true;
        wsHandshakeMs = since();
      } else if (msg.type === "Word") {
        if (firstWordMs === null) {
          firstWordMs = since();
          firstWordPerf = performance.now();
        }
        lastWordPerf = performance.now();
        words.push({ text: msg.text, startTime: msg.start_time });
      } else if (msg.type === "Error") {
        error = msg.message ?? "streaming STT error";
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  };

  // Drift-corrected pacing: align each frame to an absolute schedule
  // (pacingStart + n·frameMs) rather than sleeping a fixed frameMs per
  // iteration, so send + loop overhead doesn't accumulate. Inaccurate
  // pacing would inflate how long the server's 800ms silence window takes
  // to deliver, over-measuring endpointing.
  const pacingStart = performance.now();
  let frameIdx = 0;
  const paced = async (frame: Float32Array): Promise<void> => {
    if (ws.readyState === WebSocket.OPEN) ws.send(encodeAudioFrame(frame));
    frameIdx += 1;
    if (frameMs > 0) {
      const wait = pacingStart + frameIdx * frameMs - performance.now();
      if (wait > 0) await sleep(wait);
    }
  };

  // Lead-in silence, then the utterance, then trailing silence.
  for (const frame of silenceFrames(LEADING_SILENCE_FRAMES)) await paced(frame);

  const speechFrames = toFrames(opts.samples);
  let speechEndMs = since();
  let speechEndPerf = performance.now();
  for (let i = 0; i < speechFrames.length; i += 1) {
    if (ws.readyState === WebSocket.OPEN) ws.send(encodeAudioFrame(speechFrames[i]));
    frameIdx += 1;
    if (i === speechFrames.length - 1) {
      // The instant the user's audio ends — the voice-to-voice origin.
      speechEndMs = since();
      speechEndPerf = performance.now();
    }
    if (frameMs > 0) {
      const wait = pacingStart + frameIdx * frameMs - performance.now();
      if (wait > 0) await sleep(wait);
    }
  }

  // Trailing silence drives the server's end-of-speech detection. Keep
  // sending until words arrive (plus a grace window) or the cap trips.
  const silenceStart = performance.now();
  const oneSilence = new Float32Array(AUDIO_RT_FRAME_SAMPLES);
  while (performance.now() - silenceStart < MAX_TRAILING_SILENCE_MS) {
    await paced(oneSilence);
    if (error) break;
    if (lastWordPerf !== null && performance.now() - lastWordPerf > WORD_GRACE_MS) break;
  }

  try {
    ws.close(1000, "sonar turn complete");
  } catch {
    /* noop */
  }

  void ready;
  const transcript = words
    .map((w) => w.text)
    .join(" ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();

  return {
    transcript,
    words,
    speechEndPerf,
    error: error ?? (transcript.length === 0 ? "stt-empty" : null),
    marks: {
      wsHandshakeMs: round1(wsHandshakeMs),
      speechEndMs: round1(speechEndMs)!,
      firstWordMs: round1(firstWordMs),
      endpointToWordMs:
        firstWordPerf !== null ? round1(firstWordPerf - speechEndPerf) : null,
      wordSpanMs:
        firstWordPerf !== null && lastWordPerf !== null
          ? round1(lastWordPerf - firstWordPerf)
          : null,
    },
  };
}

function emptyResult(error: string, sinceMs: number): SttResult {
  return {
    transcript: "",
    words: [],
    speechEndPerf: performance.now(),
    error,
    marks: {
      wsHandshakeMs: null,
      speechEndMs: round1(sinceMs)!,
      firstWordMs: null,
      endpointToWordMs: null,
      wordSpanMs: null,
    },
  };
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}
