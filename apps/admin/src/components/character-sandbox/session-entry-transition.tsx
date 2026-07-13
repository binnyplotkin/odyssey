"use client";

import { useLayoutEffect, useRef, useState } from "react";

const ENTRY_VIDEO_URL = "/session-entry-video/pull-in.mp4";
const EXIT_AT_PROGRESS = 0.72;
const EXIT_MS = 1350;

let videoPreloaded = false;

export function prefetchSessionEntryTransitionVideo(): void {
  if (videoPreloaded || typeof document === "undefined") return;
  videoPreloaded = true;

  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "video";
  link.href = ENTRY_VIDEO_URL;
  document.head.appendChild(link);

  const video = document.createElement("video");
  video.src = ENTRY_VIDEO_URL;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.load();
}

export function SessionEntryTransition({
  active,
  onStart,
  onComplete,
}: {
  active: boolean;
  onStart: () => void;
  onComplete: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const completeTimerRef = useRef<number | null>(null);
  const startedRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [exiting, setExiting] = useState(false);

  useLayoutEffect(() => {
    if (!active) {
      if (completeTimerRef.current) {
        window.clearTimeout(completeTimerRef.current);
        completeTimerRef.current = null;
      }
      setProgress(0);
      setExiting(false);
      startedRef.current = false;
      return;
    }

    const video = videoRef.current;
    setProgress(0);
    setExiting(false);
    if (completeTimerRef.current) {
      window.clearTimeout(completeTimerRef.current);
      completeTimerRef.current = null;
    }
    if (!video) return;

    video.currentTime = 0;

    let frame = 0;
    const tick = () => {
      if (!video.duration || Number.isNaN(video.duration)) {
        setProgress(0);
      } else {
        const nextProgress = Math.min(1, video.currentTime / video.duration);
        setProgress(nextProgress);
        if (nextProgress >= EXIT_AT_PROGRESS) {
          startExit();
          video.pause();
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(() => {
      void video
        .play()
        .then(() => {
          if (!startedRef.current) {
            startedRef.current = true;
            onStart();
          }
          tick();
        })
        .catch((err) => {
          console.warn("[sandbox] entry transition video playback failed", err);
          startExit();
        });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (completeTimerRef.current) window.clearTimeout(completeTimerRef.current);
    };
  }, [active, onStart]);

  function startExit() {
    if (exiting || completeTimerRef.current) return;
    setExiting(true);
    completeTimerRef.current = window.setTimeout(() => {
      completeTimerRef.current = null;
      onComplete();
    }, EXIT_MS);
  }

  if (!active) return null;

  const visualProgress = Math.min(1, progress / EXIT_AT_PROGRESS);
  const fog = smoothstep(0.38, 0.82, visualProgress);
  const finalPull = smoothstep(0.62, 1, visualProgress);
  const bloom = smoothstep(0.5, 1, visualProgress);
  const whiteout = smoothstep(0.64, 0.94, visualProgress);
  const videoScale = 1 + visualProgress * 0.04 + finalPull * 0.2;
  const videoOpacity = exiting ? 0 : 1;
  const fogOpacity = exiting ? 0 : 0.1 + fog * 0.82;
  const veilOpacity = exiting ? 0 : 0.12 + finalPull * 0.18;
  const bloomOpacity = exiting ? 0 : bloom;
  const whiteoutOpacity = exiting ? 0 : whiteout * 1.08;

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        overflow: "hidden",
        pointerEvents: "none",
        background: "transparent",
      }}
    >
      <video
        ref={videoRef}
        src={ENTRY_VIDEO_URL}
        muted
        playsInline
        preload="auto"
        onEnded={startExit}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${videoScale})`,
          opacity: videoOpacity,
          filter: `brightness(${1 + bloom * 1.05}) saturate(${1 + fog * 0.12}) contrast(${1 + finalPull * 0.04}) blur(${finalPull * 2.4}px)`,
          transition: `opacity ${EXIT_MS}ms cubic-bezier(.22,.61,.36,1), transform 80ms linear, filter 80ms linear`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: fogOpacity,
          background:
            "radial-gradient(circle at 50% 54%, rgba(255,255,255,.78), rgba(255,255,255,.24) 22%, transparent 54%), radial-gradient(circle at 22% 72%, rgba(190,225,255,.28), transparent 44%), radial-gradient(circle at 78% 28%, rgba(255,255,255,.28), transparent 42%)",
          filter: `blur(${18 + fog * 32}px)`,
          transform: `scale(${1.02 + finalPull * 0.12})`,
          transition: "opacity 80ms linear, filter 80ms linear, transform 80ms linear",
          mixBlendMode: "screen",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: whiteoutOpacity,
          background: "#fff",
          transition: `opacity ${EXIT_MS}ms cubic-bezier(.22,.61,.36,1)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: bloomOpacity,
          background:
            "radial-gradient(circle at 50% 52%, rgba(255,255,255,.96), rgba(232,246,255,.58) 24%, rgba(183,220,255,.22) 48%, transparent 72%)",
          filter: `blur(${10 + bloom * 18}px)`,
          transform: `scale(${1 + finalPull * 0.18})`,
          transition: "opacity 80ms linear, filter 80ms linear, transform 80ms linear",
          mixBlendMode: "screen",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: veilOpacity,
          background:
            "linear-gradient(180deg, rgba(0,0,0,.28), transparent 34%, rgba(0,0,0,.36)), radial-gradient(circle at center, transparent 0 28%, rgba(0,0,0,.42) 76%)",
          transition: "opacity 80ms linear",
        }}
      />
    </div>
  );
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
