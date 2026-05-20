// Embedding → 2D layout via force-directed simulation.
//
// Each page starts at a deterministic hash-seeded position; pairwise
// repulsion pushes everyone apart while edge springs pull linked pages
// closer. The system settles into a spread-out cluster where:
//   • densely-connected groups bunch together (communities emerge)
//   • sparsely-connected pages drift outward
//   • the canvas fills evenly because repulsion equalizes density
//
// Why not PCA: PCA finds the two axes of maximum variance in the
// embedding space, which collapses tightly-themed wikis (e.g. 72 pages
// all about one character) to a near-1D shape — one outlier stretches
// the first axis and the bulk crunches to the center under max-abs
// normalization. A force layout doesn't care about embedding variance
// directions; it cares about pairwise edges.
//
// Why not UMAP: same failure mode as PCA on densely-themed corpora —
// UMAP's k-NN graph sees a 1D manifold and locks onto it.
//
// The edge `kind` and `strength` still modulate the spring force (so
// `contradicts` repels, `relates_to` attracts strongly) and same-type
// pages feel a weak short-range attraction. Embeddings are unused
// here; they're a cache populated by ingestion but not load-bearing
// for the visual layout.

import type { EdgeKind, WikiPageType } from "@odyssey/db";

export type LayoutInput = {
  id: string;
  slug: string;
  /** Carried for backward compat with callers; not consumed by the
   *  current force layout. */
  embedding: number[] | null;
  type?: WikiPageType;
  /** Previous cached coords — used as a warm start so post-edit
   *  recomputes don't reshuffle the whole canvas. */
  seed?: { x: number; y: number } | null;
};

export type LayoutEdge = {
  fromId: string;
  toId: string;
  kind?: EdgeKind;
  strength: number;
};

export type LayoutPoint = { id: string; x: number; y: number };

/* ── Tunables ──────────────────────────────────────────────────── */

const FORCE_ITERS = 300;
/** Target distance between linked pages, in pre-normalize space. */
const LINK_TARGET = 0.3;
/** Pairwise repulsion ∝ 1/r². */
const REPULSION = 0.02;
const SPRING_K = 0.5;
/** Weak linear pull toward origin — keeps the cloud roughly centered
 *  without flattening community structure. */
const CENTER_PULL = 0.02;

/**
 * Soft circular boundary: the layout is free inside this radius, then a
 * quadratic restoring force ramps up as nodes push beyond it. Peripheral
 * nodes still drift outward but settle at a distance proportional to
 * how hard they're being pushed — no more pile-ups at a single corner
 * the way a hard clamp produces.
 */
const SOFT_INNER_RADIUS = 1.4;
const SOFT_WALL_STRENGTH = 2.0;
/** Hard outer cap — only kicks in if something goes wrong (numerical
 *  blow-up). Sized comfortably outside SOFT_INNER_RADIUS so the soft
 *  wall does the actual work in normal operation. */
const POSITION_BOUND = 3.0;
/** Max per-step displacement, in pre-normalize units. */
const MAX_STEP = 0.15;

const TYPE_ATTRACT = 0.01;
const TYPE_ATTRACT_RANGE = 0.5;

/** Edge-kind multipliers for the spring force. `contradicts` flips
 *  sign so contradicting pages end up further apart. */
const EDGE_KIND_MULT: Record<EdgeKind, number> = {
  contradicts: -1.5,
  relates_to: 1.5,
  participates_in: 1.5,
  happens_at: 1.3,
  perspective_of: 1.2,
  mentions: 0.6,
};
const DEFAULT_KIND_MULT = 1.0;

/* ── Entry point ───────────────────────────────────────────────── */

export function computeKnowledgeLayout(
  pages: LayoutInput[],
  edges?: LayoutEdge[],
): LayoutPoint[] {
  if (pages.length === 0) return [];
  if (pages.length === 1) return [{ id: pages[0].id, x: 0, y: 0 }];

  const n = pages.length;
  const px = new Float64Array(n);
  const py = new Float64Array(n);

  seedInitialPositions(pages, px, py);

  if (edges && edges.length > 0) {
    runForceSimulation(pages, px, py, edges);
  }

  // Percentile-based normalization — clip the 5/95 percentile range to
  // [-1, 1], outliers beyond that get clamped. Using max-abs would let
  // a single extreme node squash the bulk of the cloud into the center.
  normalizeAxisRobust(px);
  normalizeAxisRobust(py);

  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(px[i])) px[i] = 0;
    if (!Number.isFinite(py[i])) py[i] = 0;
  }

  return pages.map((p, i) => ({ id: p.id, x: px[i], y: py[i] }));
}

/* ── Seeding ───────────────────────────────────────────────────── */

/**
 * Hash-seeded scatter inside the unit square. Deterministic per slug so
 * the same wiki produces the same starting positions run-to-run. Pages
 * with cached coords from a previous layout warm-start there.
 */
function seedInitialPositions(
  pages: LayoutInput[],
  px: Float64Array,
  py: Float64Array,
): void {
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.seed) {
      px[i] = p.seed.x;
      py[i] = p.seed.y;
    } else {
      const h = seededHash(p.slug);
      // Spread across [-1, 1] but pull toward zero a touch so the force
      // step doesn't waste its early iterations dragging far-flung seeds
      // back to the center.
      px[i] = (((h % 1000) / 1000) * 2 - 1) * 0.8;
      py[i] = ((((h >> 10) % 1000) / 1000) * 2 - 1) * 0.8;
    }
  }
}

/* ── Force simulation ──────────────────────────────────────────── */

function runForceSimulation(
  pages: LayoutInput[],
  px: Float64Array,
  py: Float64Array,
  edges: LayoutEdge[],
): void {
  const n = pages.length;
  const idxById = new Map<string, number>();
  for (let i = 0; i < n; i++) idxById.set(pages[i].id, i);

  type ResolvedEdge = { a: number; b: number; weight: number };
  const resolved: ResolvedEdge[] = [];
  for (const e of edges) {
    const a = idxById.get(e.fromId);
    const b = idxById.get(e.toId);
    if (a === undefined || b === undefined || a === b) continue;
    const mult = e.kind ? EDGE_KIND_MULT[e.kind] : DEFAULT_KIND_MULT;
    resolved.push({ a, b, weight: e.strength * mult });
  }

  const sameType: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const ti = pages[i].type;
    if (!ti) continue;
    for (let j = i + 1; j < n; j++) {
      if (pages[j].type === ti) sameType.push([i, j]);
    }
  }

  // Position-based integration (no velocity). Each iteration computes
  // forces, scales by an annealing step, displaces nodes, then clamps
  // displacement + final position to bounded ranges. Velocity-Verlet
  // integration accumulated kinetic energy faster than DAMPING could
  // bleed it off on dense graphs — positions exploded to 1e23. This
  // approach is dissipative by construction.
  for (let iter = 0; iter < FORCE_ITERS; iter++) {
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);

    // Pairwise repulsion ∝ 1/r² — keeps the cloud spread out.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = px[i] - px[j];
        const dy = py[i] - py[j];
        const r2 = dx * dx + dy * dy + 1e-3;
        const inv = REPULSION / r2;
        const r = Math.sqrt(r2);
        const ux = dx / r;
        const uy = dy / r;
        fx[i] += ux * inv;
        fy[i] += uy * inv;
        fx[j] -= ux * inv;
        fy[j] -= uy * inv;
      }
    }

    // Edge springs — negative weight (contradicts) repels.
    for (const e of resolved) {
      const dx = px[e.a] - px[e.b];
      const dy = py[e.a] - py[e.b];
      const dist = Math.sqrt(dx * dx + dy * dy) + 1e-6;
      const force = SPRING_K * e.weight * (dist - LINK_TARGET);
      const ux = dx / dist;
      const uy = dy / dist;
      fx[e.a] -= ux * force;
      fy[e.a] -= uy * force;
      fx[e.b] += ux * force;
      fy[e.b] += uy * force;
    }

    // Same-type soft attraction, capped to short range.
    for (const [i, j] of sameType) {
      const dx = px[i] - px[j];
      const dy = py[i] - py[j];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > TYPE_ATTRACT_RANGE || dist < 1e-6) continue;
      const force = TYPE_ATTRACT * (dist - LINK_TARGET);
      const ux = dx / dist;
      const uy = dy / dist;
      fx[i] -= ux * force;
      fy[i] -= uy * force;
      fx[j] += ux * force;
      fy[j] += uy * force;
    }

    // Weak linear pull toward origin — keeps the cloud centered.
    for (let i = 0; i < n; i++) {
      fx[i] -= px[i] * CENTER_PULL;
      fy[i] -= py[i] * CENTER_PULL;
    }

    // Soft circular wall: free movement inside SOFT_INNER_RADIUS, then
    // a quadratic restoring force pointing inward. The force grows as
    // (overshoot)², so a node pushed harder outward settles at a
    // larger overshoot — peripheral nodes spread out naturally along
    // the rim instead of piling up at a hard clamp.
    for (let i = 0; i < n; i++) {
      const dist = Math.sqrt(px[i] * px[i] + py[i] * py[i]);
      if (dist <= SOFT_INNER_RADIUS) continue;
      const overshoot = dist - SOFT_INNER_RADIUS;
      const wallForce = overshoot * overshoot * SOFT_WALL_STRENGTH;
      const ux = px[i] / dist;
      const uy = py[i] / dist;
      fx[i] -= ux * wallForce;
      fy[i] -= uy * wallForce;
    }

    // Annealing step: large early, small late. Equivalent to t-SNE /
    // Barnes-Hut style "alpha decay".
    const alpha = 0.1 * (1 - iter / FORCE_ITERS) + 0.01;

    for (let i = 0; i < n; i++) {
      // Clamp per-step displacement so a stray huge force (e.g. from
      // two nodes overlapping → 1/r² → ∞) can't knock a node off the
      // canvas in one tick.
      let dx = fx[i] * alpha;
      let dy = fy[i] * alpha;
      const mag = Math.sqrt(dx * dx + dy * dy);
      if (mag > MAX_STEP) {
        dx = (dx / mag) * MAX_STEP;
        dy = (dy / mag) * MAX_STEP;
      }
      px[i] += dx;
      py[i] += dy;

      // Defensive hard outer cap — only kicks in if numerical issues
      // sneak past the soft wall. Sized well outside SOFT_INNER_RADIUS
      // so it's never the rest state in normal operation.
      if (px[i] > POSITION_BOUND) px[i] = POSITION_BOUND;
      else if (px[i] < -POSITION_BOUND) px[i] = -POSITION_BOUND;
      if (py[i] > POSITION_BOUND) py[i] = POSITION_BOUND;
      else if (py[i] < -POSITION_BOUND) py[i] = -POSITION_BOUND;
    }
  }
}

/* ── Utilities ─────────────────────────────────────────────────── */

/**
 * Scale `vals` so the 5th–95th percentile range fits in [-1, 1], with
 * a smooth tanh-based extension for outliers beyond that. Hard clipping
 * collapses every outlier in the same direction to ±1 exactly, which
 * piles multiple peripheral pages onto the same corner. The soft tail
 * preserves their relative ordering inside a small overflow band.
 *
 * Result domain: [-1.1, 1.1] (5% extension on each side). React Flow's
 * fitView accommodates this without clipping.
 */
function normalizeAxisRobust(vals: Float64Array): void {
  if (vals.length === 0) return;
  const sorted = Array.from(vals).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.05)];
  const hi = sorted[Math.floor(sorted.length * 0.95)];
  const range = Math.max(Math.abs(lo), Math.abs(hi));
  if (range < 1e-12) return;
  const OVERFLOW = 0.1;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i] / range;
    const absV = Math.abs(v);
    if (absV <= 1) {
      vals[i] = v;
    } else {
      // tanh maps [0, ∞) → [0, 1) — multiplying by OVERFLOW gives a
      // bounded soft tail past ±1 that preserves the relative order
      // of outliers (so two distinct extreme values land at distinct
      // post-normalize positions instead of both hitting the wall).
      const sign = v < 0 ? -1 : 1;
      vals[i] = sign * (1 + Math.tanh(absV - 1) * OVERFLOW);
    }
  }
}

function seededHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h;
}
