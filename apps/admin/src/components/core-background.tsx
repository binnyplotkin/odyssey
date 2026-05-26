"use client";

import { GrainGradient } from "@paper-design/shaders-react";
import { ProgressiveBackgroundVideo } from "./progressive-background-video";

const backgroundSources = {
  poster: process.env.NEXT_PUBLIC_ODYSSEY_CORE_BG_POSTER_URL,
  placeholder: process.env.NEXT_PUBLIC_ODYSSEY_CORE_BG_LQIP_URL,
  preview: {
    mp4: process.env.NEXT_PUBLIC_ODYSSEY_CORE_BG_PREVIEW_MP4_URL,
    webm: process.env.NEXT_PUBLIC_ODYSSEY_CORE_BG_PREVIEW_WEBM_URL,
  },
  hd: {
    mp4: process.env.NEXT_PUBLIC_ODYSSEY_CORE_BG_HD_MP4_URL,
    webm: process.env.NEXT_PUBLIC_ODYSSEY_CORE_BG_HD_WEBM_URL,
  },
};

function hasVideoSource() {
  return Boolean(
    backgroundSources.preview.mp4 ||
      backgroundSources.preview.webm ||
      backgroundSources.hd.mp4 ||
      backgroundSources.hd.webm,
  );
}

export function CoreBackground() {
  return (
    <div
      aria-hidden="true"
      className="odyssey-core-background"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {hasVideoSource() ? (
        <ProgressiveBackgroundVideo
          poster={backgroundSources.poster}
          placeholder={backgroundSources.placeholder}
          preview={backgroundSources.preview}
          hd={backgroundSources.hd}
        />
      ) : (
        <>
          <style>
            {`
              .odyssey-core-background > div {
                position: absolute !important;
                inset: 0 !important;
              }

              .odyssey-core-background canvas {
                z-index: 0 !important;
              }
            `}
          </style>
          <GrainGradient
            width={1280}
            height={720}
            colors={["#30cdfd", "#55ecbf", "#000a0f", "#000a0f"]}
            colorBack="#000a0f"
            softness={0.62}
            intensity={0.17}
            noise={0.2}
            shape="wave"
            speed={1.06}
            scale={0.96}
            style={{
              width: "100%",
              height: "100%",
            }}
          />
        </>
      )}
    </div>
  );
}
