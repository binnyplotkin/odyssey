"use client";

/**
 * Matter canvas — particles flowing through a vector field of attractors.
 *
 * The image at `attractorImage` is sampled on mount: bright pixels above
 * a luminance threshold become attractor points in normalized [-1, 1]
 * space. Each particle each frame:
 *
 *   1. Accumulates a gradient force from nearby attractors (inverse-
 *      square pull, clamped to avoid singularities).
 *   2. Adds a small curl-noise force for organic curvature.
 *   3. Advects, with mild damping. Particles that escape the field
 *      respawn at a random edge.
 *
 * Rendering is one of:
 *   strokes  — short line segment in velocity direction (default)
 *   halftone — filled circle sized by mask density + speed
 *   ascii    — glyph from density ramp
 *   fog      — soft alpha blob
 *
 * Mode crossfades smoothly when `mode` changes. The canvas is cleared
 * with a low-alpha rect each frame instead of a solid fill — that's
 * what produces the streaming trails.
 */

import { type CSSProperties, useEffect, useMemo, useRef } from "react";

export type MatterPhase =
  | "idle"
  | "silent"
  | "thinking"
  | "speaking"
  | "responding";

export type MatterMode = "dots" | "strokes" | "halftone" | "ascii" | "fog";

export type MatterActivation = {
  /** Stable id. New ids create new local neural pulses. */
  id: string;
  /** Wiki/source/event kind used for color coding. */
  kind?: string;
  /** Optional explicit normalized hotspot center. Defaults to a stable
   *  bright region selected from `id`. */
  x?: number;
  y?: number;
  /** 0..1 pulse strength. Default derived from kind. */
  strength?: number;
  /** Normalized hotspot radius. Default derived from kind. */
  radius?: number;
  /** Pulse duration in ms. Default derived from kind. */
  durationMs?: number;
};

export type MatterActivationMode = "off" | "particles" | "glow";
export type MatterSurfaceTone = "dark" | "light";

/* ── State adapter ──────────────────────────────────────────────────
 * `matterStateFromIngestion()` is the single canonical mapping between
 * an ingestion run's state and the visual state of the canvas. Defined
 * here (next to MatterPhase/MatterMode) so any future caller (the
 * character sandbox, etc.) can reuse it instead of duplicating the
 * table.
 *
 * Table:
 *
 *   ingestion state         | phase      | mode    | energy | color
 *   ------------------------|------------|---------|--------|-------
 *   idle (pre-run)          | idle       | dots    | 0.24   | teal
 *   live · pre-plan         | thinking   | halftone| 0.45   | teal
 *   live · writing ops      | speaking   | ascii   | 0.50→0.92 | teal
 *   resolved · complete     | responding | dots    | 0.85   | success green
 *   failed                  | silent     | fog     | 0.25   | red
 *
 * Mode choice matters for persistence: all production modes paint slow
 * particles. If a renderer gates only on speed, attractor convergence
 * can brake the population into invisibility.
 *
 * Pulses fire on plan-complete, op-start, op-complete, op-failed,
 * succeeded, and failed — anything the user would consider "the engine
 * just touched something."
 */

import type { IngestionEvent } from "@odyssey/wiki-ingest";

export type MatterIngestionInput =
  | { phase: "idle" }
  | { phase: "live"; events: IngestionEvent[]; startedAt: number }
  | {
      phase: "resolved";
      events: IngestionEvent[];
      startedAt: number;
      finishedAt: number;
    }
  | {
      phase: "failed";
      events: IngestionEvent[];
      startedAt: number;
      finishedAt: number;
    };

export type MatterIngestionState = {
  phase: MatterPhase;
  mode: MatterMode;
  energy: number;
  /** Stable monotonic number; bumps on each pulse-worthy event. */
  pulseAt?: number;
  /** Sustained activity floor (0..1). Holds steady during a run or idle
   *  awareness so the canvas doesn't dim between discrete event pulses. */
  amplitude: number;
  color: string;
};

const COLOR_TEAL = "rgba(140,231,210,1)";
const COLOR_SUCCESS = "rgba(74,222,128,1)";
const COLOR_DANGER = "rgba(248,113,113,1)";
const RGB_NEURAL_WHITE: [number, number, number] = [255, 255, 255];

const PULSE_EVENT_TYPES: ReadonlySet<IngestionEvent["type"]> = new Set([
  "plan-complete",
  "op-start",
  "op-complete",
  "op-failed",
  "edges-reconciled",
  "succeeded",
  "failed",
]);

export function matterStateFromIngestion(
  input: MatterIngestionInput,
): MatterIngestionState {
  if (input.phase === "idle") {
    return {
      phase: "idle",
      mode: "dots",
      energy: 0.24,
      amplitude: 0.22,
      color: COLOR_TEAL,
    };
  }

  if (input.phase === "failed") {
    return {
      phase: "silent",
      mode: "fog",
      energy: 0.25,
      amplitude: 0.08,
      pulseAt: pulseSeed(input.events, input.startedAt),
      color: COLOR_DANGER,
    };
  }

  if (input.phase === "resolved") {
    return {
      phase: "responding",
      mode: "dots",
      energy: 0.85,
      amplitude: 0.48,
      pulseAt: pulseSeed(input.events, input.startedAt),
      color: COLOR_SUCCESS,
    };
  }

  // live — split into pre-plan thinking vs writing speaking
  const planEv = input.events.find(
    (e): e is Extract<IngestionEvent, { type: "plan-complete" }> =>
      e.type === "plan-complete",
  );
  const opStarted = input.events.some((e) => e.type === "op-start");

  const phase: MatterPhase = opStarted ? "speaking" : "thinking";

  let energy: number;
  if (!planEv) {
    // planner still drafting
    energy = 0.45;
  } else {
    const total = planEv.opCount;
    const done = input.events.filter((e) => e.type === "op-complete").length;
    const lastStartIdx = lastIndexWhere(
      input.events,
      (e) => e.type === "op-start",
    );
    const lastCompleteIdx = lastIndexWhere(
      input.events,
      (e) => e.type === "op-complete",
    );
    const inFlight =
      lastStartIdx >= 0 &&
      (lastCompleteIdx < 0 || lastStartIdx > lastCompleteIdx);
    if (total <= 0) {
      energy = 0.5;
    } else {
      // Base 0.5 → 0.9 as work completes, +0.05 kick while in-flight.
      energy = 0.5 + (done / total) * 0.4 + (inFlight ? 0.05 : 0);
    }
  }

  return {
    phase,
    // Planning reads as material coalescing; writing reads as source text
    // becoming structured memory.
    mode: opStarted ? "ascii" : "halftone",
    energy,
    // Sustained 0.6 baseline during live — keeps the canvas visibly
    // engaged in the dead air between op events instead of dimming on
    // the pulse-decay curve.
    amplitude: 0.6,
    pulseAt: pulseSeed(input.events, input.startedAt),
    color: COLOR_TEAL,
  };
}

export function matterPreviewStateForPhase(
  phase: MatterPhase,
): MatterIngestionState {
  switch (phase) {
    case "idle":
      return {
        phase,
        mode: "dots",
        energy: 0.24,
        amplitude: 0.22,
        color: COLOR_TEAL,
      };
    case "silent":
      return {
        phase,
        mode: "fog",
        energy: 0.25,
        amplitude: 0.08,
        color: COLOR_DANGER,
      };
    case "thinking":
      return {
        phase,
        mode: "halftone",
        energy: 0.45,
        amplitude: 0.38,
        color: COLOR_TEAL,
      };
    case "speaking":
      return {
        phase,
        mode: "ascii",
        energy: 0.82,
        amplitude: 0.68,
        color: COLOR_TEAL,
      };
    case "responding":
      return {
        phase,
        mode: "dots",
        energy: 0.85,
        amplitude: 0.48,
        color: COLOR_SUCCESS,
      };
  }
}

function pulseSeed(
  events: IngestionEvent[],
  startedAt: number,
): number | undefined {
  // Bump by 1 for each pulse-worthy event so the canvas sees a fresh
  // `pulseAt` value whenever something interesting lands. Anchored on
  // `startedAt` so reloads don't trigger spurious pulses.
  const significant = events.filter((e) =>
    PULSE_EVENT_TYPES.has(e.type),
  ).length;
  return significant > 0 ? startedAt + significant : undefined;
}

function lastIndexWhere<T>(arr: T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

export type ASCIIMatterCanvasProps = {
  phase: MatterPhase;
  /** Render mode. If omitted, derived from phase. */
  mode?: MatterMode;
  /** Source image URL — sampled into attractor points on mount. */
  attractorImage?: string;
  /** Manual attractor override. Each entry is normalized (-1..1). */
  attractors?: Array<[number, number]>;
  /** 0..1 steady-state energy. Drives attractor strength + brightness. */
  energy?: number;
  /** Bump (e.g. Date.now()) to fire a brief amplitude pulse. */
  pulseAt?: number;
  /** Live amplitude (0..1) — e.g. mic input. */
  amplitude?: number;
  /** Particle count. Default 3500. */
  particleCount?: number;
  /** Max attractors to keep from image. Default 220. */
  maxAttractors?: number;
  /** Hex/rgb/hsl base color for matter. Default platform mint accent. */
  color?: string;
  /** Optional canvas background color. Omit for a transparent canvas. */
  backgroundColor?: string | null;
  /** Optional color for the quiet source-field dots behind active matter. */
  baseFieldColor?: string;
  /** Multiplier for the quiet source-field dots. Default 1. */
  baseFieldStrength?: number;
  /** Override the phase-derived `attract` strength (0..1). */
  attractOverride?: number;
  /** Override the phase-derived `curl` strength (0..1). */
  curlOverride?: number;
  /** Override the phase-derived `damping` factor (0..1). */
  dampingOverride?: number;
  /** Override the phase-derived `trail` clear alpha (0..0.5). */
  trailOverride?: number;
  /** Override the phase-derived `brightness` (0..1). */
  brightnessOverride?: number;
  /** Mask threshold (0..1). Particles below this brightness in the
   *  source image are not rendered. Default 0.06. */
  maskThreshold?: number;
  /** When true, prints per-second canvas stats to the console — particle
   *  population, dark/slow counts, recent respawns, current phase/mode/
   *  energy/amplitude/pulse. Use this to diagnose dissolution / freezing
   *  bugs without instrumenting the renderers. Default false. */
  debugLog?: boolean;
  /** Localized neural pulses, usually derived from ingestion events. */
  activations?: MatterActivation[];
  /** How localized activity is displayed. `particles` shows color-coded
   *  pulsing matter without radial glow blobs. */
  activationMode?: MatterActivationMode;
  /** Surface the canvas sits on. Light surfaces use darker particle
   *  compositing so activity remains legible without a dark card. */
  surfaceTone?: MatterSurfaceTone;
  className?: string;
  style?: CSSProperties;
};

const RAMP = [" ", ".", ":", "+", "*", "#", "@", "0", "1"];
const MODE_CROSSFADE_MS = 900;
const DEFAULT_ATTRACTOR_IMAGE = "/attractor.png";
const MASK_FLOOR = 0.06;
const INVISIBLE_RESPAWN_FRAMES = 55;
const BASE_MASK_STRIDE = 3;
const PARTICLE_LIFE_MIN = 4.8;
const PARTICLE_LIFE_JITTER = 5.8;
const PARTICLE_FADE_IN = 0.55;
const PARTICLE_FADE_OUT = 1.05;

const KIND_COLOR_RGB: Record<string, [number, number, number]> = {
  entity: [140, 231, 210],
  event: [96, 165, 250],
  concept: [167, 139, 250],
  relationship: [250, 204, 21],
  timeline: [45, 212, 191],
  voice_identity: [244, 114, 182],
  bible: [140, 231, 210],
  primary: [140, 231, 210],
  commentary: [129, 140, 248],
  midrash: [167, 139, 250],
  annotation: [250, 204, 21],
  note: [250, 204, 21],
  transcript: [74, 222, 128],
  reference: [125, 211, 252],
  planning: RGB_NEURAL_WHITE,
  contradiction: [251, 146, 60],
  failed: [248, 113, 113],
  success: [74, 222, 128],
  edge: [250, 204, 21],
};

// ── Noise (used for curl + jitter) ──────────────────────────────
function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 982451653) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h & 0x7fffffff) / 0x7fffffff;
}
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
function noise2d(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  const ux = smooth(fx);
  const uy = smooth(fy);
  const top = a + (b - a) * ux;
  const bot = c + (d - c) * ux;
  return (top + (bot - top) * uy) * 2 - 1;
}

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededUnit(seed: number, step: number): number {
  let h = seed + Math.imul(step + 1, 374761393);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0xffffffff;
}

function rgbTupleToString(rgb: [number, number, number]): string {
  return `${rgb[0]},${rgb[1]},${rgb[2]}`;
}

function rgbStringToTuple(rgb: string): [number, number, number] {
  const parts = rgb
    .split(",")
    .map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))));
  return [
    Number.isFinite(parts[0]) ? parts[0] : 140,
    Number.isFinite(parts[1]) ? parts[1] : 231,
    Number.isFinite(parts[2]) ? parts[2] : 210,
  ];
}

function rgbForSurfaceTone(rgb: string, tone: MatterSurfaceTone): string {
  if (tone === "dark") return rgb;
  const [r, g, b] = rgbStringToTuple(rgb);
  // Light mode needs ink, not glow: darken saturated activity colors
  // while keeping enough chroma to preserve the event/type code.
  return `${Math.round(r * 0.48)},${Math.round(g * 0.55)},${Math.round(b * 0.58)}`;
}

function colorForActivationKind(
  kind: string | undefined,
): [number, number, number] {
  return KIND_COLOR_RGB[kind ?? ""] ?? KIND_COLOR_RGB.concept;
}

// Curl-noise vector field (rotated gradient → divergence-free flow).
function curlField(nx: number, ny: number, t: number): [number, number] {
  const e = 0.015;
  const s = 1.2;
  const tt = t * 0.2;
  const seed = 42;
  const n00 = noise2d(nx * s, ny * s + tt, seed);
  const nx1 = noise2d((nx + e) * s, ny * s + tt, seed);
  const ny1 = noise2d(nx * s, (ny + e) * s + tt, seed);
  return [-(ny1 - n00) / e, (nx1 - n00) / e];
}

// ── Attractor extraction + brightness map from an image ─────────
// Loads the image, samples on a stride, picks top-N brightest as
// attractors, AND builds a full-resolution brightness map. The map is
// used at render time to gate which particles are visible — particles
// in dark areas of the image stay invisible no matter how fast they
// move. That's what keeps animation contained to the attractor's
// silhouette instead of spilling into the void.
type AttractorMap = {
  attractors: Array<[number, number]>;
  brightness: Uint8Array;
  width: number;
  height: number;
};

async function sampleAttractorsFromImage(
  src: string,
  maxPoints: number,
): Promise<AttractorMap> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (e) => reject(e);
  });

  // Decode at a manageable size for cheap sampling.
  const W = 220;
  const H = Math.round((img.height / img.width) * W);
  const off = document.createElement("canvas");
  off.width = W;
  off.height = H;
  const ctx = off.getContext("2d");
  if (!ctx) {
    return {
      attractors: [],
      brightness: new Uint8Array(0),
      width: 0,
      height: 0,
    };
  }
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;

  // Build the brightness map (one luminance byte per pixel).
  const brightness = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 32) {
        brightness[y * W + x] = 0;
        continue;
      }
      brightness[y * W + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }

  // Extract attractors: top-N brightest above the threshold, sampled
  // at a stride to spread them out.
  const stride = 4;
  type Candidate = { x: number; y: number; lum: number };
  const candidates: Candidate[] = [];
  for (let y = 0; y < H; y += stride) {
    for (let x = 0; x < W; x += stride) {
      const lum = brightness[y * W + x];
      if (lum < 96) continue;
      candidates.push({ x, y, lum });
    }
  }
  candidates.sort((a, b) => b.lum - a.lum);
  const picked = candidates.slice(0, maxPoints);

  const longest = Math.max(W, H);
  const attractors = picked.map<[number, number]>((p) => [
    ((p.x + 0.5) / longest) * 2 - W / longest,
    ((p.y + 0.5) / longest) * 2 - H / longest,
  ]);

  return { attractors, brightness, width: W, height: H };
}

// Sample the brightness map at a normalized (nx, ny) position.
// Returns 0..1, with 0 outside the map bounds.
function sampleMaskAt(map: AttractorMap, nx: number, ny: number): number {
  if (map.width === 0) return 1; // no map yet — pass through
  const longest = Math.max(map.width, map.height);
  const px = ((nx + map.width / longest) / 2) * longest - 0.5;
  const py = ((ny + map.height / longest) / 2) * longest - 0.5;
  if (px < 0 || px >= map.width - 1 || py < 0 || py >= map.height - 1) return 0;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  return map.brightness[iy * map.width + ix] / 255;
}

// Sample a random position weighted by the brightness map. Used when
// respawning particles so they appear in bright zones of the source
// image — matches the HD dot density without us computing it ourselves.
// Rejection sampling: pick uniform candidates, accept if mask >
// random. Fast for images with reasonable bright coverage.
function weightedRespawn(map: AttractorMap, span = 1.4): [number, number] {
  if (map.width === 0) {
    return [(Math.random() * 2 - 1) * span, (Math.random() * 2 - 1) * span];
  }
  for (let attempts = 0; attempts < 40; attempts++) {
    const nx = Math.random() * 2 - 1;
    const ny = Math.random() * 2 - 1;
    const m = sampleMaskAt(map, nx, ny);
    if (m > Math.random() * 0.9 + 0.05) return [nx, ny];
  }
  // Image is mostly dark — fall back to uniform.
  return [(Math.random() * 2 - 1) * span, (Math.random() * 2 - 1) * span];
}

function hotspotPositionForActivation(
  map: AttractorMap,
  activation: MatterActivation,
): [number, number] {
  if (typeof activation.x === "number" && typeof activation.y === "number") {
    return [
      Math.max(-1, Math.min(1, activation.x)),
      Math.max(-1, Math.min(1, activation.y)),
    ];
  }

  const seed = hashString(activation.id);
  let best: [number, number] = [
    seededUnit(seed, 1) * 1.6 - 0.8,
    seededUnit(seed, 2) * 1.6 - 0.8,
  ];
  let bestMask = sampleMaskAt(map, best[0], best[1]);
  for (let i = 0; i < 28; i++) {
    const candidate: [number, number] = [
      seededUnit(seed, i * 2 + 3) * 1.7 - 0.85,
      seededUnit(seed, i * 2 + 4) * 1.7 - 0.85,
    ];
    const mask = sampleMaskAt(map, candidate[0], candidate[1]);
    if (mask > bestMask) {
      best = candidate;
      bestMask = mask;
    }
    if (bestMask > 0.72) break;
  }
  return best;
}

function beatPulse(
  t: number,
  period: number,
  phase = 0,
  sharpness = 5,
): number {
  const wave = (Math.sin((t / period + phase) * Math.PI * 2) + 1) / 2;
  return Math.pow(wave, sharpness);
}

function ambientActivityForPhase(phase: MatterPhase, t: number): number {
  switch (phase) {
    case "idle":
      // Three overlapping rhythms: slow respiration, mid cognitive hum,
      // and a small sharp glint. This keeps idle alive without reading as
      // an active ingestion run.
      return Math.min(
        0.42,
        0.08 +
          beatPulse(t, 6.8, 0.05, 2) * 0.14 +
          beatPulse(t, 2.7, 0.37, 6) * 0.12 +
          beatPulse(t, 11.5, 0.72, 10) * 0.08,
      );
    case "thinking":
      return 0.12 + beatPulse(t, 3.4, 0.2, 3) * 0.08;
    case "speaking":
      return 0.16 + beatPulse(t, 1.9, 0.1, 4) * 0.08;
    case "responding":
      return 0.12 + beatPulse(t, 4.8, 0.45, 2) * 0.05;
    case "silent":
      return beatPulse(t, 8.5, 0.15, 3) * 0.04;
  }
}

// ── Phase params ────────────────────────────────────────────────
type PhaseParams = {
  /** How strongly particles are pulled toward attractors. */
  attract: number;
  /** Magnitude of curl-noise force (organic curve). */
  curl: number;
  /** Velocity damping each frame (0..1, higher = more drag). */
  damping: number;
  /** Brightness scale. */
  brightness: number;
  /** Trail clear alpha (lower = longer trails). */
  trail: number;
};

function phaseParams(phase: MatterPhase): PhaseParams {
  switch (phase) {
    case "idle":
      return {
        attract: 0.055,
        curl: 0.72,
        damping: 0.965,
        brightness: 0.62,
        trail: 0.026,
      };
    case "silent":
      return {
        attract: 0.025,
        curl: 0.34,
        damping: 0.978,
        brightness: 0.34,
        trail: 0.045,
      };
    case "thinking":
      // Stronger attraction with high curl → swirling streams.
      return {
        attract: 0.18,
        curl: 0.72,
        damping: 0.94,
        brightness: 0.84,
        trail: 0.032,
      };
    case "speaking":
      // Hard pull to attractors, fast streams.
      return {
        attract: 0.28,
        curl: 0.52,
        damping: 0.92,
        brightness: 0.98,
        trail: 0.034,
      };
    case "responding":
      // Outward pulse: mild attract, more curl, slow trail clear.
      return {
        attract: 0.12,
        curl: 0.86,
        damping: 0.94,
        brightness: 0.92,
        trail: 0.026,
      };
  }
}

function defaultModeFor(phase: MatterPhase): MatterMode {
  switch (phase) {
    case "idle":
      return "dots";
    case "silent":
      return "fog";
    case "thinking":
      return "halftone";
    case "speaking":
      return "ascii";
    case "responding":
      return "dots";
  }
}

// ── Renderers ───────────────────────────────────────────────────
// Renderers take the canvas ctx, a list of particles, and a brightness
// weight (for crossfade). Strokes and dots are drawn in batched paths
// for performance — one beginPath/stroke per frame, not per particle.

type Particle = {
  cx: number; // current position, normalized [-1.4..1.4]
  cy: number;
  vx: number; // velocity
  vy: number;
  speed: number; // cached |v| for rendering
  mask: number; // brightness-map sample at current pos (0..1)
  activation: number; // local neural activity multiplier (0..1+)
  tintRgb: string | null; // color-coded local neural activity
  age: number; // seconds since this particle entered the cycle
  life: number; // seconds until this particle dissolves and re-enters
  opacity: number; // lifecycle fade multiplier (0..1)
  /** Consecutive frames the particle has been in a dark zone (mask=0).
   *  Renderers skip particles in dark source-image zones, so without a
   *  respawn they'd fade out invisibly. Once this crosses a threshold we
   *  re-seed the particle into a bright zone to keep the canvas full. */
  darkFrames: number;
};

type ActiveHotspot = {
  id: string;
  nx: number;
  ny: number;
  radius: number;
  strength: number;
  duration: number;
  age: number;
  color: [number, number, number];
  driftSeed: number;
};

type FrameHotspot = {
  nx: number;
  ny: number;
  radius: number;
  level: number;
  color: [number, number, number];
};

const EMPTY_ATTRACTOR_MAP: AttractorMap = {
  attractors: [],
  brightness: new Uint8Array(0),
  width: 0,
  height: 0,
};

function randomParticleLife(): number {
  return PARTICLE_LIFE_MIN + Math.random() * PARTICLE_LIFE_JITTER;
}

function particleCycleOpacity(age: number, life: number): number {
  const entering = Math.min(1, age / PARTICLE_FADE_IN);
  const leaving = Math.min(1, Math.max(0, life - age) / PARTICLE_FADE_OUT);
  return Math.max(0, Math.min(entering, leaving));
}

function respawnParticle(
  p: Particle,
  map: AttractorMap,
  span: number,
  stagger = false,
) {
  const [nx, ny] = weightedRespawn(map, span);
  p.cx = nx;
  p.cy = ny;
  p.vx = (Math.random() * 2 - 1) * 0.012;
  p.vy = (Math.random() * 2 - 1) * 0.012;
  p.speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
  p.activation = 0;
  p.tintRgb = null;
  p.life = randomParticleLife();
  p.age = stagger ? Math.random() * p.life : 0;
  p.opacity = particleCycleOpacity(p.age, p.life);
  p.mask = sampleMaskAt(map, nx, ny) * p.opacity;
  p.darkFrames = 0;
}

function activationDefaults(kind: string | undefined): {
  strength: number;
  radius: number;
  duration: number;
} {
  switch (kind) {
    case "failed":
      return { strength: 1.2, radius: 0.2, duration: 4.2 };
    case "contradiction":
      return { strength: 1.05, radius: 0.24, duration: 4.8 };
    case "success":
      return { strength: 0.95, radius: 0.42, duration: 3.8 };
    case "planning":
      return { strength: 0.55, radius: 0.34, duration: 3.2 };
    case "edge":
    case "relationship":
      return { strength: 0.78, radius: 0.3, duration: 3.6 };
    default:
      return { strength: 0.82, radius: 0.26, duration: 3.4 };
  }
}

function hotspotEnvelope(age: number, duration: number): number {
  if (age < 0 || age > duration) return 0;
  const progress = age / duration;
  return Math.sin(progress * Math.PI) * Math.pow(1 - progress * 0.18, 2);
}

function frameHotspotsFor(
  activeHotspots: ActiveHotspot[],
  phase: MatterPhase,
  t: number,
  baseColor: [number, number, number],
): FrameHotspot[] {
  const ambientColor =
    phase === "thinking" || phase === "speaking" ? RGB_NEURAL_WHITE : baseColor;
  const ambientScale =
    phase === "idle"
      ? 0.28
      : phase === "silent"
        ? 0.08
        : phase === "thinking"
          ? 0.34
          : phase === "speaking"
            ? 0.42
            : 0.24;
  const out: FrameHotspot[] = [
    {
      nx: Math.sin(t * 0.23) * 0.42,
      ny: Math.cos(t * 0.19) * 0.28,
      radius: 0.34,
      level: ambientScale * (0.55 + beatPulse(t, 5.8, 0.12, 2) * 0.45),
      color: ambientColor,
    },
    {
      nx: Math.sin(t * 0.17 + 2.1) * 0.52,
      ny: Math.cos(t * 0.21 + 1.3) * 0.34,
      radius: 0.24,
      level: ambientScale * 0.72 * (0.45 + beatPulse(t, 3.7, 0.48, 4) * 0.55),
      color: ambientColor,
    },
  ];

  for (const hotspot of activeHotspots) {
    const env = hotspotEnvelope(hotspot.age, hotspot.duration);
    if (env <= 0.01) continue;
    const drift = Math.sin(t * 0.8 + hotspot.driftSeed) * 0.025;
    out.push({
      nx: hotspot.nx + drift,
      ny: hotspot.ny + Math.cos(t * 0.7 + hotspot.driftSeed) * 0.018,
      radius: hotspot.radius,
      level: hotspot.strength * env,
      color: hotspot.color,
    });
  }

  return out;
}

function sampleNeuralActivity(
  nx: number,
  ny: number,
  hotspots: FrameHotspot[],
): {
  intensity: number;
  rgb: string | null;
} {
  let intensity = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const hotspot of hotspots) {
    const dx = nx - hotspot.nx;
    const dy = ny - hotspot.ny;
    const falloff = Math.exp(
      -(dx * dx + dy * dy) / (hotspot.radius * hotspot.radius * 0.72),
    );
    const level = hotspot.level * falloff;
    if (level <= 0.015) continue;
    intensity += level;
    r += hotspot.color[0] * level;
    g += hotspot.color[1] * level;
    b += hotspot.color[2] * level;
  }

  if (intensity <= 0.02) return { intensity: 0, rgb: null };
  const inv = 1 / intensity;
  return {
    intensity: Math.min(1.35, intensity),
    rgb: `${Math.round(r * inv)},${Math.round(g * inv)},${Math.round(b * inv)}`,
  };
}

function renderStrokes(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  centerX: number,
  centerY: number,
  radius: number,
  rgb: string,
  weight: number,
) {
  if (weight < 0.02) return;
  // Two batches: dim (slow) and bright (fast). One stroke call each.
  ctx.lineCap = "round";
  ctx.lineWidth = 0.6;

  // Both batches are individually masked — particles in dark zones of
  // the source image are skipped entirely so animation stays contained.
  // Dim batch (field particles barely moving) and bright batch (active
  // streams) are drawn in separate stroke calls so each can have its
  // own alpha. Mask is applied per-particle by varying alpha — for the
  // dim batch we use a binary cutoff to keep the single-stroke-call
  // perf win; for the bright batch we modulate alpha by mask so the
  // streams fade in/out near the silhouette edge.

  // Dim batch.
  ctx.beginPath();
  let dimCount = 0;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (p.speed > 0.12) continue;
    if (p.mask < 0.08) continue;
    const x = centerX + p.cx * radius;
    const y = centerY + p.cy * radius;
    ctx.moveTo(x - 0.5, y);
    ctx.lineTo(x + 0.5, y);
    dimCount++;
  }
  if (dimCount > 0) {
    ctx.strokeStyle = `rgba(${rgb},${(0.12 * weight).toFixed(3)})`;
    ctx.stroke();
  }

  // Bright batch — group into 3 mask buckets so we can vary alpha
  // without per-particle stroke calls.
  for (const bucket of [0.34, 0.67, 1.01]) {
    ctx.beginPath();
    let liveCount = 0;
    const lo = bucket === 0.34 ? MASK_FLOOR : bucket === 0.67 ? 0.34 : 0.67;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.speed <= 0.12) continue;
      if (p.mask < lo || p.mask >= bucket) continue;
      const x = centerX + p.cx * radius;
      const y = centerY + p.cy * radius;
      const len = Math.min(p.speed * 14, 6);
      const dx = (p.vx / p.speed) * len;
      const dy = (p.vy / p.speed) * len;
      ctx.moveTo(x - dx, y - dy);
      ctx.lineTo(x, y);
      liveCount++;
    }
    if (liveCount > 0) {
      ctx.strokeStyle = `rgba(${rgb},${(0.75 * weight * bucket).toFixed(3)})`;
      ctx.stroke();
    }
  }
}

function renderHalftone(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  centerX: number,
  centerY: number,
  radius: number,
  rgb: string,
  weight: number,
) {
  if (weight < 0.02) return;
  const buckets = [
    { min: 0.72, radius: 2.8, alpha: 0.95 },
    { min: 0.46, radius: 2.05, alpha: 0.7 },
    { min: 0.22, radius: 1.35, alpha: 0.42 },
    { min: 0.06, radius: 0.75, alpha: 0.2 },
  ];

  for (let b = 0; b < buckets.length; b++) {
    const bucket = buckets[b];
    const hi = b === 0 ? Infinity : buckets[b - 1].min;
    ctx.beginPath();
    let count = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.mask < MASK_FLOOR) continue;
      const intensity = Math.min(1, p.mask * 0.58 + p.speed * 3.4);
      if (intensity < bucket.min || intensity >= hi) continue;
      const r = bucket.radius * (0.82 + p.mask * 0.18);
      const x = centerX + p.cx * radius;
      const y = centerY + p.cy * radius;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
      count++;
    }
    if (count > 0) {
      ctx.fillStyle = `rgba(${rgb},${(bucket.alpha * weight).toFixed(3)})`;
      ctx.fill();
    }
  }
}

function renderAscii(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  centerX: number,
  centerY: number,
  radius: number,
  rgb: string,
  weight: number,
) {
  if (weight < 0.02) return;
  const glyphBuckets = Array.from(
    { length: RAMP.length },
    () => [] as Particle[],
  );
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (p.mask < MASK_FLOOR) continue;
    const bright = Math.min(1, p.mask * 0.42 + p.speed * 4.5);
    const idx = Math.max(
      1,
      Math.min(RAMP.length - 1, Math.floor(bright * RAMP.length)),
    );
    glyphBuckets[idx].push(p);
  }

  for (let idx = 1; idx < glyphBuckets.length; idx++) {
    const batch = glyphBuckets[idx];
    if (batch.length === 0) continue;
    const density = idx / (RAMP.length - 1);
    const alpha = (0.08 + Math.pow(density, 1.35) * 0.78) * weight;
    ctx.fillStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
    for (let i = 0; i < batch.length; i++) {
      const p = batch[i];
      const x = centerX + p.cx * radius;
      const y = centerY + p.cy * radius;
      ctx.fillText(RAMP[idx], x, y);
    }
  }
}

function parseCssColorToRgb(color: string, fallback = "140,231,210"): string {
  const c = color.trim();
  if (c.startsWith("#")) {
    if (c.length !== 4 && c.length !== 7) return fallback;
    const hex =
      c.length === 4
        ? c
            .slice(1)
            .split("")
            .map((d) => d + d)
            .join("")
        : c.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if ([r, g, b].some((v) => Number.isNaN(v))) return fallback;
    return `${r},${g},${b}`;
  }
  if (c.startsWith("rgb")) {
    return c
      .replace(/rgba?\(([^)]+)\).*/, "$1")
      .split(",")
      .slice(0, 3)
      .map((s) => s.trim())
      .join(",");
  }
  if (c.startsWith("hsl")) {
    const parts = c
      .replace(/hsla?\(([^)]+)\).*/, "$1")
      .split(",")
      .map((s) => s.trim());
    if (parts.length < 3) return fallback;
    const h = parseFloat(parts[0]);
    const s = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;
    if ([h, s, l].some((v) => Number.isNaN(v))) return fallback;
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = chroma * (1 - Math.abs((hp % 2) - 1));
    let r1 = 0;
    let g1 = 0;
    let b1 = 0;
    if (hp < 1) [r1, g1, b1] = [chroma, x, 0];
    else if (hp < 2) [r1, g1, b1] = [x, chroma, 0];
    else if (hp < 3) [r1, g1, b1] = [0, chroma, x];
    else if (hp < 4) [r1, g1, b1] = [0, x, chroma];
    else if (hp < 5) [r1, g1, b1] = [x, 0, chroma];
    else [r1, g1, b1] = [chroma, 0, x];
    const m = l - chroma / 2;
    return `${Math.round((r1 + m) * 255)},${Math.round((g1 + m) * 255)},${Math.round((b1 + m) * 255)}`;
  }
  return fallback;
}

const FOG_SPRITES = new Map<string, HTMLCanvasElement>();
function getFogSprite(rgb: string): HTMLCanvasElement {
  const cached = FOG_SPRITES.get(rgb);
  if (cached) return cached;
  const size = 32;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const cx = c.getContext("2d");
  if (!cx) return c;
  const grad = cx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  grad.addColorStop(0, `rgba(${rgb},1)`);
  grad.addColorStop(0.55, `rgba(${rgb},0.18)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  cx.fillStyle = grad;
  cx.fillRect(0, 0, size, size);
  FOG_SPRITES.set(rgb, c);
  return c;
}

function renderFog(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  centerX: number,
  centerY: number,
  radius: number,
  rgb: string,
  weight: number,
) {
  if (weight < 0.02) return;
  const sprite = getFogSprite(rgb);
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (p.mask < MASK_FLOOR) continue;
    const bright = Math.min(1, p.speed * 4 + 0.15);
    if (bright < 0.05) continue;
    const r = bright * 16;
    ctx.globalAlpha = Math.pow(bright, 0.5) * 0.5 * weight * p.mask;
    const x = centerX + p.cx * radius;
    const y = centerY + p.cy * radius;
    ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
}

// Pinpoint dots — the rendering that matches the source attractor
// image's HD dot-field look. Each particle is a 1–1.5px crisp square
// (`fillRect` is much faster than `arc` at high N). Alpha is bucketed
// into 4 levels so we only set `fillStyle` 4 times per frame, not once
// per particle, which keeps performance OK at ~10k particles.
function renderDots(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  centerX: number,
  centerY: number,
  radius: number,
  rgb: string,
  weight: number,
) {
  if (weight < 0.02) return;
  // Intensity for a particle = its mask × (base + speed contribution).
  // Bright zones at rest still render dimly, fast-moving particles in
  // bright zones render fully — that matches the source image which
  // has both static fill and active streams.
  const thresholds = [0.7, 0.45, 0.22, 0.06];
  const alphas = [1.0, 0.65, 0.35, 0.15];
  // Skip ranges so each particle is drawn in exactly one bucket.
  const hi = [Infinity, thresholds[0], thresholds[1], thresholds[2]];

  for (let b = 0; b < 4; b++) {
    ctx.fillStyle = `rgba(${rgb},${(alphas[b] * weight).toFixed(3)})`;
    const lo = thresholds[b];
    const hiB = hi[b];
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.mask <= 0) continue;
      const intensity = Math.min(1, p.mask * (0.5 + p.speed * 2));
      if (intensity < lo || intensity >= hiB) continue;
      const x = centerX + p.cx * radius;
      const y = centerY + p.cy * radius;
      // 1.2px square, sub-pixel offset for sharp anti-aliased edge.
      ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
    }
  }
}

function renderMaskBase(
  ctx: CanvasRenderingContext2D,
  map: AttractorMap,
  centerX: number,
  centerY: number,
  radius: number,
  rgb: string,
  weight: number,
) {
  if (weight < 0.01 || map.width === 0 || map.height === 0) return;
  const longest = Math.max(map.width, map.height);
  const buckets = [
    { min: 192, max: 256, alpha: 0.9, size: 1.05 },
    { min: 112, max: 192, alpha: 0.58, size: 0.9 },
    { min: Math.round(MASK_FLOOR * 255), max: 112, alpha: 0.3, size: 0.75 },
  ];

  for (const bucket of buckets) {
    const alpha = Math.min(0.2, weight * bucket.alpha);
    if (alpha <= 0) continue;
    ctx.fillStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
    for (let y = 0; y < map.height; y += BASE_MASK_STRIDE) {
      for (let x = 0; x < map.width; x += BASE_MASK_STRIDE) {
        const lum = map.brightness[y * map.width + x];
        if (lum < bucket.min || lum >= bucket.max) continue;
        const nx = ((x + 0.5) / longest) * 2 - map.width / longest;
        const ny = ((y + 0.5) / longest) * 2 - map.height / longest;
        const px = centerX + nx * radius;
        const py = centerY + ny * radius;
        ctx.fillRect(
          px - bucket.size / 2,
          py - bucket.size / 2,
          bucket.size,
          bucket.size,
        );
      }
    }
  }
}

function renderNeuralGlows(
  ctx: CanvasRenderingContext2D,
  hotspots: FrameHotspot[],
  centerX: number,
  centerY: number,
  radius: number,
  weight: number,
) {
  if (weight < 0.02) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const hotspot of hotspots) {
    if (hotspot.level < 0.08) continue;
    const x = centerX + hotspot.nx * radius;
    const y = centerY + hotspot.ny * radius;
    const r = Math.max(12, hotspot.radius * radius * 1.15);
    const rgb = rgbTupleToString(hotspot.color);
    const alpha = Math.min(0.18, hotspot.level * weight * 0.16);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${rgb},${alpha.toFixed(3)})`);
    grad.addColorStop(0.42, `rgba(${rgb},${(alpha * 0.35).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

function renderActivatedParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  centerX: number,
  centerY: number,
  radius: number,
  weight: number,
  emphasis = 1,
  surfaceTone: MatterSurfaceTone = "dark",
) {
  if (weight < 0.02) return;
  const batches = new Map<string, Particle[]>();
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (!p.tintRgb || p.activation < 0.12 || p.mask < MASK_FLOOR) continue;
    const batch = batches.get(p.tintRgb);
    if (batch) batch.push(p);
    else batches.set(p.tintRgb, [p]);
  }

  ctx.save();
  ctx.globalCompositeOperation =
    surfaceTone === "light" ? "source-over" : "lighter";
  for (const [rgb, batch] of batches) {
    const surfaceRgb = rgbForSurfaceTone(rgb, surfaceTone);
    const alpha =
      surfaceTone === "light"
        ? Math.min(0.72, 0.42 * weight * emphasis)
        : Math.min(0.86, 0.52 * weight * emphasis);
    ctx.fillStyle = `rgba(${surfaceRgb},${alpha.toFixed(3)})`;
    const step = emphasis > 1.1 ? 1 : 2;
    ctx.beginPath();
    for (let i = 0; i < batch.length; i += step) {
      const p = batch[i];
      const size = 0.65 + Math.min(1, p.activation) * (1.45 * emphasis);
      const x = centerX + p.cx * radius;
      const y = centerY + p.cy * radius;
      ctx.moveTo(x + size / 2, y);
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.restore();
}

const RENDERERS = {
  dots: renderDots,
  strokes: renderStrokes,
  halftone: renderHalftone,
  ascii: renderAscii,
  fog: renderFog,
} as const;

/**
 * Per-mode "would this particle render?" predicate. The physics uses
 * this to decide if a particle is effectively invisible (so it can be
 * respawned), instead of a one-size-fits-all `mask < threshold` rule.
 *
 * Without this, particles can drift into a band where they're above the
 * physics mask threshold but below a renderer's own visibility threshold
 * — neither respawned nor painted — and the canvas slowly thins out.
 */
function isParticleVisible(
  mode: MatterMode,
  mask: number,
  speed: number,
): boolean {
  if (mask <= 0) return false;
  switch (mode) {
    case "dots": {
      const intensity = Math.min(1, mask * (0.5 + speed * 2));
      return intensity >= 0.06;
    }
    case "strokes": {
      if (speed > 0.12) return mask >= MASK_FLOOR;
      return mask >= 0.08;
    }
    case "halftone":
      return mask >= MASK_FLOOR;
    case "ascii":
      return mask >= MASK_FLOOR;
    case "fog":
      return mask >= MASK_FLOOR;
  }
}

// ── Component ───────────────────────────────────────────────────

export function ASCIIMatterCanvas({
  phase,
  mode,
  attractorImage = DEFAULT_ATTRACTOR_IMAGE,
  attractors: attractorsProp,
  energy = 0.4,
  pulseAt,
  amplitude = 0,
  particleCount = 3500,
  maxAttractors = 220,
  color = "rgba(140,231,210,1)",
  backgroundColor = null,
  baseFieldColor,
  baseFieldStrength = 1,
  attractOverride,
  curlOverride,
  dampingOverride,
  trailOverride,
  brightnessOverride,
  maskThreshold = 0.06,
  debugLog = false,
  activations = [],
  activationMode = "glow",
  surfaceTone = "dark",
  className,
  style,
}: ASCIIMatterCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(phase);
  const energyRef = useRef(energy);
  const ampRef = useRef(amplitude);
  const debugLogRef = useRef(debugLog);
  debugLogRef.current = debugLog;
  // Per-second debug accounting. Reset on every log emission.
  const debugStatsRef = useRef({
    accumMs: 0,
    frames: 0,
    respawned: 0,
    // mask>0 AND speed>=0.022 — active/fast population.
    fast: 0,
    // mask>0 AND speed<0.022 — still visible in every production mode.
    slow: 0,
    // mask==0 — out of the bright zone, invisible everywhere; counted
    // against the per-particle `darkFrames` and force-respawned.
    dark: 0,
    totalSpeed: 0,
  });
  const overridesRef = useRef({
    attract: attractOverride,
    curl: curlOverride,
    damping: dampingOverride,
    trail: trailOverride,
    brightness: brightnessOverride,
  });
  overridesRef.current = {
    attract: attractOverride,
    curl: curlOverride,
    damping: dampingOverride,
    trail: trailOverride,
    brightness: brightnessOverride,
  };
  const maskThresholdRef = useRef(maskThreshold);
  maskThresholdRef.current = maskThreshold;
  const bgColorRef = useRef(backgroundColor);
  bgColorRef.current = backgroundColor;
  const modeRef = useRef<MatterMode>(mode ?? defaultModeFor(phase));
  const prevModeRef = useRef<MatterMode>(modeRef.current);
  const modeBlendStartRef = useRef<number>(-1);
  const pulseEnvRef = useRef(0);
  const lastPulseAtRef = useRef(pulseAt ?? 0);
  const activeHotspotsRef = useRef<ActiveHotspot[]>([]);
  const seenActivationIdsRef = useRef<Set<string>>(new Set());
  // Attractors live in a ref so we can mutate after async image load.
  const attractorsRef = useRef<Array<[number, number]>>(attractorsProp ?? []);
  // Brightness map ref — used to gate rendering so animation only
  // shows where the source image has light.
  const mapRef = useRef<AttractorMap>({
    ...EMPTY_ATTRACTOR_MAP,
  });

  phaseRef.current = phase;
  energyRef.current = energy;
  ampRef.current = amplitude;

  const effectiveMode = mode ?? defaultModeFor(phase);
  useEffect(() => {
    if (effectiveMode !== modeRef.current) {
      prevModeRef.current = modeRef.current;
      modeRef.current = effectiveMode;
      modeBlendStartRef.current = performance.now();
    }
  }, [effectiveMode]);

  useEffect(() => {
    if (pulseAt && pulseAt !== lastPulseAtRef.current) {
      pulseEnvRef.current = 1;
      lastPulseAtRef.current = pulseAt;
    }
  }, [pulseAt]);

  useEffect(() => {
    const map = mapRef.current;
    for (const activation of activations) {
      if (seenActivationIdsRef.current.has(activation.id)) continue;
      seenActivationIdsRef.current.add(activation.id);
      const defaults = activationDefaults(activation.kind);
      const [nx, ny] = hotspotPositionForActivation(map, activation);
      activeHotspotsRef.current.push({
        id: activation.id,
        nx,
        ny,
        radius: activation.radius ?? defaults.radius,
        strength: activation.strength ?? defaults.strength,
        duration: (activation.durationMs ?? defaults.duration * 1000) / 1000,
        age: 0,
        color: colorForActivationKind(activation.kind),
        driftSeed: hashString(activation.id) / 100000,
      });
    }

    if (seenActivationIdsRef.current.size > 500) {
      seenActivationIdsRef.current = new Set(
        activations.map((activation) => activation.id),
      );
    }
  }, [activations]);

  // Load attractors from image (unless caller passed them explicitly).
  useEffect(() => {
    if (attractorsProp) {
      attractorsRef.current = attractorsProp;
      return;
    }
    let cancelled = false;
    sampleAttractorsFromImage(attractorImage, maxAttractors)
      .then((map) => {
        if (cancelled) return;
        mapRef.current = map;
        attractorsRef.current = map.attractors;
        // One-time redistribution: relocate every particle into a
        // bright zone of the newly-loaded image. After this, the
        // visible particle density matches the source image's
        // brightness pattern from frame 1.
        for (const p of particles) respawnParticle(p, map, 1.4, true);
        for (const hotspot of activeHotspotsRef.current) {
          if (sampleMaskAt(map, hotspot.nx, hotspot.ny) >= MASK_FLOOR) continue;
          const [nx, ny] = hotspotPositionForActivation(map, {
            id: hotspot.id,
          });
          hotspot.nx = nx;
          hotspot.ny = ny;
        }
      })
      .catch((err) => {
        console.warn("attractor image failed to load", err);
        attractorsRef.current = [];
      });
    return () => {
      cancelled = true;
    };
  }, [attractorImage, maxAttractors, attractorsProp]);

  // Particles — uniform random across a region slightly larger than [-1, 1].
  const particles = useMemo<Particle[]>(() => {
    const out: Particle[] = [];
    const span = 1.3;
    for (let i = 0; i < particleCount; i++) {
      const p: Particle = {
        cx: (Math.random() * 2 - 1) * span,
        cy: (Math.random() * 2 - 1) * span,
        vx: 0,
        vy: 0,
        speed: 0,
        mask: 1,
        activation: 0,
        tintRgb: null,
        age: 0,
        life: randomParticleLife(),
        opacity: 1,
        darkFrames: 0,
      };
      respawnParticle(p, EMPTY_ATTRACTOR_MAP, span, true);
      out.push(p);
    }
    return out;
  }, [particleCount]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Start fully transparent — the page background (including any
      // atmospheric grid overlay) shows through. Trails are managed
      // via `destination-out` composite below, not opaque overpaint.
      ctx.clearRect(0, 0, width, height);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const rgb = parseCssColorToRgb(color);
    const baseFieldRgb = parseCssColorToRgb(baseFieldColor ?? color);
    const baseRgb = rgbStringToTuple(rgb);
    const bgRgb = bgColorRef.current
      ? parseCssColorToRgb(bgColorRef.current, "12,14,20")
      : null;

    let raf = 0;
    let last = performance.now();

    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;

      // Decay rate: 0.7^dt → ~30% loss per second, so a single event's
      // pulse stays visible for ~4–6s. With event spacing of 3–8s
      // during writing, pulses overlap into a continuous glow instead
      // of flickering off between ops.
      pulseEnvRef.current *= Math.pow(0.7, dt);

      let modeBlend = 1;
      if (modeBlendStartRef.current > 0) {
        modeBlend = Math.min(
          1,
          (now - modeBlendStartRef.current) / MODE_CROSSFADE_MS,
        );
        if (modeBlend >= 1) modeBlendStartRef.current = -1;
      }
      const fromMode = prevModeRef.current;
      const toMode = modeRef.current;
      const renderFrom = RENDERERS[fromMode];
      const renderTo = RENDERERS[toMode];

      const baseParams = phaseParams(phaseRef.current);
      const ov = overridesRef.current;
      // Overrides slot in for any prop the parent has set explicitly.
      const params: PhaseParams = {
        attract: ov.attract ?? baseParams.attract,
        curl: ov.curl ?? baseParams.curl,
        damping: ov.damping ?? baseParams.damping,
        brightness: ov.brightness ?? baseParams.brightness,
        trail: ov.trail ?? baseParams.trail,
      };
      const e = Math.max(0, Math.min(1, energyRef.current));
      const phaseNow = phaseRef.current;
      const amp = Math.max(0, Math.min(1, ampRef.current));
      const pulse = pulseEnvRef.current;
      const ambient = ambientActivityForPhase(phaseNow, t);
      // amp contributes a sustained floor; pulse is the spike on top.
      // Their max() rather than sum prevents double-counting (event
      // pulses already imply activity, no need to add baseline on top).
      const activity = Math.max(amp, pulse, ambient);
      const attractStrength = params.attract * (0.7 + e * 0.6 + activity * 0.3);
      const curlStrength = params.curl * (1 + activity * 0.35);

      if (!ctx) return;
      if (bgRgb) {
        // Optional opaque mode: fade trails toward the supplied background.
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = `rgba(${bgRgb},${params.trail.toFixed(3)})`;
        ctx.fillRect(0, 0, width, height);
      } else {
        // Default transparent mode: subtract alpha so the page background
        // and overlays show through wherever particles are absent.
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = `rgba(0,0,0,${params.trail.toFixed(3)})`;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.globalCompositeOperation = "source-over";

      const fontPx = Math.max(9, Math.min(15, Math.round(width / 120)));
      ctx.font = `${fontPx}px 'JetBrains Mono', ui-monospace, monospace`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";

      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) * 0.42;

      // ── Physics step ──
      const attractors = attractorsRef.current;
      const aCount = attractors.length;
      const map = mapRef.current;
      const span = 1.4;
      for (const hotspot of activeHotspotsRef.current) hotspot.age += dt;
      activeHotspotsRef.current = activeHotspotsRef.current.filter(
        (hotspot) => hotspot.age <= hotspot.duration,
      );
      const neuralEnabled = activationMode !== "off";
      const frameHotspots = neuralEnabled
        ? frameHotspotsFor(activeHotspotsRef.current, phaseNow, t, baseRgb)
        : [];

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const neural = sampleNeuralActivity(p.cx, p.cy, frameHotspots);
        p.activation = neural.intensity;
        p.tintRgb = neural.rgb;
        p.age += dt * (0.78 + activity * 0.45 + p.activation * 0.42);
        p.opacity = particleCycleOpacity(p.age, p.life);

        // Force from attractors: sum of inverse-square pulls, clamped near singularity.
        let fx = 0;
        let fy = 0;
        if (aCount > 0) {
          for (let k = 0; k < aCount; k++) {
            const a = attractors[k];
            const dx = a[0] - p.cx;
            const dy = a[1] - p.cy;
            const d2 = dx * dx + dy * dy + 0.0008; // epsilon
            const inv = 1 / d2;
            // Falloff: ignore very distant attractors (cheap distance gate).
            if (inv < 8) continue;
            fx += dx * inv;
            fy += dy * inv;
          }
          // Normalize so total pull doesn't explode with N attractors.
          const m = Math.sqrt(fx * fx + fy * fy);
          if (m > 1e-4) {
            fx = (fx / m) * attractStrength;
            fy = (fy / m) * attractStrength;
          }
        }

        // Curl-noise force.
        const [cfX, cfY] = curlField(p.cx, p.cy, t);
        fx += cfX * curlStrength * (0.05 + p.activation * 0.035);
        fy += cfY * curlStrength * (0.05 + p.activation * 0.035);

        if (phaseNow === "idle") {
          const flicker = beatPulse(t + i * 0.013, 2.7, 0.31, 8);
          fx += noise2d(i * 0.17, t * 3.1, 7) * flicker * 0.0022;
          fy += noise2d(i * 0.19, t * 3.1, 11) * flicker * 0.0022;
        }

        // Update velocity (with damping) and position.
        p.vx = (p.vx + fx * dt) * params.damping;
        p.vy = (p.vy + fy * dt) * params.damping;
        p.cx += p.vx * dt;
        p.cy += p.vy * dt;
        p.speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);

        // Sample the source image at the particle's current position.
        // Used by renderers to gate visibility — particles in dark
        // zones of the image don't render. Below the user-configurable
        // threshold we zero the mask out entirely.
        const m = sampleMaskAt(map, p.cx, p.cy);
        p.mask =
          m < maskThresholdRef.current
            ? 0
            : Math.min(1, m * (0.85 + p.activation * 0.85)) * p.opacity;
        // Track how long the particle has been EFFECTIVELY INVISIBLE
        // per the current render mode's own rules — not just the
        // physics mask threshold. Without this, particles drift into
        // bands the renderer skips (e.g. strokes' 0.15 cutoff) but the
        // physics doesn't, so they accumulate as invisible-but-not-
        // respawned and the canvas slowly thins out.
        const visible = isParticleVisible(modeRef.current, p.mask, p.speed);
        if (!visible) p.darkFrames += 1;
        else p.darkFrames = 0;

        // Debug accounting.
        if (debugLogRef.current) {
          const ds = debugStatsRef.current;
          ds.totalSpeed += p.speed;
          if (p.mask === 0) ds.dark += 1;
          else if (p.speed < 0.022) ds.slow += 1;
          else ds.fast += 1;
        }

        // Respawn if the particle has completed its fade-out cycle,
        // escaped, exploded, or stayed invisible too long. This makes
        // dissolution intentional: every particle leaves, re-enters a
        // bright source zone, and fades back into the flow.
        if (
          p.age >= p.life ||
          Math.abs(p.cx) > span ||
          Math.abs(p.cy) > span ||
          p.speed > 6 || // exploded
          p.darkFrames > INVISIBLE_RESPAWN_FRAMES // stuck invisible per current mode
        ) {
          if (debugLogRef.current) debugStatsRef.current.respawned += 1;
          respawnParticle(p, map, span);
        }
      }

      // ── Render ──
      renderMaskBase(
        ctx,
        map,
        cx,
        cy,
        radius,
        baseFieldRgb,
        (0.065 + activity * 0.065) * params.brightness * baseFieldStrength,
      );
      if (activationMode === "glow") {
        renderNeuralGlows(
          ctx,
          frameHotspots,
          cx,
          cy,
          radius,
          params.brightness,
        );
      }
      if (modeBlend >= 1) {
        renderTo(ctx, particles, cx, cy, radius, rgb, params.brightness);
      } else {
        renderFrom(
          ctx,
          particles,
          cx,
          cy,
          radius,
          rgb,
          params.brightness * (1 - modeBlend),
        );
        renderTo(
          ctx,
          particles,
          cx,
          cy,
          radius,
          rgb,
          params.brightness * modeBlend,
        );
      }
      if (neuralEnabled) {
        renderActivatedParticles(
          ctx,
          particles,
          cx,
          cy,
          radius,
          params.brightness,
          activationMode === "particles" ? 1.25 : 1,
          surfaceTone,
        );
      }

      // ── Debug log (once per second) ──
      if (debugLogRef.current) {
        const ds = debugStatsRef.current;
        ds.accumMs += dt * 1000;
        ds.frames += 1;
        if (ds.accumMs >= 1000) {
          const total = particles.length;
          const avgSpeed =
            ds.frames > 0 ? ds.totalSpeed / (ds.frames * total) : 0;
          const visibleCount = Math.round((ds.fast + ds.slow) / ds.frames);
          // eslint-disable-next-line no-console
          console.log("[matter]", {
            t: `${(now / 1000).toFixed(1)}s`,
            frames: ds.frames,
            fps: Math.round(ds.frames * (1000 / ds.accumMs)),
            phase: phaseRef.current,
            mode: modeRef.current,
            energy: +energyRef.current.toFixed(3),
            amp: +ampRef.current.toFixed(3),
            ambient: +ambient.toFixed(3),
            pulse: +pulseEnvRef.current.toFixed(3),
            attract: +attractStrength.toFixed(3),
            curl: +curlStrength.toFixed(3),
            trail: params.trail,
            particles: total,
            // Particles actually eligible to paint in the current mode.
            // All production modes include the slow population now.
            visible: visibleCount,
            fast: Math.round(ds.fast / ds.frames),
            slow: Math.round(ds.slow / ds.frames),
            dark: Math.round(ds.dark / ds.frames),
            respawnsPerSec: ds.respawned,
            avgSpeed: +avgSpeed.toFixed(4),
            attractors: attractors.length,
            hotspots: frameHotspots.length,
            mapBytes: map.brightness.length,
          });
          ds.accumMs = 0;
          ds.frames = 0;
          ds.respawned = 0;
          ds.fast = 0;
          ds.slow = 0;
          ds.dark = 0;
          ds.totalSpeed = 0;
        }
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [
    particles,
    color,
    backgroundColor,
    baseFieldColor,
    baseFieldStrength,
    activationMode,
    surfaceTone,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        ...style,
      }}
    />
  );
}
