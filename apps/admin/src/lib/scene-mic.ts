"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MoshiStreamingSttSession } from "./moshi-client";

/**
 * Mic capture + STT for the scene runner.
 *
 * Owns one long-lived MoshiStreamingSttSession that stays open for the
 * duration of the scene. Words are accumulated as the user speaks; when
 * the VAD's pause-prediction head crosses threshold AND we've buffered
 * at least one real word, we flush the accumulated transcript as one
 * utterance and reset for the next.
 *
 * The runner consumer just hands us an `onUtterance(text)` callback —
 * usually pointed at scene-runner's `sendUserMessage`. That callback is
 * responsible for the rest (barge-in, re-entering the orchestration
 * loop, etc.).
 *
 * Phase 1 limitations:
 *  - No acoustic echo gating beyond the browser's built-in AEC. If TTS
 *    audio leaks into the mic and gets transcribed as user speech, the
 *    scene can self-trigger. Mitigation: use headphones for demos.
 *  - The MIN_WORDS_TO_COMMIT guard drops single-word noise, but a clear
 *    "yes" or "no" from the user will also be dropped. Acceptable for
 *    Phase 1; Phase 2 can add semantic intent gating.
 */

const VAD_PAUSE_THRESHOLD = 0.5;
const MIN_WORDS_TO_COMMIT = 2;
// Wait this long after the pause threshold first crosses before
// committing — gives a chance for one more word to arrive (Kyutai STT
// emits ~500ms after audio).
const COMMIT_HOLD_MS = 350;

export type SceneMicStatus =
  | "idle"          // session not started
  | "connecting"    // mic permission + WS handshake
  | "listening"    // session live, waiting for words
  | "error";

export type UseSceneMicCaptureOptions = {
  onUtterance: (text: string) => void;
  // Optional: called continuously with mic level (0..1) for a UI meter.
  onLevel?: (rms: number) => void;
};

export type UseSceneMicCaptureResult = {
  status: SceneMicStatus;
  error: string | null;
  partialTranscript: string;
  micLevel: number;
  start: () => Promise<void>;
  stop: () => void;
};

export function useSceneMicCapture(
  opts: UseSceneMicCaptureOptions,
): UseSceneMicCaptureResult {
  const [status, setStatus] = useState<SceneMicStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [micLevel, setMicLevel] = useState(0);

  const sessionRef = useRef<MoshiStreamingSttSession | null>(null);
  const wordsRef = useRef<string[]>([]);
  const commitTimerRef = useRef<number | null>(null);
  const onUtteranceRef = useRef(opts.onUtterance);
  const onLevelRef = useRef(opts.onLevel);

  useEffect(() => {
    onUtteranceRef.current = opts.onUtterance;
    onLevelRef.current = opts.onLevel;
  }, [opts.onUtterance, opts.onLevel]);

  const clearCommitTimer = useCallback(() => {
    if (commitTimerRef.current != null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, []);

  const commitUtterance = useCallback(() => {
    clearCommitTimer();
    const words = wordsRef.current;
    if (words.length < MIN_WORDS_TO_COMMIT) return;
    const text = words.join(" ").trim();
    wordsRef.current = [];
    setPartialTranscript("");
    sessionRef.current?.resetTranscript();
    if (text) onUtteranceRef.current(text);
  }, [clearCommitTimer]);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    setError(null);
    setStatus("connecting");

    const session = new MoshiStreamingSttSession();
    sessionRef.current = session;

    try {
      await session.start({
        onOpen: () => setStatus("listening"),
        onError: (msg) => {
          setError(msg);
          setStatus("error");
        },
        onWord: (text) => {
          if (!text) return;
          wordsRef.current = [...wordsRef.current, text];
          setPartialTranscript(wordsRef.current.join(" "));
          // Reset the commit timer — more words are coming, so don't
          // commit yet even if VAD already crossed threshold.
          clearCommitTimer();
        },
        onPausePrediction: (probability) => {
          if (probability < VAD_PAUSE_THRESHOLD) {
            clearCommitTimer();
            return;
          }
          if (commitTimerRef.current != null) return;
          if (wordsRef.current.length < MIN_WORDS_TO_COMMIT) return;
          // Hold briefly to allow one more late word (STT lags ~500ms).
          commitTimerRef.current = window.setTimeout(
            commitUtterance,
            COMMIT_HOLD_MS,
          );
        },
        onLevel: (rms) => {
          setMicLevel(rms);
          onLevelRef.current?.(rms);
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus("error");
      sessionRef.current = null;
    }
  }, [clearCommitTimer, commitUtterance]);

  const stop = useCallback(() => {
    clearCommitTimer();
    wordsRef.current = [];
    setPartialTranscript("");
    setMicLevel(0);
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      session.stop().catch(() => undefined);
    }
    setStatus("idle");
  }, [clearCommitTimer]);

  useEffect(() => {
    return () => {
      clearCommitTimer();
      sessionRef.current?.stop().catch(() => undefined);
      sessionRef.current = null;
    };
  }, [clearCommitTimer]);

  return {
    status,
    error,
    partialTranscript,
    micLevel,
    start,
    stop,
  };
}
