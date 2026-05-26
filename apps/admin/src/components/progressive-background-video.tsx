"use client";

import { useEffect, useMemo, useState } from "react";

type VideoSources = {
  mp4?: string;
  webm?: string;
};

type ProgressiveBackgroundVideoProps = {
  poster?: string;
  placeholder?: string;
  preview?: VideoSources;
  hd?: VideoSources;
  overlay?: string;
};

function hasSources(sources?: VideoSources) {
  return Boolean(sources?.webm || sources?.mp4);
}

function ResponsiveCenteredVideo({
  sources,
  poster,
  visible,
  preload,
  onCanPlay,
}: {
  sources: VideoSources;
  poster?: string;
  visible: boolean;
  preload: "metadata" | "auto";
  onCanPlay: () => void;
}) {
  return (
    <video
      autoPlay
      muted
      loop
      playsInline
      preload={preload}
      poster={poster}
      aria-hidden="true"
      onCanPlay={(event) => {
        onCanPlay();
        void event.currentTarget.play().catch(() => undefined);
      }}
      style={{
        position: "absolute",
        inset: 0,
        display: "block",
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: "center center",
        opacity: visible ? 1 : 0,
        transition: "opacity 900ms ease",
      }}
    >
      {sources.webm ? <source src={sources.webm} type="video/webm" /> : null}
      {sources.mp4 ? <source src={sources.mp4} type="video/mp4" /> : null}
    </video>
  );
}

export function ProgressiveBackgroundVideo({
  poster,
  placeholder,
  preview,
  hd,
  overlay = "linear-gradient(180deg, rgba(0, 10, 15, 0.08), rgba(0, 10, 15, 0.34))",
}: ProgressiveBackgroundVideoProps) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [loadHd, setLoadHd] = useState(false);
  const [hdReady, setHdReady] = useState(false);

  const hasPreview = hasSources(preview);
  const hasHd = hasSources(hd);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!hasHd || reducedMotion) return;

    const startHdLoad = () => setLoadHd(true);
    const idleCallback = window.requestIdleCallback;
    if (hasPreview && !previewReady) return;

    if (idleCallback) {
      const id = idleCallback(startHdLoad, { timeout: 1800 });
      return () => window.cancelIdleCallback(id);
    }

    const timeout = window.setTimeout(startHdLoad, hasPreview ? 500 : 100);
    return () => window.clearTimeout(timeout);
  }, [hasHd, hasPreview, previewReady, reducedMotion]);

  const posterLayer = useMemo(() => poster ?? placeholder, [placeholder, poster]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        width: "100%",
        height: "100%",
        background: "#000a0f",
      }}
    >
      {placeholder ? (
        <img
          src={placeholder}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            inset: 0,
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center center",
            filter: "blur(18px)",
            transform: "scale(1.06)",
            opacity: hdReady || previewReady ? 0 : 1,
            transition: "opacity 600ms ease",
          }}
        />
      ) : null}

      {posterLayer ? (
        <img
          src={posterLayer}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            inset: 0,
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center center",
            opacity: reducedMotion || (!previewReady && !hdReady) ? 1 : 0,
            transition: "opacity 600ms ease",
          }}
        />
      ) : null}

      {!reducedMotion && hasPreview && preview ? (
        <ResponsiveCenteredVideo
          sources={preview}
          poster={poster}
          preload="auto"
          visible={previewReady && !hdReady}
          onCanPlay={() => setPreviewReady(true)}
        />
      ) : null}

      {!reducedMotion && loadHd && hasHd && hd ? (
        <ResponsiveCenteredVideo
          sources={hd}
          poster={poster}
          preload="auto"
          visible={hdReady}
          onCanPlay={() => setHdReady(true)}
        />
      ) : null}

      <div
        style={{
          position: "absolute",
          inset: 0,
          background: overlay,
        }}
      />
    </div>
  );
}
