"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const INTRO_MEDIA_URL = "/session-entry-video/kawabunga-intro.mp4?v=1";
const INTRO_POSTER_URL =
  "/session-entry-video/kawabunga-intro-poster.jpg?v=1";
export const SESSION_INTRO_TIMELINE = Object.freeze({
  portalProgress: 1,
  entryCrossfadeMs: 180,
  illuminationAtSeconds: 1.2,
  whiteoutAtSeconds: 3,
  foregroundRevealAtSeconds: 4.2,
});

export type SessionIntroPlaybackState =
  | "idle"
  | "playing"
  | "portal-hold"
  | "revealing"
  | "complete"
  | "error";

export type SessionIntroProgress = {
  progress: number;
  mediaTime: number;
  duration: number;
};

export type SessionIntroExperienceHandle = {
  play: () => Promise<void>;
  stop: () => void;
};

let videoPreloaded = false;

export function prefetchSessionIntroExperience(): void {
  if (videoPreloaded || typeof document === "undefined") return;
  videoPreloaded = true;

  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "video";
  link.href = INTRO_MEDIA_URL;
  document.head.appendChild(link);

  const video = document.createElement("video");
  video.src = INTRO_MEDIA_URL;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.load();
}

export const SessionIntroExperience = forwardRef<
  SessionIntroExperienceHandle,
  {
    active: boolean;
    readyToReveal: boolean;
    onComplete: () => void;
    onFirstFrame?: () => void;
    onForegroundReveal?: () => void;
    onPlaybackStateChange?: (state: SessionIntroPlaybackState) => void;
    onProgress?: (sample: SessionIntroProgress) => void;
  }
>(function SessionIntroExperience(
  {
    active,
    readyToReveal,
    onComplete,
    onFirstFrame,
    onForegroundReveal,
    onPlaybackStateChange,
    onProgress,
  },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const posterRef = useRef<HTMLDivElement | null>(null);
  const whiteoutRef = useRef<HTMLDivElement | null>(null);
  const videoFrameRef = useRef<number | null>(null);
  const fallbackFrameRef = useRef<number | null>(null);
  const sceneCoverTimerRef = useRef<number | null>(null);
  const frameGenerationRef = useRef(0);
  const playbackStartedAtRef = useRef(0);
  const waitingAtEndRef = useRef(false);
  const exitingRef = useRef(false);
  const firstFramePresentedRef = useRef(false);
  const foregroundRevealedRef = useRef(false);
  const readyToRevealRef = useRef(readyToReveal);
  const onCompleteRef = useRef(onComplete);
  const onFirstFrameRef = useRef(onFirstFrame);
  const onForegroundRevealRef = useRef(onForegroundReveal);
  const onPlaybackStateChangeRef = useRef(onPlaybackStateChange);
  const onProgressRef = useRef(onProgress);
  const [exiting, setExiting] = useState(false);

  useLayoutEffect(() => {
    readyToRevealRef.current = readyToReveal;
    onCompleteRef.current = onComplete;
    onFirstFrameRef.current = onFirstFrame;
    onForegroundRevealRef.current = onForegroundReveal;
    onPlaybackStateChangeRef.current = onPlaybackStateChange;
    onProgressRef.current = onProgress;
  }, [
    onComplete,
    onFirstFrame,
    onForegroundReveal,
    onPlaybackStateChange,
    onProgress,
    readyToReveal,
  ]);

  const stopPlayback = useCallback(() => {
    frameGenerationRef.current += 1;
    if (fallbackFrameRef.current !== null) {
      window.cancelAnimationFrame(fallbackFrameRef.current);
      fallbackFrameRef.current = null;
    }
    if (sceneCoverTimerRef.current !== null) {
      window.clearTimeout(sceneCoverTimerRef.current);
      sceneCoverTimerRef.current = null;
    }
    const video = videoRef.current;
    if (videoFrameRef.current !== null && video?.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(videoFrameRef.current);
      videoFrameRef.current = null;
    }
    video?.pause();
  }, []);

  const startReveal = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setExiting(true);
    onPlaybackStateChangeRef.current?.("revealing");
  }, []);

  const completePlayback = useCallback(() => {
    onPlaybackStateChangeRef.current?.("complete");
    onCompleteRef.current();
  }, []);

  const updateVisuals = useCallback(
    (mediaTime: number, duration: number) => {
      const video = videoRef.current;
      const whiteout = whiteoutRef.current;
      if (!video || !whiteout) return;

      const illuminationRange = Math.max(
        0.001,
        SESSION_INTRO_TIMELINE.whiteoutAtSeconds -
          SESSION_INTRO_TIMELINE.illuminationAtSeconds,
      );
      const illuminationLinear = clamp01(
        (mediaTime - SESSION_INTRO_TIMELINE.illuminationAtSeconds) /
          illuminationRange,
      );
      const illumination = Math.pow(illuminationLinear, 1.65);
      const reveal =
        mediaTime <= SESSION_INTRO_TIMELINE.whiteoutAtSeconds
          ? 0
          : smoothstep(
              SESSION_INTRO_TIMELINE.whiteoutAtSeconds,
              Math.max(
                SESSION_INTRO_TIMELINE.whiteoutAtSeconds + 0.001,
                duration,
              ),
              mediaTime,
            );
      const videoFade = smoothstep(2.82, 3.04, mediaTime);
      const whiteoutOpacity =
        mediaTime <= SESSION_INTRO_TIMELINE.whiteoutAtSeconds
          ? illumination
          : 1 - reveal;

      video.style.opacity = firstFramePresentedRef.current
        ? String(1 - videoFade)
        : "0";
      video.style.filter = `brightness(${1 + illumination * 1.9}) saturate(${1 + illumination * 0.08})`;
      whiteout.style.opacity = String(clamp01(whiteoutOpacity));

      if (mediaTime >= SESSION_INTRO_TIMELINE.whiteoutAtSeconds) {
        startReveal();
      }
      if (
        mediaTime >= SESSION_INTRO_TIMELINE.foregroundRevealAtSeconds &&
        !foregroundRevealedRef.current
      ) {
        foregroundRevealedRef.current = true;
        onForegroundRevealRef.current?.();
      }
    },
    [startReveal],
  );

  const scheduleVisualFrames = useCallback(
    (video: HTMLVideoElement, generation: number) => {
      const schedule = () => {
        if (generation !== frameGenerationRef.current || video.ended) return;
        const handleFrame = (mediaTime: number) => {
          if (generation !== frameGenerationRef.current) return;
          const isFirstFrame = !firstFramePresentedRef.current;
          if (isFirstFrame) {
            firstFramePresentedRef.current = true;
          }
          const duration = Number.isFinite(video.duration) ? video.duration : 0;
          updateVisuals(mediaTime, duration);
          if (isFirstFrame) {
            if (posterRef.current) posterRef.current.style.opacity = "0";
            const elapsed = performance.now() - playbackStartedAtRef.current;
            const coverDelay = Math.max(
              0,
              SESSION_INTRO_TIMELINE.entryCrossfadeMs - elapsed,
            );
            sceneCoverTimerRef.current = window.setTimeout(() => {
              sceneCoverTimerRef.current = null;
              onFirstFrameRef.current?.();
            }, coverDelay);
          }
          schedule();
        };
        if (typeof video.requestVideoFrameCallback === "function") {
          videoFrameRef.current = video.requestVideoFrameCallback(
            (_now, metadata) => handleFrame(metadata.mediaTime),
          );
        } else {
          fallbackFrameRef.current = window.requestAnimationFrame(() => {
            if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
              schedule();
              return;
            }
            handleFrame(video.currentTime);
          });
        }
      };
      schedule();
    },
    [updateVisuals],
  );

  const startPlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) throw new Error("Intro media element is not mounted.");

    stopPlayback();
    waitingAtEndRef.current = false;
    exitingRef.current = false;
    firstFramePresentedRef.current = false;
    foregroundRevealedRef.current = false;
    setExiting(false);
    if (posterRef.current) posterRef.current.style.opacity = "1";
    video.style.opacity = "0";
    if (video.ended || video.currentTime > 0.01) video.currentTime = 0;
    video.volume = 1;
    updateVisuals(0, video.duration);
    const generation = frameGenerationRef.current;
    playbackStartedAtRef.current = performance.now();

    try {
      await video.play();
      onPlaybackStateChangeRef.current?.("playing");
      scheduleVisualFrames(video, generation);
    } catch (err) {
      console.warn("[sandbox] intro media playback failed", err);
      onPlaybackStateChangeRef.current?.("error");
      throw err;
    }
  }, [scheduleVisualFrames, stopPlayback, updateVisuals]);

  useImperativeHandle(
    ref,
    () => ({ play: startPlayback, stop: stopPlayback }),
    [startPlayback, stopPlayback],
  );

  useLayoutEffect(() => {
    if (active && readyToReveal && waitingAtEndRef.current) completePlayback();
  }, [active, completePlayback, readyToReveal]);

  useLayoutEffect(() => {
    if (active) return;
    stopPlayback();
    waitingAtEndRef.current = false;
    exitingRef.current = false;
    firstFramePresentedRef.current = false;
    foregroundRevealedRef.current = false;
    setExiting(false);
    if (posterRef.current) posterRef.current.style.opacity = "1";
    if (videoRef.current) videoRef.current.style.opacity = "0";
    onPlaybackStateChangeRef.current?.("idle");
  }, [active, stopPlayback]);

  useLayoutEffect(() => stopPlayback, [stopPlayback]);

  const emitProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    onProgressRef.current?.({
      progress: duration > 0 ? Math.min(1, video.currentTime / duration) : 0,
      mediaTime: video.currentTime,
      duration,
    });
  }, []);

  const handleEnded = useCallback(() => {
    waitingAtEndRef.current = true;
    const video = videoRef.current;
    if (video) updateVisuals(video.duration, video.duration);
    emitProgress();
    if (readyToRevealRef.current) {
      completePlayback();
    } else {
      onPlaybackStateChangeRef.current?.("portal-hold");
    }
  }, [completePlayback, emitProgress, updateVisuals]);

  return (
    <div
      aria-hidden
      data-session-intro={exiting ? "revealing" : "playing"}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        overflow: "hidden",
        background: "transparent",
        display: "block",
        opacity: active ? 1 : 0,
        pointerEvents: active ? "auto" : "none",
        transition: `opacity ${SESSION_INTRO_TIMELINE.entryCrossfadeMs}ms ease-out`,
        willChange: "opacity",
      }}
    >
      <div
        ref={posterRef}
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "#050b0c",
          backgroundImage: `url("${INTRO_POSTER_URL}")`,
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "cover",
          opacity: 1,
          pointerEvents: "none",
        }}
      />
      <video
        ref={videoRef}
        data-session-intro-media
        src={INTRO_MEDIA_URL}
        playsInline
        preload="auto"
        onLoadedMetadata={emitProgress}
        onTimeUpdate={emitProgress}
        onEnded={handleEnded}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          background: "transparent",
          opacity: 0,
          willChange: "filter, opacity",
        }}
      />
      <div
        ref={whiteoutRef}
        style={{
          position: "absolute",
          inset: 0,
          background: "#fff",
          opacity: 0,
          pointerEvents: "none",
          willChange: "opacity",
        }}
      />
    </div>
  );
});

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
