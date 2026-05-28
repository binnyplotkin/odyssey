"use client";

import { useEffect, useRef, type CSSProperties } from "react";

export type HalftoneIntelligenceState =
  | "idle"
  | "listening"
  | "thinking"
  | "processing"
  | "responding";

export type HalftoneIntelligencePreset =
  | "sweep"
  | "ocean"
  | "scanner"
  | "undulate"
  | "radial"
  | "dual";

type Density = "compact" | "standard" | "detailed";

export type HalftoneIntelligenceIconProps = {
  state?: HalftoneIntelligenceState;
  preset?: HalftoneIntelligencePreset;
  size?: number | string;
  intensity?: number;
  speedScale?: number;
  density?: Density;
  label?: string;
  className?: string;
  style?: CSSProperties;
  backgroundColor?: string;
  respectReducedMotion?: boolean;
  pauseWhenOffscreen?: boolean;
  pauseWhenHidden?: boolean;
};

type Dot = {
  x: number;
  y: number;
  priority: number;
  phase: number;
  edge: number;
};

type IconBounds = {
  x: number;
  y: number;
  size: number;
};

type HalftoneParams = {
  preset: HalftoneIntelligencePreset;
  density: number;
  speed: number;
  wavelength: number;
  amplitude: number;
  backgroundColor: string;
  glow: number;
  ring: number;
};

type RenderParams = HalftoneParams & {
  minDotScale: number;
};

type StateConfig = {
  preset: HalftoneIntelligencePreset;
  toneVar: string;
  fallback: string;
  density: number;
  speed: number;
  wavelength: number;
  amplitude: number;
  glow: number;
  ring: number;
};

type HalftoneCssVars = CSSProperties & Record<`--${string}`, string>;

const HALFTONE_THEME_VARS = {
  "--halftone-idle": "var(--accent-strong)",
  "--halftone-listening": "var(--accent-strong)",
  "--halftone-thinking": "var(--accent-strong)",
  "--halftone-processing": "var(--accent-strong)",
  "--halftone-responding": "var(--emissive-mint)",
  "--halftone-accent": "var(--accent-strong)",
  "--halftone-secondary": "var(--accent-strong)",
} satisfies HalftoneCssVars;

const STATE_CONFIG: Record<HalftoneIntelligenceState, StateConfig> = {
  idle: {
    preset: "sweep",
    toneVar: "--halftone-idle",
    fallback: "#8FD1CB",
    density: 8,
    speed: 0.42,
    wavelength: 150,
    amplitude: 0.48,
    glow: 0.18,
    ring: 0.28,
  },
  listening: {
    preset: "ocean",
    toneVar: "--halftone-listening",
    fallback: "#8FD1CB",
    density: 7,
    speed: 0.82,
    wavelength: 115,
    amplitude: 0.68,
    glow: 0.22,
    ring: 0.34,
  },
  thinking: {
    preset: "undulate",
    toneVar: "--halftone-thinking",
    fallback: "#8FD1CB",
    density: 7,
    speed: 0.95,
    wavelength: 112,
    amplitude: 0.74,
    glow: 0.26,
    ring: 0.38,
  },
  processing: {
    preset: "scanner",
    toneVar: "--halftone-processing",
    fallback: "#8FD1CB",
    density: 7,
    speed: 1.28,
    wavelength: 86,
    amplitude: 0.82,
    glow: 0.24,
    ring: 0.44,
  },
  responding: {
    preset: "dual",
    toneVar: "--halftone-responding",
    fallback: "#DFFFF5",
    density: 6,
    speed: 1.08,
    wavelength: 96,
    amplitude: 0.88,
    glow: 0.28,
    ring: 0.5,
  },
};

const DENSITY_SCALE: Record<Density, number> = {
  compact: 1.42,
  standard: 1,
  detailed: 0.72,
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
  return Math.min(max, Math.max(min, value));
}

function normalizeParams({
  config,
  density,
  intensity,
  speedScale,
  preset,
  backgroundColor,
}: {
  config: StateConfig;
  density: Density;
  intensity: number;
  speedScale: number;
  preset?: HalftoneIntelligencePreset;
  backgroundColor: string;
}): HalftoneParams {
  const safeIntensity = clamp(Number.isFinite(intensity) ? intensity : 1, 0.25, 1.45);
  const safeSpeedScale = clamp(Number.isFinite(speedScale) ? speedScale : 1, 0.45, 2);

  return {
    preset: preset ?? config.preset,
    density: clamp(config.density * DENSITY_SCALE[density], 4.8, 18),
    speed: clamp(config.speed * safeSpeedScale, 0, 2.5),
    wavelength: config.wavelength,
    amplitude: clamp(config.amplitude * safeIntensity, 0, 1),
    backgroundColor,
    glow: clamp(config.glow * safeIntensity, 0.06, 0.7),
    ring: clamp(config.ring * safeIntensity, 0.12, 0.75),
  };
}

function isTransparentColor(color: string) {
  return color === "transparent" || color === "rgba(0, 0, 0, 0)";
}

function resolveColorValue(
  element: HTMLElement,
  value: string,
  fallback: string,
) {
  const trimmed = value.trim();

  if (!trimmed) return fallback;
  if (!trimmed.startsWith("var(") && !trimmed.startsWith("color-mix(")) {
    return trimmed;
  }

  const doc = element.ownerDocument;
  const probe = doc.createElement("span");
  probe.style.position = "absolute";
  probe.style.pointerEvents = "none";
  probe.style.visibility = "hidden";
  probe.style.color = trimmed;

  const parent = element.parentElement ?? doc.body;
  parent.appendChild(probe);
  const resolved = getComputedStyle(probe).color.trim();
  probe.remove();

  return resolved && resolved !== trimmed ? resolved : fallback;
}

function resolveCssColor(canvas: HTMLCanvasElement, variableName: string, fallback: string) {
  const styles = getComputedStyle(canvas);
  let value = styles.getPropertyValue(variableName).trim();
  const seen = new Set<string>([variableName]);

  for (let i = 0; i < 4; i += 1) {
    const nested = value.match(/^var\((--[^),\s]+)(?:,\s*([^)]+))?\)$/);
    if (!nested) break;

    const nextName = nested[1];
    if (seen.has(nextName)) {
      value = nested[2]?.trim() ?? fallback;
      break;
    }

    seen.add(nextName);
    value = styles.getPropertyValue(nextName).trim() || nested[2]?.trim() || fallback;
  }

  if (!value) {
    return fallback;
  }

  return resolveColorValue(canvas, value, fallback);
}

function withAlpha(color: string, alpha: number) {
  const safeAlpha = clamp(alpha, 0, 1);
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);

  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split("").map((char) => `${char}${char}`).join("")
      : hex[1];
    const r = Number.parseInt(raw.slice(0, 2), 16);
    const g = Number.parseInt(raw.slice(2, 4), 16);
    const b = Number.parseInt(raw.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha.toFixed(3)})`;
  }

  const rgb = color
    .trim()
    .match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+[\d.]+)?\s*\)$/i);

  if (rgb) {
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${safeAlpha.toFixed(3)})`;
  }

  return color;
}

function getWaveValue(
  x: number,
  y: number,
  time: number,
  params: RenderParams,
  iconBounds: IconBounds,
) {
  const lambda = params.wavelength;
  const amp = params.amplitude;
  const xLocal = x - iconBounds.x;
  const yLocal = y - iconBounds.y;

  if (params.preset === "sweep") {
    const phase = (xLocal / lambda) * Math.PI * 2 - time * 2;
    const value = Math.sin(phase) * 0.5 + 0.5;
    return value * amp + (1 - amp) * 0.54;
  }

  if (params.preset === "ocean") {
    const yShift = (yLocal / iconBounds.size) * lambda * 0.45;
    const phase = ((xLocal + yShift) / lambda) * Math.PI * 2 - time * 1.65;
    const value = Math.sin(phase) * 0.5 + 0.5;
    return value * amp + (1 - amp) * 0.48;
  }

  if (params.preset === "scanner") {
    const bandWidth = lambda * 0.34;
    const cyclePx = iconBounds.size + lambda * 2;
    const bandX = ((time * lambda * 0.72) % cyclePx) - lambda;
    const dist = xLocal - bandX;
    const intensity = Math.exp(-(dist * dist) / (2 * bandWidth * bandWidth));
    return Math.min(1, intensity * amp + 0.16 + (1 - amp) * 0.24);
  }

  if (params.preset === "undulate") {
    const curveY =
      iconBounds.size * 0.5 +
      Math.sin((xLocal / lambda) * Math.PI * 2 - time * 1.8) *
        iconBounds.size *
        0.22;
    const distFromCurve = Math.abs(yLocal - curveY);
    const sigma = iconBounds.size * 0.18;
    const band = Math.exp(-(distFromCurve * distFromCurve) / (2 * sigma * sigma));
    return Math.min(1, band * amp + (1 - amp) * 0.42);
  }

  if (params.preset === "radial") {
    const center = iconBounds.size * 0.5;
    const dist = Math.hypot(xLocal - center, yLocal - center);
    const phase = (dist / lambda) * Math.PI * 2 - time * 2.4;
    const ring = Math.sin(phase) * 0.5 + 0.5;
    return ring * amp + (1 - amp) * 0.46;
  }

  const phase1 = (xLocal / lambda) * Math.PI * 2 - time * 1.72;
  const phase2 = (yLocal / (lambda * 0.82)) * Math.PI * 2 + time * 1.35;
  const value = (Math.sin(phase1) + Math.sin(phase2)) * 0.25 + 0.5;
  return value * amp + (1 - amp) * 0.5;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function HalftoneIntelligenceIcon({
  state = "idle",
  preset,
  size = 48,
  intensity = 1,
  speedScale = 1,
  density = "detailed",
  label = "AI intelligence",
  className,
  style,
  backgroundColor = "transparent",
  respectReducedMotion = true,
  pauseWhenOffscreen = true,
  pauseWhenHidden = true,
}: HalftoneIntelligenceIconProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const config = STATE_CONFIG[state] ?? STATE_CONFIG.idle;
  const width = typeof size === "number" ? `${size}px` : size;
  const paramsRef = useRef<HalftoneParams>(
    normalizeParams({ config, density, intensity, speedScale, preset, backgroundColor }),
  );
  const toneRef = useRef(config);

  paramsRef.current = normalizeParams({
    config,
    density,
    intensity,
    speedScale,
    preset,
    backgroundColor,
  });
  toneRef.current = config;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");

    if (!canvas || !ctx) return;

    const maskCanvas = document.createElement("canvas");
    let maskCtx = maskCanvas.getContext("2d");
    let widthPx = 0;
    let heightPx = 0;
    let dpr = Math.max(1, window.devicePixelRatio || 1);
    let dots: Dot[] = [];
    let iconBounds: IconBounds = { x: 0, y: 0, size: 0 };
    let prevDensity: number | null = null;
    let rafId: number | null = null;
    let startTime = performance.now();
    let cachedTone = resolveCssColor(canvas, toneRef.current.toneVar, toneRef.current.fallback);
    let cachedAccent = resolveCssColor(canvas, "--halftone-accent", "#8FD1CB");
    let cachedSecondary = resolveCssColor(canvas, "--halftone-secondary", "#8FD1CB");

    let isOffscreen = false;
    let isPageHidden =
      pauseWhenHidden && typeof document !== "undefined"
        ? document.hidden
        : false;
    const reducedMotionQuery =
      respectReducedMotion && typeof window !== "undefined"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    let reduceMotion = reducedMotionQuery?.matches ?? false;

    const shouldAnimate = () => !isOffscreen && !isPageHidden && !reduceMotion;

    const refreshColors = () => {
      cachedTone = resolveCssColor(canvas, toneRef.current.toneVar, toneRef.current.fallback);
      cachedAccent = resolveCssColor(canvas, "--halftone-accent", "#8FD1CB");
      cachedSecondary = resolveCssColor(canvas, "--halftone-secondary", "#8FD1CB");
    };

    const fitIcon = () => {
      const actualSize = Math.max(1, Math.min(widthPx, heightPx) * 0.84);

      iconBounds = {
        x: (widthPx - actualSize) / 2,
        y: (heightPx - actualSize) / 2,
        size: actualSize,
      };
    };

    const buildMask = () => {
      if (!maskCtx) return;

      const maskSize = Math.ceil(iconBounds.size * dpr);
      maskCanvas.width = maskSize;
      maskCanvas.height = maskSize;
      maskCtx = maskCanvas.getContext("2d");

      if (!maskCtx) return;

      maskCtx.clearRect(0, 0, maskSize, maskSize);
      maskCtx.fillStyle = "#000";
      maskCtx.fillRect(0, 0, maskSize, maskSize);
      maskCtx.save();
      maskCtx.fillStyle = "#fff";
      maskCtx.beginPath();
      maskCtx.arc(maskSize / 2, maskSize / 2, maskSize / 2 - dpr, 0, Math.PI * 2);
      maskCtx.fill();
      maskCtx.restore();
    };

    const priorityForDot = (x: number, y: number) => {
      const cx = iconBounds.x + iconBounds.size / 2;
      const cy = iconBounds.y + iconBounds.size / 2;
      const distance = Math.hypot(x - cx, y - cy) / (iconBounds.size / 2);
      if (distance < 0.45) return 0;
      if (distance < 0.76) return 1;
      return 2;
    };

    const buildDots = (spacing: number) => {
      if (!maskCtx || !iconBounds.size) return;

      dots = [];

      const maskSize = maskCanvas.width;
      const imgData = maskCtx.getImageData(0, 0, maskSize, maskSize).data;

      for (let y = spacing / 2; y < iconBounds.size; y += spacing) {
        for (let x = spacing / 2; x < iconBounds.size; x += spacing) {
          const maskX = Math.floor((x / iconBounds.size) * maskSize);
          const maskY = Math.floor((y / iconBounds.size) * maskSize);
          const index = (maskY * maskSize + maskX) * 4;

          if (imgData[index] > 128) {
            const dotX = iconBounds.x + x;
            const dotY = iconBounds.y + y;
            dots.push({
              x: dotX,
              y: dotY,
              priority: priorityForDot(dotX, dotY),
              phase: (x / iconBounds.size) * Math.PI + (y / iconBounds.size) * Math.PI * 0.6,
              edge: Math.hypot(
                dotX - (iconBounds.x + iconBounds.size / 2),
                dotY - (iconBounds.y + iconBounds.size / 2),
              ) / (iconBounds.size / 2),
            });
          }
        }
      }

      prevDensity = spacing;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();

      widthPx = rect.width;
      heightPx = rect.height;
      dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(widthPx * dpr));
      canvas.height = Math.max(1, Math.floor(heightPx * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      fitIcon();
      buildMask();
      buildDots(getEffectiveSpacing(paramsRef.current.density));
    };

    const getEffectiveSpacing = (spacing: number) => {
      if (!iconBounds.size) return spacing;
      if (iconBounds.size < 26) return Math.min(spacing, iconBounds.size / 9);
      if (iconBounds.size < 48) return Math.min(spacing, iconBounds.size / 10);
      if (iconBounds.size < 92) return Math.min(spacing, iconBounds.size / 12);
      return spacing;
    };

    const getRenderParams = (params: HalftoneParams): RenderParams => {
      if (iconBounds.size < 40) {
        return {
          ...params,
          wavelength: Math.min(params.wavelength, Math.max(18, iconBounds.size * 0.72)),
          amplitude: params.amplitude * 0.78,
          minDotScale: 0.34,
        };
      }

      if (iconBounds.size < 76) {
        return {
          ...params,
          wavelength: Math.min(params.wavelength, Math.max(28, iconBounds.size * 0.86)),
          amplitude: params.amplitude * 0.88,
          minDotScale: 0.26,
        };
      }

      return {
        ...params,
        minDotScale: 0.18,
      };
    };

    const drawOnce = (frozenTime?: number) => {
      const params = paramsRef.current;
      const renderParams = getRenderParams(params);

      const effectiveSpacing = getEffectiveSpacing(renderParams.density);

      if (effectiveSpacing !== prevDensity) {
        buildDots(effectiveSpacing);
      }

      const animatedTime = (performance.now() - startTime) * 0.001 * renderParams.speed;
      const time = frozenTime ?? animatedTime;

      refreshColors();
      ctx.clearRect(0, 0, widthPx, heightPx);

      const resolvedBackgroundColor = getComputedStyle(canvas).backgroundColor;

      if (!isTransparentColor(resolvedBackgroundColor)) {
        ctx.fillStyle = resolvedBackgroundColor;
        ctx.fillRect(0, 0, widthPx, heightPx);
      }

      const cx = iconBounds.x + iconBounds.size / 2;
      const cy = iconBounds.y + iconBounds.size / 2;
      const radius = iconBounds.size / 2;

      const halo = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius * 1.12);
      halo.addColorStop(0, withAlpha(cachedTone, 0.16 + renderParams.glow * 0.24));
      halo.addColorStop(0.52, withAlpha(cachedAccent, 0.08 + renderParams.glow * 0.12));
      halo.addColorStop(1, withAlpha(cachedTone, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.16, 0, Math.PI * 2);
      ctx.fill();

      const maxRadius = effectiveSpacing * 0.42;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.995, 0, Math.PI * 2);
      ctx.clip();

      for (let i = 0; i < dots.length; i += 1) {
        const dot = dots[i];
        const value = clamp(getWaveValue(dot.x, dot.y, time, renderParams, iconBounds), 0, 1);
        const shimmer = Math.sin(time * 2.2 + dot.phase) * 0.08;
        const priorityScale = dot.priority === 0 ? 1.08 : dot.priority === 1 ? 0.96 : 0.82;
        const edgeFade = 1 - smoothstep(0.72, 1, dot.edge);
        const dotRadius =
          maxRadius *
          (renderParams.minDotScale + clamp(value + shimmer, 0, 1) * (1 - renderParams.minDotScale)) *
          priorityScale *
          (0.28 + edgeFade * 0.72);

        if (dotRadius < 0.28) continue;

        const secondaryMix = dot.priority === 2 && i % 5 === 0;
        ctx.fillStyle = withAlpha(
          secondaryMix ? cachedSecondary : cachedTone,
          (0.12 + value * 0.7) * (0.18 + edgeFade * 0.82),
        );
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    };

    const tick = () => {
      if (!shouldAnimate()) {
        rafId = null;
        return;
      }
      drawOnce();
      rafId = requestAnimationFrame(tick);
    };

    const pause = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const resume = () => {
      if (rafId !== null || !shouldAnimate()) return;
      rafId = requestAnimationFrame(tick);
    };

    const renderStatic = () => {
      drawOnce(1.5);
    };

    const restart = () => {
      pause();
      resize();
      refreshColors();
      startTime = performance.now();
      if (reduceMotion || !shouldAnimate()) {
        renderStatic();
      } else {
        resume();
      }
    };

    let intersectionObserver: IntersectionObserver | null = null;
    if (pauseWhenOffscreen && typeof IntersectionObserver !== "undefined") {
      intersectionObserver = new IntersectionObserver(
        ([entry]) => {
          isOffscreen = !entry.isIntersecting;
          if (isOffscreen) {
            pause();
          } else if (shouldAnimate()) {
            resume();
          }
        },
        { threshold: 0 },
      );
      intersectionObserver.observe(canvas);
    }

    const handleVisibility = () => {
      isPageHidden = document.hidden;
      if (isPageHidden) pause();
      else if (shouldAnimate()) resume();
    };
    if (pauseWhenHidden && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }

    const handleReducedMotionChange = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
      if (reduceMotion) {
        pause();
        renderStatic();
      } else if (shouldAnimate()) {
        resume();
      }
    };
    reducedMotionQuery?.addEventListener("change", handleReducedMotionChange);

    let themeObserver: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
      themeObserver = new MutationObserver(() => {
        refreshColors();
        drawOnce();
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme", "data-theme-variant", "class", "style"],
      });
    }

    const resizeObserver = new ResizeObserver(restart);
    resizeObserver.observe(canvas);

    restart();

    return () => {
      pause();
      resizeObserver.disconnect();
      intersectionObserver?.disconnect();
      themeObserver?.disconnect();
      reducedMotionQuery?.removeEventListener("change", handleReducedMotionChange);
      if (pauseWhenHidden && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  }, [
    backgroundColor,
    density,
    intensity,
    pauseWhenHidden,
    pauseWhenOffscreen,
    preset,
    respectReducedMotion,
    size,
    speedScale,
    state,
  ]);

  return (
    <span
      role="img"
      aria-label={label}
      className={className}
      style={{
        position: "relative",
        display: "inline-flex",
        width,
        height: width,
        flexShrink: 0,
        ...HALFTONE_THEME_VARS,
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-state={state}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          background: backgroundColor,
        }}
      />
      <span style={srOnly}>{label}</span>
    </span>
  );
}
