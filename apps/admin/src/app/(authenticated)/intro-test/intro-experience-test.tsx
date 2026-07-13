"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Play, RotateCcw, Unlock } from "react-feather";
import {
  SESSION_INTRO_TIMELINE,
  SessionIntroExperience,
  type SessionIntroExperienceHandle,
  type SessionIntroPlaybackState,
  type SessionIntroProgress,
} from "@/components/character-sandbox/session-intro-experience";
import {
  WavefieldStage,
  createEmptyAudioData,
} from "@/components/wavefield-stage";

type ReadinessMode = "immediate" | "2s" | "5s" | "manual";

const READINESS_OPTIONS: Array<{ value: ReadinessMode; label: string }> = [
  { value: "immediate", label: "Immediate" },
  { value: "2s", label: "2 sec" },
  { value: "5s", label: "5 sec" },
  { value: "manual", label: "Manual" },
];

const EMPTY_PROGRESS: SessionIntroProgress = {
  progress: 0,
  mediaTime: 0,
  duration: 0,
};

export function IntroExperienceTest() {
  const [active, setActive] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [readinessMode, setReadinessMode] =
    useState<ReadinessMode>("immediate");
  const [playbackState, setPlaybackState] =
    useState<SessionIntroPlaybackState>("idle");
  const [sample, setSample] =
    useState<SessionIntroProgress>(EMPTY_PROGRESS);
  const introExperienceRef = useRef<SessionIntroExperienceHandle | null>(null);
  const readinessTimerRef = useRef<number | null>(null);
  const waveAudioRef = useRef(createEmptyAudioData());

  const clearReadinessTimer = useCallback(() => {
    if (readinessTimerRef.current === null) return;
    window.clearTimeout(readinessTimerRef.current);
    readinessTimerRef.current = null;
  }, []);

  useEffect(() => {
    return clearReadinessTimer;
  }, [clearReadinessTimer]);

  const handleRun = useCallback(() => {
    clearReadinessTimer();
    const immediatelyReady = readinessMode === "immediate";
    flushSync(() => {
      setRunKey((value) => value + 1);
      setSample(EMPTY_PROGRESS);
      setPlaybackState("playing");
      setReady(immediatelyReady);
      setActive(true);
    });

    const delayMs = readinessMode === "2s" ? 2_000 : readinessMode === "5s" ? 5_000 : 0;
    if (delayMs > 0) {
      readinessTimerRef.current = window.setTimeout(() => {
        readinessTimerRef.current = null;
        setReady(true);
      }, delayMs);
    }
    void introExperienceRef.current
      ?.play()
      .catch(() => setPlaybackState("error"));
  }, [clearReadinessTimer, readinessMode]);

  const handleReset = useCallback(() => {
    clearReadinessTimer();
    setActive(false);
    setReady(false);
    setSample(EMPTY_PROGRESS);
    setPlaybackState("idle");
  }, [clearReadinessTimer]);

  const handlePlaybackStateChange = useCallback(
    (state: SessionIntroPlaybackState) => setPlaybackState(state),
    [],
  );
  const handleProgress = useCallback(
    (next: SessionIntroProgress) => setSample(next),
    [],
  );
  const handleComplete = useCallback(() => setPlaybackState("complete"), []);

  const progressPercent = Math.round(sample.progress * 1000) / 10;
  const portalPercent = SESSION_INTRO_TIMELINE.portalProgress * 100;

  return (
    <div className="relative h-full min-h-[600px] overflow-hidden bg-[var(--background)] text-[var(--text-primary)]">
      <div className="absolute inset-0 z-0">
        <WavefieldStage audioData={waveAudioRef.current} idleMotion="ambient" />
      </div>
      <div className="absolute inset-0 z-[1] bg-[rgba(7,10,14,.12)]" />

      <header className="absolute inset-x-0 top-0 z-10 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[rgba(12,15,19,.9)] px-5 py-3 backdrop-blur-md">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-normal">Session intro test</h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <StatusDot state={playbackState} />
            <span className="font-mono uppercase">{playbackState}</span>
            <span aria-hidden>/</span>
            <span>{ready ? "systems ready" : "warming"}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <div
            role="group"
            aria-label="Readiness timing"
            className="flex h-9 overflow-hidden border border-[var(--border-medium)] bg-[var(--surface-1)]"
          >
            {READINESS_OPTIONS.map((option) => {
              const selected = readinessMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setReadinessMode(option.value)}
                  className="min-w-[64px] border-r border-[var(--border-medium)] px-3 text-xs last:border-r-0"
                  style={{
                    color: selected ? "var(--accent-on)" : "var(--text-secondary)",
                    background: selected ? "var(--accent-strong)" : "transparent",
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {readinessMode === "manual" && active && !ready ? (
            <button
              type="button"
              onClick={() => setReady(true)}
              className="flex h-9 items-center gap-2 border border-[var(--border-medium)] bg-[var(--surface-1)] px-3 text-xs font-medium"
            >
              <Unlock size={15} />
              Release
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleRun}
            className="flex h-9 items-center gap-2 bg-[var(--accent-strong)] px-4 text-xs font-semibold text-[var(--accent-on)]"
          >
            <Play size={15} fill="currentColor" />
            Run intro
          </button>
          <button
            type="button"
            onClick={handleReset}
            aria-label="Reset intro test"
            title="Reset intro test"
            className="grid size-9 place-items-center border border-[var(--border-medium)] bg-[var(--surface-1)] text-[var(--text-secondary)]"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </header>

      <div className="absolute inset-x-0 bottom-0 z-10 border-t border-[var(--border-subtle)] bg-[rgba(12,15,19,.92)] px-5 py-4 backdrop-blur-md">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-5">
          <Metric label="Media time" value={`${sample.mediaTime.toFixed(2)}s`} />
          <Metric label="Duration" value={sample.duration ? `${sample.duration.toFixed(2)}s` : "--"} />
          <Metric label="Progress" value={`${progressPercent.toFixed(1)}%`} />
          <Metric label="Portal" value={`${portalPercent.toFixed(0)}%`} />
          <Metric
            label="Whiteout"
            value={`${SESSION_INTRO_TIMELINE.whiteoutAtSeconds.toFixed(1)}s`}
          />
        </div>
        <div className="relative mt-4 h-2 bg-[var(--surface-1)]">
          <div
            className="absolute inset-y-0 left-0 bg-[var(--accent-strong)] transition-[width] duration-75"
            style={{ width: `${Math.min(100, progressPercent)}%` }}
          />
          <div
            className="absolute -top-1 h-4 w-px bg-white"
            style={{ left: `${portalPercent}%` }}
            title="Portal marker"
          />
        </div>
      </div>

      <SessionIntroExperience
        key={runKey}
        ref={introExperienceRef}
        active={active}
        readyToReveal={ready}
        onPlaybackStateChange={handlePlaybackStateChange}
        onProgress={handleProgress}
        onComplete={handleComplete}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-xs text-[var(--text-primary)]">
        {value}
      </div>
    </div>
  );
}

function StatusDot({ state }: { state: SessionIntroPlaybackState }) {
  const color =
    state === "error"
      ? "var(--status-error)"
      : state === "complete"
        ? "var(--status-live)"
        : state === "idle"
          ? "var(--text-tertiary)"
          : "var(--accent-strong)";
  return <span aria-hidden className="size-2" style={{ background: color }} />;
}
