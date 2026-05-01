"use client";

/**
 * Chat-specific graph viz. Unlike the wiki-tab graph, this one overlays
 * per-turn curator state — seed rings, traversed highlight, time-gated
 * strikethrough, budget-dropped dimming. Deterministic layout (no physics).
 */

import { useMemo } from "react";
import type {
  EdgeKind,
  EraConfig,
  WikiEdgeRecord,
  WikiPageRecord,
  WikiPageType,
} from "@odyssey/db";

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  border: "var(--border)",
  fontBody: "'Inter', sans-serif",
  fontHeading: "'Space Grotesk', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

// Theme-aware stroke / fill helpers. Built on var(--foreground) so they
// invert correctly between light and dark modes — the chat graph used to
// hardcode white-with-low-alpha which made connection lines invisible on a
// light background.
const FG = (pct: number) => `color-mix(in srgb, var(--foreground) ${pct}%, transparent)`;

const TYPE_COLOR: Record<WikiPageType, string> = {
  entity:         "#FBA7C0",
  event:          "#FACC15",
  concept:        "#A88CFF",
  relationship:   "#8CE7D2",
  timeline:       "#94A3B8",
  voice_identity: "#E879A0",
};

/* ── Per-turn curator snapshot (mirrors character-chat.tsx shape) ── */

export type ChatGraphCurator = {
  trace: {
    seeds: Array<{ slug: string; reason: string; score: number }>;
    timelineFiltered: string[];
    scoreDropped: string[];
    budgetDropped: string[];
    edges: Array<{ fromSlug: string; toSlug: string; kind: string; contribution: number }>;
  };
  pages: Array<{
    slug: string;
    rendering: "full" | "summary" | "title";
  }>;
};

/* ── Viewport ──────────────────────────────────────────────────── */

const W = 640;
const H = 380;
const HEADER_H = 28;
const TIMELESS_H = 66;
const SIDE_PAD = 14;
const LANE_TOP = HEADER_H + 10;
const LANE_BOTTOM = H - TIMELESS_H - 14;
const TIMELESS_Y = H - TIMELESS_H + 30;

/* ── Props ─────────────────────────────────────────────────────── */

type Props = {
  pages: WikiPageRecord[];
  edges: WikiEdgeRecord[];
  eras: EraConfig[];
  currentEra: string | null;
  curator: ChatGraphCurator | null;
};

type Node = {
  page: WikiPageRecord;
  x: number;
  y: number;
  r: number;
};

/* ── Component ─────────────────────────────────────────────────── */

export function ChatGraph({ pages, edges, eras, currentEra, curator }: Props) {
  const layout = useMemo(
    () => computeLayout(pages, edges, eras),
    [pages, edges, eras],
  );
  const { nodes, columns } = layout;
  const isTypeMode = eras.length === 0;
  const nodeById = useMemo(
    () => new Map(nodes.map((n) => [n.page.id, n] as const)),
    [nodes],
  );
  const nodeBySlug = useMemo(
    () => new Map(nodes.map((n) => [n.page.slug, n] as const)),
    [nodes],
  );

  // Resolve curator state into per-slug sets for fast lookup.
  const state = useMemo(() => computeState(curator), [curator]);

  // Edges traversed in the current turn, resolved to node endpoints.
  const activeEdges = useMemo(() => {
    if (!curator) return [];
    return curator.trace.edges
      .map((e) => ({
        from: nodeBySlug.get(e.fromSlug),
        to: nodeBySlug.get(e.toSlug),
        kind: e.kind as EdgeKind,
      }))
      .filter((e): e is { from: Node; to: Node; kind: EdgeKind } => !!e.from && !!e.to);
  }, [curator, nodeBySlug]);

  const emptyGraph = pages.length === 0;

  return (
    <div style={{ position: "relative", background: `radial-gradient(circle at 50% 40%, ${FG(2)} 0%, ${FG(8)} 100%)` }}>
      {emptyGraph ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: H, color: T.muted, fontFamily: T.fontBody, fontSize: 13 }}>
          No wiki pages yet.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: H, display: "block" }}
        >
          {/* Era column dividers + headers */}
          {columns.map((col) => (
            <g key={col.key}>
              {col.index > 0 && (
                <line x1={col.left} y1={HEADER_H} x2={col.left} y2={H - TIMELESS_H} style={{ stroke: FG(6) }} strokeDasharray="2 4" />
              )}
              <text
                x={col.center}
                y={HEADER_H - 6}
                textAnchor="middle"
                style={{
                  fontFamily: T.fontMono,
                  fontSize: 9,
                  fontWeight: 600,
                  fill: col.key === currentEra ? "var(--accent-strong)" : FG(35),
                  letterSpacing: "0.1em",
                }}
              >
                {col.title.toUpperCase()}
              </text>
              {col.key === currentEra && (
                <text x={col.center} y={HEADER_H + 6} textAnchor="middle" style={{ fontFamily: T.fontMono, fontSize: 8, fill: "color-mix(in srgb, var(--accent-strong) 70%, transparent)", letterSpacing: "0.06em" }}>
                  current
                </text>
              )}
            </g>
          ))}

          {/* Timeless band separator — only when we have an era layout */}
          {!isTypeMode && (
            <>
              <line x1={SIDE_PAD} y1={H - TIMELESS_H} x2={W - SIDE_PAD} y2={H - TIMELESS_H} style={{ stroke: FG(6) }} strokeDasharray="2 4" />
              <text x={SIDE_PAD} y={H - TIMELESS_H + 14} style={{ fontFamily: T.fontMono, fontSize: 8, fontWeight: 500, fill: FG(30), letterSpacing: "0.1em" }}>
                TIMELESS
              </text>
            </>
          )}

          {/* Inactive edges — faint, no state */}
          <g>
            {edges.map((e) => {
              const from = nodeById.get(e.fromPageId);
              const to = nodeById.get(e.toPageId);
              if (!from || !to) return null;
              // If this is an actively-traversed edge, skip (drawn brighter below).
              const isActive = curator && curator.trace.edges.some(
                (te) => te.fromSlug === from.page.slug && te.toSlug === to.page.slug,
              );
              if (isActive) return null;
              return (
                <line
                  key={e.id}
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  strokeWidth="0.75"
                  style={{ pointerEvents: "none", stroke: FG(8) }}
                />
              );
            })}
          </g>

          {/* Active edges — bright, colored by kind */}
          <g>
            {activeEdges.map((e, i) => {
              const color = EDGE_COLOR[e.kind] ?? FG(35);
              return (
                <line
                  key={i}
                  x1={e.from.x} y1={e.from.y} x2={e.to.x} y2={e.to.y}
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  style={{ pointerEvents: "none", stroke: color }}
                />
              );
            })}
          </g>

          {/* Nodes */}
          <g>
            {nodes.map((node) => {
              const slug = node.page.slug;
              const nodeState = state.get(slug) ?? "inactive";
              return <NodeDot key={node.page.id} node={node} state={nodeState} />;
            })}
          </g>
        </svg>
      )}

      {/* Legend */}
      <div style={{
        position: "absolute", bottom: 8, right: 10,
        display: "flex", alignItems: "center", gap: 10,
        padding: "3px 10px", borderRadius: 999,
        background: "var(--background)", border: `1px solid ${T.border}`,
        pointerEvents: "none",
      }}>
        <LegendDot color="var(--accent-strong)" label="seed" ring />
        <LegendDot color={FG(70)} label="selected" />
        <LegendDot color="#E89090" label="time-gated" dash />
        <LegendDot color={FG(35)} label="budget" />
      </div>
    </div>
  );
}

/* ── Node dot ──────────────────────────────────────────────────── */

type NodeState = "seed" | "selected" | "time-gated" | "budget-dropped" | "inactive";

function NodeDot({ node, state }: { node: Node; state: NodeState }) {
  const color = TYPE_COLOR[node.page.type];
  const showRing = state === "seed";
  const strikethrough = state === "time-gated";

  let fill = color;
  let opacity = 1;
  let strokeColor = "var(--background)";
  let strokeWidth = 1.5;
  let showLabel = true;

  if (state === "inactive") {
    opacity = 0.22;
    showLabel = false;
  } else if (state === "budget-dropped") {
    opacity = 0.45;
    fill = "transparent";
    strokeColor = color;
    strokeWidth = 1;
  } else if (state === "time-gated") {
    opacity = 0.55;
  } else if (state === "selected") {
    opacity = 1;
  } else if (state === "seed") {
    opacity = 1;
  }

  const r = state === "seed" ? node.r + 1 : node.r;
  const label = truncateLabel(node.page.title, 16);

  return (
    <g transform={`translate(${node.x}, ${node.y})`} opacity={opacity} style={{ pointerEvents: "none" }}>
      {showRing && (
        <circle r={r + 5} fill="none" style={{ stroke: "var(--accent-strong)" }} strokeWidth="1.25" opacity="0.9" />
      )}
      <circle
        r={r}
        fill={fill}
        style={{ stroke: strokeColor }}
        strokeWidth={strokeWidth}
        strokeDasharray={state === "time-gated" ? "2 2" : undefined}
      />
      {showLabel && (
        <>
          <text
            x={0} y={r + 11}
            textAnchor="middle"
            style={{
              fontFamily: T.fontBody,
              fontSize: 9.5,
              fontWeight: state === "seed" || state === "selected" ? 600 : 500,
              fill: state === "time-gated" ? FG(45) : FG(85),
              textDecoration: strikethrough ? "line-through" : "none",
            }}
          >
            {label}
          </text>
        </>
      )}
    </g>
  );
}

function LegendDot({ color, label, ring, dash }: { color: string; label: string; ring?: boolean; dash?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <svg width="10" height="10" viewBox="0 0 10 10">
        {ring && <circle cx="5" cy="5" r="4" fill="none" style={{ stroke: color }} strokeWidth="1.25" />}
        <circle
          cx="5" cy="5" r={ring ? 2.4 : 3.2}
          style={{
            fill: dash ? "transparent" : color,
            stroke: dash ? color : undefined,
          }}
          strokeDasharray={dash ? "1.5 1.5" : undefined}
        />
      </svg>
      <span style={{ fontFamily: T.fontMono, fontSize: 9, color: T.muted, letterSpacing: "0.04em" }}>{label}</span>
    </span>
  );
}

/* ── Layout ────────────────────────────────────────────────────── */

type EraColumn = { key: string; title: string; index: number; left: number; right: number; center: number };
type Layout = { nodes: Node[]; columns: EraColumn[] };

function computeLayout(
  pages: WikiPageRecord[],
  edges: WikiEdgeRecord[],
  eras: EraConfig[],
): Layout {
  // Timeless fallback: when the character has no eras, group columns by
  // page type instead (entities / events / concepts / relationships).
  // Keeps the graph readable for characters whose story isn't time-bound.
  if (eras.length === 0) {
    return computeTypeLayout(pages);
  }

  const sortedEras = [...eras].sort((a, b) => a.order - b.order);
  const keys: string[] = sortedEras.map((e) => e.key);
  const titles: Record<string, string> = Object.fromEntries(
    sortedEras.map((e) => [e.key, e.title]),
  );
  const usableW = W - SIDE_PAD * 2;
  const colW = usableW / keys.length;
  const columns: EraColumn[] = keys.map((k, i) => ({
    key: k, title: titles[k] ?? k, index: i,
    left: SIDE_PAD + i * colW,
    right: SIDE_PAD + (i + 1) * colW,
    center: SIDE_PAD + i * colW + colW / 2,
  }));

  const pagesById = new Map(pages.map((p) => [p.id, p]));

  function bucketOf(page: WikiPageRecord): string | "timeless" {
    if (page.timeIndex?.era && keys.includes(page.timeIndex.era)) return page.timeIndex.era;
    if (page.type === "concept" || page.type === "voice_identity" || page.type === "timeline") return "timeless";
    const tally: Record<string, number> = {};
    for (const e of edges) {
      if (e.fromPageId !== page.id && e.toPageId !== page.id) continue;
      const otherId = e.fromPageId === page.id ? e.toPageId : e.fromPageId;
      const other = pagesById.get(otherId);
      if (!other) continue;
      if (other.type === "event" && other.timeIndex?.era && keys.includes(other.timeIndex.era)) {
        tally[other.timeIndex.era] = (tally[other.timeIndex.era] ?? 0) + 1;
      }
    }
    let bestEra: string | null = null; let bestN = 0;
    for (const [k, n] of Object.entries(tally)) if (n > bestN) { bestEra = k; bestN = n; }
    return bestEra ?? "timeless";
  }

  const byEra: Record<string, WikiPageRecord[]> = {};
  for (const k of keys) byEra[k] = [];
  const timeless: WikiPageRecord[] = [];
  for (const p of pages) {
    const b = bucketOf(p);
    if (b === "timeless") timeless.push(p);
    else byEra[b].push(p);
  }

  // Sort events by timeIndex.index ASC, non-events alphabetically.
  for (const k of keys) {
    byEra[k].sort((a, b) => {
      const aE = a.type === "event" && a.timeIndex;
      const bE = b.type === "event" && b.timeIndex;
      if (aE && !bE) return -1;
      if (!aE && bE) return 1;
      if (aE && bE) {
        const ia = a.timeIndex!.index, ib = b.timeIndex!.index;
        if (ia !== ib) return ia - ib;
      }
      return a.title.localeCompare(b.title);
    });
  }
  const TL_ORDER: WikiPageType[] = ["voice_identity", "concept", "relationship", "entity", "timeline", "event"];
  timeless.sort((a, b) => {
    const ta = TL_ORDER.indexOf(a.type), tb = TL_ORDER.indexOf(b.type);
    if (ta !== tb) return ta - tb;
    return a.title.localeCompare(b.title);
  });

  const nodes: Node[] = [];

  for (const col of columns) {
    const list = byEra[col.key] ?? [];
    if (list.length === 0) continue;
    const usableH = LANE_BOTTOM - LANE_TOP;
    const gap = list.length > 1 ? usableH / (list.length - 1) : 0;
    const innerW = col.right - col.left - SIDE_PAD;
    list.forEach((page, i) => {
      const y = list.length === 1 ? (LANE_TOP + LANE_BOTTOM) / 2 : LANE_TOP + gap * i;
      const h = hashString(page.slug);
      const jitter = ((h % 1000) / 1000 - 0.5) * 0.65;
      const x = col.center + jitter * innerW;
      nodes.push({ page, x, y, r: nodeRadius(page) });
    });
  }

  if (timeless.length > 0) {
    const usableW2 = W - SIDE_PAD * 2 - 20;
    const gap = timeless.length > 1 ? usableW2 / (timeless.length - 1) : 0;
    timeless.forEach((page, i) => {
      const x = timeless.length === 1 ? W / 2 : SIDE_PAD + 10 + gap * i;
      nodes.push({ page, x, y: TIMELESS_Y, r: nodeRadius(page) });
    });
  }

  return { nodes, columns };
}

/**
 * Fallback layout for timeless characters (no eras configured). One column
 * per present page type. Columns in canonical order so the result is stable.
 */
function computeTypeLayout(pages: WikiPageRecord[]): Layout {
  const TYPE_ORDER: WikiPageType[] = [
    "entity", "event", "relationship", "concept", "voice_identity", "timeline",
  ];
  const TYPE_LABEL: Record<WikiPageType, string> = {
    entity:         "Entities",
    event:          "Events",
    relationship:   "Relationships",
    concept:        "Concepts",
    voice_identity: "Voice",
    timeline:       "Timeline",
  };

  // Bucket and keep only types that have at least one page.
  const byType = new Map<WikiPageType, WikiPageRecord[]>();
  for (const p of pages) {
    if (!byType.has(p.type)) byType.set(p.type, []);
    byType.get(p.type)!.push(p);
  }
  const activeTypes = TYPE_ORDER.filter((t) => (byType.get(t)?.length ?? 0) > 0);

  if (activeTypes.length === 0) {
    return { nodes: [], columns: [] };
  }

  const usableW = W - SIDE_PAD * 2;
  const colW = usableW / activeTypes.length;
  const columns: EraColumn[] = activeTypes.map((t, i) => ({
    key: t,
    title: TYPE_LABEL[t],
    index: i,
    left: SIDE_PAD + i * colW,
    right: SIDE_PAD + (i + 1) * colW,
    center: SIDE_PAD + i * colW + colW / 2,
  }));

  // Use the full canvas height for type layout — no timeless band needed
  // when type columns ARE the whole story.
  const laneTop = HEADER_H + 10;
  const laneBottom = H - 12;

  const nodes: Node[] = [];
  for (const col of columns) {
    const list = (byType.get(col.key as WikiPageType) ?? [])
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title));
    if (list.length === 0) continue;
    const usableH = laneBottom - laneTop;
    const gap = list.length > 1 ? usableH / (list.length - 1) : 0;
    const innerW = col.right - col.left - SIDE_PAD;
    list.forEach((page, i) => {
      const y = list.length === 1 ? (laneTop + laneBottom) / 2 : laneTop + gap * i;
      const h = hashString(page.slug);
      const jitter = ((h % 1000) / 1000 - 0.5) * 0.55;
      const x = col.center + jitter * innerW;
      nodes.push({ page, x, y, r: nodeRadius(page) });
    });
  }

  return { nodes, columns };
}

function computeState(curator: ChatGraphCurator | null): Map<string, NodeState> {
  const m = new Map<string, NodeState>();
  if (!curator) return m;
  // Order matters (later entries override earlier) — seeds win over selected.
  for (const p of curator.pages) m.set(p.slug, "selected");
  for (const slug of curator.trace.budgetDropped) m.set(slug, "budget-dropped");
  for (const slug of curator.trace.timelineFiltered) m.set(slug, "time-gated");
  for (const s of curator.trace.seeds) m.set(s.slug, "seed");
  return m;
}

/* ── Helpers ───────────────────────────────────────────────────── */

function nodeRadius(page: WikiPageRecord): number {
  switch (page.type) {
    case "entity":         return 6;
    case "event":          return 5.5;
    case "relationship":   return 5.5;
    case "voice_identity": return 6;
    case "concept":        return 5.5;
    case "timeline":       return 5;
    default:               return 5.5;
  }
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function truncateLabel(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

const EDGE_COLOR: Record<EdgeKind, string> = {
  mentions:        FG(35),
  relates_to:      "rgba(251,167,192,0.7)",
  participates_in: "rgba(250,204,21,0.7)",
  happens_at:      "rgba(122,176,232,0.7)",
  perspective_of:  "rgba(168,140,255,0.7)",
  contradicts:     "rgba(232,144,144,0.8)",
};
