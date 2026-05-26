"use client";

import { useId, type CSSProperties } from "react";
import {
  ODYSSEY_FRONT_TRACE_PATH,
  ODYSSEY_ICON_PATH,
  ODYSSEY_LOADER_VISIBLE_PATH,
} from "@/components/odyssey-logo-paths";

type LoadingIndicatorProps = {
  size?: number | string;
  speedSeconds?: number;
  intensity?: number;
  thickness?: number;
  pulseLength?: number;
  label?: string;
  showBase?: boolean;
  showLoaderPathOverlay?: boolean;
  className?: string;
  style?: CSSProperties;
};

const srOnly: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function LoadingIndicator({
  size = 320,
  speedSeconds = 1.35,
  intensity = 0.85,
  thickness = 1.7,
  pulseLength = 1.25,
  label = "Loading",
  showBase = true,
  showLoaderPathOverlay = false,
  className,
  style,
}: LoadingIndicatorProps) {
  const id = useId().replace(/:/g, "");
  const clipId = `odyssey-loader-clip-${id}`;
  const frontMaskId = `odyssey-loader-front-mask-${id}`;
  const pathId = `odyssey-loader-path-${id}`;
  const glowId = `odyssey-loader-glow-${id}`;
  const coreId = `odyssey-loader-core-${id}`;
  const safeSpeed = clamp(Number.isFinite(speedSeconds) ? speedSeconds : 1.35, 0.6, 4);
  const safeIntensity = clamp(Number.isFinite(intensity) ? intensity : 0.85, 0.2, 1);
  const safeThickness = clamp(Number.isFinite(thickness) ? thickness : 1.7, 0.7, 3.5);
  const safePulseLength = clamp(Number.isFinite(pulseLength) ? pulseLength : 1.25, 0.7, 3);
  const maskStrokeWidth = 72 * safeThickness;
  const width = typeof size === "number" ? `${size}px` : size;

  const rootStyle = {
    ...style,
    width,
    "--oli-speed": `${safeSpeed}s`,
    "--oli-pulse-speed": `${safeSpeed * 0.72}s`,
    "--oli-intensity": safeIntensity,
  } as CSSProperties;

  return (
    <div
      role="status"
      aria-label={label}
      className={className}
      style={{
        position: "relative",
        display: "inline-flex",
        color: "var(--accent)",
        ...rootStyle,
      }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 846 412"
        fill="none"
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          overflow: "visible",
        }}
      >
        <defs>
          <clipPath id={clipId}>
            <path d={ODYSSEY_ICON_PATH} />
          </clipPath>
          <mask
            id={frontMaskId}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="846"
            height="412"
          >
            <rect width="846" height="412" fill="black" />
            <path
              d={ODYSSEY_LOADER_VISIBLE_PATH}
              fill="white"
              transform="scale(0.9929577465 1.0172839506)"
            />
            <path
              d={ODYSSEY_FRONT_TRACE_PATH}
              fill="none"
              stroke="white"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={maskStrokeWidth}
            />
          </mask>
          <path id={pathId} d={ODYSSEY_FRONT_TRACE_PATH} />
          <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.5" />
            <stop offset="48%" stopColor="currentColor" stopOpacity="0.3" />
            <stop offset="82%" stopColor="currentColor" stopOpacity="0.1" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={coreId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
            <stop offset="42%" stopColor="currentColor" stopOpacity="0.72" />
            <stop offset="78%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>

        {showBase ? (
          <path
            d={ODYSSEY_ICON_PATH}
            fill="currentColor"
            opacity={0.12 + safeIntensity * 0.1}
          />
        ) : null}

        <g clipPath={`url(#${clipId})`} mask={`url(#${frontMaskId})`}>
          <g className="odyssey-loader-orb odyssey-loader-orb-soft">
            <ellipse
              cx="0"
              cy="0"
              rx={190 * safePulseLength}
              ry={70 * safeThickness}
              fill={`url(#${glowId})`}
            />
            <animateMotion dur={`${safeSpeed * 1.12}s`} repeatCount="indefinite" rotate="auto">
              <mpath href={`#${pathId}`} />
            </animateMotion>
            <animate
              attributeName="opacity"
              dur={`${safeSpeed * 1.12}s`}
              repeatCount="indefinite"
              values={`0;${0.42 * safeIntensity};${0.42 * safeIntensity};0`}
              keyTimes="0;0.08;0.95;1"
            />
          </g>
          <g className="odyssey-loader-orb odyssey-loader-orb-core">
            <ellipse
              cx="0"
              cy="0"
              rx={112 * safePulseLength}
              ry={44 * safeThickness}
              fill={`url(#${coreId})`}
            />
            <animateMotion dur={`${safeSpeed}s`} repeatCount="indefinite" rotate="auto">
              <mpath href={`#${pathId}`} />
            </animateMotion>
            <animate
              attributeName="opacity"
              dur={`${safeSpeed}s`}
              repeatCount="indefinite"
              values={`0;${safeIntensity};${safeIntensity};0`}
              keyTimes="0;0.08;0.95;1"
            />
          </g>
        </g>

        {showBase ? (
          <path
            d={ODYSSEY_ICON_PATH}
            fill="currentColor"
            opacity={0.05 + safeIntensity * 0.05}
          />
        ) : null}

        {showLoaderPathOverlay ? (
          <g pointerEvents="none">
            <path
              d={ODYSSEY_LOADER_VISIBLE_PATH}
              fill="#ff2d2d"
              opacity="0.3"
              transform="scale(0.9929577465 1.0172839506)"
            />
            <path
              d={ODYSSEY_LOADER_VISIBLE_PATH}
              fill="none"
              stroke="#ff2d2d"
              strokeWidth="7"
              opacity="0.95"
              vectorEffect="non-scaling-stroke"
              transform="scale(0.9929577465 1.0172839506)"
            />
            <path
              d={ODYSSEY_FRONT_TRACE_PATH}
              fill="none"
              stroke="#facc15"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={maskStrokeWidth}
              opacity="0.24"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={ODYSSEY_FRONT_TRACE_PATH}
              fill="none"
              stroke="#ffffff"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="16"
              opacity="0.9"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={ODYSSEY_FRONT_TRACE_PATH}
              fill="none"
              stroke="#22d3ee"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="8"
              strokeDasharray="24 16"
              opacity="1"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx="433" cy="125" r="13" fill="#22c55e" stroke="#ffffff" strokeWidth="4" />
            <circle cx="676" cy="356" r="13" fill="#f59e0b" stroke="#ffffff" strokeWidth="4" />
          </g>
        ) : null}
      </svg>
      <span style={srOnly}>{label}</span>
      <style>{`
        .odyssey-loader-orb {
          will-change: transform, opacity;
        }

        @media (prefers-reduced-motion: reduce) {
          .odyssey-loader-orb {
            opacity: var(--oli-intensity);
          }
        }
      `}</style>
    </div>
  );
}
