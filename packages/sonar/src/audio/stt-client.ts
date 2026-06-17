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
// captureAllBursts mode: a fixed listen window after speech so a SECOND
// burst (a premature cutoff re-firing after a mid-sentence pause) is caught.
// Generous because a semantic endpointer that *holds* a turn open delays its
// final transcribe — too short a window would miss the late burst and
// mismeasure a cut as whole.
const TRAILING_CAPTURE_MS = 3_000;
// Words from one transcribe() arrive in a tight burst (<10ms apart); a gap
// larger than this means a new burst — i.e. the endpointer fired again.
const BURST_GAP_MS = 400;

export type SttSttMark = {
  /** connect → Ready frame. */
  wsHandshakeMs: number | null;
  /** connect → last speech frame dispatched (i.e. moment user stopped speaking). */
  speechEndMs: number;
  /** connect → first Word frame (the genuine first word, even if a mid-utterance burst). */
  firstWordMs: number | null;
  /**
   * speechEnd → first Word delivered AT/AFTER speechEnd: endpointing (≈800ms) +
   * whisper compute + network. Measured from the post-speech-end transcribe, not
   * an early mid-utterance burst — see streamUtterance for why. Null when no word
   * arrives after speech end (so the metric is explicitly absent, never a
   * silently-dropped negative).
   */
  endpointToWordMs: number | null;
  /** first → last Word within the post-speech-end burst. */
  wordSpanMs: number | null;
};

export type SttResult = {
  transcript: string;
  words: Array<{ text: string; startTime: number }>;
  marks: SttSttMark;
  /** performance.now() at the instant user speech ended — the voice-to-voice origin. */
  speechEndPerf: number;
  /**
   * Number of distinct word-bursts (transcribe finals) for this utterance.
   * 1 = the utterance was kept whole; ≥2 = the endpointer fired mid-utterance
   * (a premature cutoff). The endpointing cutoff metric.
   */
  finals: number;
  error: string | null;
};

export type StreamUtteranceOptions = {
  samples: Float32Array; // mono 24kHz
  wsUrl?: string;
  /** Send frames as fast as possible instead of real-time. Non-representative. */
  turbo?: boolean;
  /**
   * Listen for a fixed window after speech (instead of stopping at the first
   * word) so a second burst from a premature cutoff is captured. Required for
   * pause-aware endpointing fixtures; adds ~1.8s/turn so it's off by default.
   */
  captureAllBursts?: boolean;
  /** Optional sink for non-fatal STT diagnostics (mid-utterance endpoint fires). */
  log?: (line: string) => void;
};

export async function streamUtterance(opts: StreamUtteranceOptions): Promise<SttResult> {
  const wsUrl = opts.wsUrl ?? DEFAULT_AUDIO_RT_WS_URL;
  const frameMs = opts.turbo ? 0 : FRAME_MS;
  const t0 = performance.now();
  const since = () => performance.now() - t0;

  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  const words: Array<{ text: string; startTime: number }> = [];
  const wordPerfTimes: number[] = []; // arrival times, for burst counting
  let wsHandshakeMs: number | null = null;
  let firstWordMs: number | null = null;
  let firstWordPerf: number | null = null;
  // Words delivered AFTER the user actually stopped speaking. A long "complete"
  // line with an internal sentence boundary (e.g. "…in your life. Which journey
  // …") trips the server's fixed VAD window mid-utterance, so an early burst —
  // transcribing speech the user is still finishing — arrives BEFORE speechEnd.
  // endpoint-to-word measured from that early burst is a nonsense negative; the
  // genuine post-endpoint latency is the first word delivered at/after speechEnd.
  let speechEnded = false;
  let firstWordAfterEndPerf: number | null = null;
  let lastWordAfterEndPerf: number | null = null;
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
        const nowPerf = performance.now();
        if (firstWordMs === null) {
          firstWordMs = since();
          firstWordPerf = nowPerf;
        }
        // Partition words at speechEnd: only those delivered after the user
        // stopped speaking measure post-endpoint latency and gate the wait below.
        if (speechEnded) {
          if (firstWordAfterEndPerf === null) firstWordAfterEndPerf = nowPerf;
          lastWordAfterEndPerf = nowPerf;
        }
        wordPerfTimes.push(nowPerf);
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
      // The instant the user's audio ends — the voice-to-voice origin. From
      // here on, arriving words count as post-endpoint (see the message handler).
      speechEndMs = since();
      speechEndPerf = performance.now();
      speechEnded = true;
    }
    if (frameMs > 0) {
      const wait = pacingStart + frameIdx * frameMs - performance.now();
      if (wait > 0) await sleep(wait);
    }
  }

  // Trailing silence drives the server's end-of-speech detection.
  const silenceStart = performance.now();
  const oneSilence = new Float32Array(AUDIO_RT_FRAME_SAMPLES);
  if (opts.captureAllBursts) {
    // Listen a fixed window so a second burst (premature cutoff re-firing)
    // is captured — don't stop at the first word.
    while (performance.now() - silenceStart < TRAILING_CAPTURE_MS) {
      await paced(oneSilence);
      if (error) break;
    }
  } else {
    // Stop once the POST-speech-end transcribe arrives (plus a grace window) or
    // the cap trips. Gating on lastWordAfterEndPerf — not any word — is what
    // keeps an early mid-utterance burst from short-circuiting the wait: bailing
    // on the early burst would truncate the transcript (dropping the rest of the
    // utterance) and leave endpoint-to-word with only a pre-speechEnd word.
    while (performance.now() - silenceStart < MAX_TRAILING_SILENCE_MS) {
      await paced(oneSilence);
      if (error) break;
      if (lastWordAfterEndPerf !== null && performance.now() - lastWordAfterEndPerf > WORD_GRACE_MS) break;
    }
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

  // Endpoint-to-word is the latency from speech end to the first word delivered
  // AFTER it. Null (not a negative artifact) when no such word arrives.
  const endpointToWordMs =
    firstWordAfterEndPerf !== null ? round1(firstWordAfterEndPerf - speechEndPerf) : null;
  const wordSpanMs =
    firstWordAfterEndPerf !== null && lastWordAfterEndPerf !== null
      ? round1(lastWordAfterEndPerf - firstWordAfterEndPerf)
      : null;

  // Surface what used to be silent: the endpointer fired mid-utterance (an early
  // burst arrived before speech end), so this metric is taken from the
  // post-endpoint burst — or, in the degenerate case, is explicitly null. The
  // inline `firstWordPerf !== null` is what narrows it to a number for the math.
  const endpointFiredMidSpeech = firstWordPerf !== null && firstWordAfterEndPerf !== firstWordPerf;
  if (opts.log && endpointFiredMidSpeech && firstWordPerf !== null) {
    const earlyByMs = Math.round(speechEndPerf - firstWordPerf);
    opts.log(
      endpointToWordMs !== null
        ? `  stt: endpointer fired mid-utterance (first word ${earlyByMs}ms before speech end); ` +
            `endpoint-to-word taken from the post-endpoint burst (+${endpointToWordMs}ms).`
        : `  stt: endpointer fired mid-utterance and no word arrived after speech end; ` +
            `endpoint-to-word is null (avoids a silently-dropped negative).`,
    );
  }

  return {
    transcript,
    words,
    speechEndPerf,
    finals: countBursts(wordPerfTimes),
    error: error ?? (transcript.length === 0 ? "stt-empty" : null),
    marks: {
      wsHandshakeMs: round1(wsHandshakeMs),
      speechEndMs: round1(speechEndMs)!,
      firstWordMs: round1(firstWordMs),
      endpointToWordMs,
      wordSpanMs,
    },
  };
}

/** Count word-bursts: 1 + the number of inter-word gaps wider than BURST_GAP_MS. */
function countBursts(times: number[]): number {
  if (times.length === 0) return 0;
  let bursts = 1;
  for (let i = 1; i < times.length; i += 1) {
    if (times[i] - times[i - 1] > BURST_GAP_MS) bursts += 1;
  }
  return bursts;
}

function emptyResult(error: string, sinceMs: number): SttResult {
  return {
    transcript: "",
    words: [],
    speechEndPerf: performance.now(),
    finals: 0,
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
