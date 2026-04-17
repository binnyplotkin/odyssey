"use client";

import { useMemo, useState } from "react";
import type {
  EraConfig,
  EdgeKind,
  WikiEdgeRecord,
  WikiPageRecord,
  WikiPageType,
} from "@odyssey/db";

/* ── Tokens ────────────────────────────────────────────────────── */

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  panel: "var(--panel)",
  border: "var(--border)",
  cardHover: "var(--card-hover)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

const TYPE_COLOR: Record<WikiPageType, string> = {
  entity:         "#FBA7C0",
  event:          "#FACC15",
  concept:        "#A88CFF",
  relationship:   "#8CE7D2",
  timeline:       "#94A3B8",
  voice_identity: "#E879A0",
};

/* ── Edge styling per kind ─────────────────────────────────────── */

type EdgeStyle = { stroke: string; width: number; dash?: string };

const EDGE_STYLE: Record<EdgeKind, EdgeStyle> = {
  mentions:        { stroke: "rgba(255,255,255,0.22)", width: 1,    dash: "3 3" },
  relates_to:      { stroke: "rgba(251,167,192,0.55)", width: 1.4 },
  participates_in: { stroke: "rgba(250,204,21,0.55)",  width: 1.4 },
  happens_at:      { stroke: "rgba(122,176,232,0.55)", width: 1.25, dash: "4 3" },
  perspective_of:  { stroke: "rgba(168,140,255,0.55)", width: 1.1,  dash: "5 3" },
  contradicts:     { stroke: "rgba(232,144,144,0.7)",  width: 1.6 },
};

/* ── Viewport ──────────────────────────────────────────────────── */

const W = 1200;
const H = 460;
const HEADER_H = 34;       // era label band
const TIMELESS_H = 80;     // bottom band
const SIDE_PAD = 24;
const LANE_PAD_X = 18;
const LANE_TOP = HEADER_H + 8;
const LANE_BOTTOM = H - TIMELESS_H - 16;
const TIMELESS_Y = H - TIMELESS_H + 32;

/* ── Props ─────────────────────────────────────────────────────── */

type Props = {
  pages: WikiPageRecord[];
  edges: WikiEdgeRecord[];
  eras: EraConfig[];
  selectedSlug: string | null;
  currentEra?: string | null;  // highlighted era (optional)
  onSelect: (slug: string) => void;
};

type Node = {
  page: WikiPageRecord;
  x: number;
  y: number;
  r: number;
  eraKey: string | "timeless";
  // Simple horizontal "column" index within a lane — used to jitter so
  // overlapping entities don't stack exactly on the center line.
  col: number;
};

/* ── Component ─────────────────────────────────────────────────── */

export function WikiGraph({
  pages, edges, eras, selectedSlug, currentEra, onSelect,
}: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | WikiPageType>("all");

  /* ── Layout ───────────────────────────────────────────────────── */

  const layout = useMemo(
    () => computeLayout(pages, edges, eras),
    [pages, edges, eras],
  );

  const nodes = layout.nodes;
  const nodeById = useMemo(
    () => new Map(nodes.map((n) => [n.page.id, n] as const)),
    [nodes],
  );

  /* ── Selection-aware highlight ────────────────────────────────── */

  const selectedPageId = useMemo(
    () => nodes.find((n) => n.page.slug === selectedSlug)?.page.id ?? null,
    [nodes, selectedSlug],
  );

  const focusId = hoverId ?? selectedPageId;

  // All page IDs directly connected to the focused node.
  const connectedIds = useMemo(() => {
    if (!focusId) return null;
    const s = new Set<string>([focusId]);
    for (const e of edges) {
      if (e.fromPageId === focusId) s.add(e.toPageId);
      if (e.toPageId === focusId) s.add(e.fromPageId);
    }
    return s;
  }, [focusId, edges]);

  /* ── Type filter (hide non-matching nodes) ────────────────────── */

  const visibleNodeIds = useMemo(() => {
    if (typeFilter === "all") return null;
    const s = new Set<string>();
    for (const n of nodes) if (n.page.type === typeFilter) s.add(n.page.id);
    return s;
  }, [nodes, typeFilter]);

  const nodeVisible = (id: string) => !visibleNodeIds || visibleNodeIds.has(id);

  /* ── Render ───────────────────────────────────────────────────── */

  const hasData = nodes.length > 0;
  const typeCounts = useMemo(() => {
    const c: Record<WikiPageType | "all", number> = {
      all: pages.length, entity: 0, event: 0, concept: 0, relationship: 0, timeline: 0, voice_identity: 0,
    };
    for (const p of pages) c[p.type]++;
    return c;
  }, [pages]);

  const columnXs = layout.columnXs;

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      background: T.panel, border: `1px solid ${T.border}`,
      borderRadius: 14, overflow: "hidden",
    }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px", borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Graph
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted }}>
            {pages.length} nodes · {edges.length} edges
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <TypePill active={typeFilter === "all"} onClick={() => setTypeFilter("all")} label="All" count={typeCounts.all} />
          {(Object.keys(TYPE_COLOR) as WikiPageType[]).map((t) => {
            if (typeCounts[t] === 0) return null;
            return (
              <TypePill
                key={t}
                active={typeFilter === t}
                onClick={() => setTypeFilter(t)}
                label={labelForType(t)}
                count={typeCounts[t]}
                dot={TYPE_COLOR[t]}
              />
            );
          })}
        </div>
      </div>

      {/* Canvas */}
      <div style={{
        position: "relative",
        background: "radial-gradient(circle at 50% 40%, rgba(255,255,255,0.02) 0%, rgba(0,0,0,0.15) 100%)",
      }}>
        {!hasData ? (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: H, color: T.muted, fontFamily: T.fontBody, fontSize: 13,
          }}>
            No pages to plot yet.
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ width: "100%", height: H, display: "block" }}
          >
            {/* Era column dividers + headers */}
            {layout.eraColumns.map((col) => (
              <g key={col.key}>
                {col.index > 0 && (
                  <line
                    x1={col.left}
                    y1={HEADER_H}
                    x2={col.left}
                    y2={H - TIMELESS_H}
                    stroke="rgba(255,255,255,0.06)"
                    strokeDasharray="2 4"
                  />
                )}
                {col.key === currentEra ? (
                  <>
                    <text
                      x={col.center} y={HEADER_H / 2 + 3}
                      textAnchor="middle"
                      style={{
                        fontFamily: T.fontMono, fontSize: 10, fontWeight: 600,
                        fill: "#8CE7D2", letterSpacing: "0.1em",
                      }}
                    >
                      {col.title.toUpperCase()}
                    </text>
                    <text
                      x={col.center} y={HEADER_H / 2 + 16}
                      textAnchor="middle"
                      style={{
                        fontFamily: T.fontMono, fontSize: 9,
                        fill: "rgba(140,231,210,0.6)", letterSpacing: "0.06em",
                      }}
                    >
                      current
                    </text>
                  </>
                ) : (
                  <text
                    x={col.center} y={HEADER_H / 2 + 3}
                    textAnchor="middle"
                    style={{
                      fontFamily: T.fontMono, fontSize: 10, fontWeight: 600,
                      fill: "rgba(255,255,255,0.35)", letterSpacing: "0.1em",
                    }}
                  >
                    {col.title.toUpperCase()}
                  </text>
                )}
              </g>
            ))}

            {/* Timeless band separator + label */}
            <line
              x1={SIDE_PAD} y1={H - TIMELESS_H}
              x2={W - SIDE_PAD} y2={H - TIMELESS_H}
              stroke="rgba(255,255,255,0.06)"
              strokeDasharray="2 4"
            />
            <text
              x={SIDE_PAD} y={H - TIMELESS_H + 18}
              style={{
                fontFamily: T.fontMono, fontSize: 9, fontWeight: 500,
                fill: "rgba(255,255,255,0.3)", letterSpacing: "0.1em",
              }}
            >
              TIMELESS
            </text>

            {/* Edges layer */}
            <g>
              {edges.map((edge) => {
                const fromN = nodeById.get(edge.fromPageId);
                const toN = nodeById.get(edge.toPageId);
                if (!fromN || !toN) return null;
                if (!nodeVisible(edge.fromPageId) || !nodeVisible(edge.toPageId)) return null;

                const style = EDGE_STYLE[edge.kind] ?? EDGE_STYLE.mentions;
                // When a node is focused, dim non-adjacent edges.
                const adjacent = !focusId || (edge.fromPageId === focusId || edge.toPageId === focusId);
                const opacity = !focusId ? 1 : adjacent ? 1 : 0.15;

                return (
                  <line
                    key={edge.id}
                    x1={fromN.x} y1={fromN.y}
                    x2={toN.x} y2={toN.y}
                    stroke={style.stroke}
                    strokeWidth={adjacent && focusId ? style.width * 1.5 : style.width}
                    strokeDasharray={style.dash}
                    strokeLinecap="round"
                    style={{
                      opacity,
                      transition: "opacity 120ms, stroke-width 120ms",
                      pointerEvents: "none",
                    }}
                  />
                );
              })}
            </g>

            {/* Nodes layer */}
            <g>
              {nodes.map((node) => {
                if (!nodeVisible(node.page.id)) return null;

                const color = TYPE_COLOR[node.page.type];
                const isSelected = node.page.id === selectedPageId;
                const isHover = node.page.id === hoverId;
                const isConnected = connectedIds?.has(node.page.id) ?? false;
                const isDimmed = focusId ? !isConnected : false;

                return (
                  <NodeDot
                    key={node.page.id}
                    node={node}
                    color={color}
                    selected={isSelected}
                    hover={isHover}
                    dimmed={isDimmed}
                    onMouseEnter={() => setHoverId(node.page.id)}
                    onMouseLeave={() => setHoverId((id) => (id === node.page.id ? null : id))}
                    onClick={() => onSelect(node.page.slug)}
                  />
                );
              })}
            </g>
          </svg>
        )}

        {/* Legend */}
        <div style={{
          position: "absolute", bottom: 8, right: 12,
          display: "flex", alignItems: "center", gap: 10,
          padding: "4px 10px", borderRadius: 999,
          background: "var(--background)", border: `1px solid ${T.border}`,
          pointerEvents: "none",
        }}>
          <LegendEntry kind="relates_to" />
          <LegendEntry kind="participates_in" />
          <LegendEntry kind="happens_at" />
          <LegendEntry kind="mentions" />
        </div>
      </div>
    </div>
  );
}

/* ── Node dot (separate so we can keep event handlers local) ─── */

function NodeDot({
  node, color, selected, hover, dimmed, onMouseEnter, onMouseLeave, onClick,
}: {
  node: Node;
  color: string;
  selected: boolean;
  hover: boolean;
  dimmed: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
}) {
  const baseRadius = node.r;
  const r = selected ? baseRadius + 2.5 : hover ? baseRadius + 1.5 : baseRadius;
  const opacity = dimmed ? 0.35 : 1;
  const labelOpacity = dimmed ? 0.25 : hover || selected ? 1 : 0.85;

  const title = truncateLabel(node.page.title, 22);

  return (
    <g
      transform={`translate(${node.x}, ${node.y})`}
      style={{ cursor: "pointer", transition: "opacity 120ms" }}
      opacity={opacity}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      {/* Selection glow */}
      {selected && (
        <circle r={r + 8} fill="none" stroke="#8CE7D2" strokeWidth="1.5" opacity="0.35" />
      )}
      {/* Fill */}
      <circle
        r={r}
        fill={color}
        stroke={selected ? "#8CE7D2" : "var(--background)"}
        strokeWidth={selected ? 2 : 2}
        style={{ transition: "r 120ms" }}
      />
      {/* Label */}
      <text
        x={0} y={r + 13}
        textAnchor="middle"
        style={{
          fontFamily: T.fontBody, fontSize: 10.5,
          fontWeight: selected ? 600 : 500,
          fill: selected ? "#FFFFFFEE" : "rgba(255,255,255,0.85)",
          opacity: labelOpacity,
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        {title}
      </text>
    </g>
  );
}

/* ── Toolbar atoms ─────────────────────────────────────────────── */

function TypePill({
  active, onClick, label, count, dot,
}: { active: boolean; onClick: () => void; label: string; count: number; dot?: string }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "3px 10px", borderRadius: 999,
        border: active ? "none" : `1px solid ${T.border}`,
        background: active ? "rgba(140,231,210,0.1)" : "transparent",
        color: active ? "#8CE7D2" : T.muted,
        fontFamily: T.fontBody, fontSize: 11, fontWeight: active ? 500 : 400,
        cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} />}
      {label}
      <span style={{ opacity: 0.6 }}>{count}</span>
    </button>
  );
}

function LegendEntry({ kind }: { kind: EdgeKind }) {
  const s = EDGE_STYLE[kind];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <svg width="20" height="6" style={{ display: "block" }}>
        <line x1="0" y1="3" x2="20" y2="3" stroke={s.stroke} strokeWidth={s.width} strokeDasharray={s.dash} strokeLinecap="round" />
      </svg>
      <span style={{ fontFamily: T.fontMono, fontSize: 9, color: T.muted, letterSpacing: "0.04em" }}>
        {kind.replace(/_/g, " ")}
      </span>
    </span>
  );
}

/* ── Layout engine ─────────────────────────────────────────────── */

type EraColumn = {
  key: string;
  title: string;
  index: number;
  left: number;
  right: number;
  center: number;
};

type Layout = {
  nodes: Node[];
  eraColumns: EraColumn[];
  columnXs: number[];
};

function computeLayout(
  pages: WikiPageRecord[],
  edges: WikiEdgeRecord[],
  eras: EraConfig[],
): Layout {
  const sortedEras = [...eras].sort((a, b) => a.order - b.order);

  // Fall back to a single "eras: unspecified" column if the character has
  // no eras configured — keeps the graph usable.
  const columnKeys: string[] =
    sortedEras.length > 0 ? sortedEras.map((e) => e.key) : ["(eras unconfigured)"];
  const columnTitles: Record<string, string> = Object.fromEntries(
    sortedEras.length > 0
      ? sortedEras.map((e) => [e.key, e.title])
      : [["(eras unconfigured)", "(no eras configured)"]],
  );

  const colCount = columnKeys.length;
  const usableW = W - SIDE_PAD * 2;
  const colWidth = usableW / colCount;

  const eraColumns: EraColumn[] = columnKeys.map((key, index) => ({
    key,
    title: columnTitles[key] ?? key,
    index,
    left: SIDE_PAD + index * colWidth,
    right: SIDE_PAD + (index + 1) * colWidth,
    center: SIDE_PAD + index * colWidth + colWidth / 2,
  }));
  const columnXs = eraColumns.map((c) => c.center);

  const pagesById = new Map(pages.map((p) => [p.id, p] as const));

  // For each page, decide its era bucket.
  const bucketOf = (page: WikiPageRecord): string | "timeless" => {
    // Explicit timeIndex wins.
    if (page.timeIndex?.era && columnKeys.includes(page.timeIndex.era)) {
      return page.timeIndex.era;
    }

    // voice_identity, concept, timeline → always timeless.
    if (page.type === "concept" || page.type === "voice_identity" || page.type === "timeline") {
      return "timeless";
    }

    // entity / relationship → inherit from connected event pages (majority era).
    const tally: Record<string, number> = {};
    for (const e of edges) {
      if (e.fromPageId !== page.id && e.toPageId !== page.id) continue;
      const otherId = e.fromPageId === page.id ? e.toPageId : e.fromPageId;
      const other = pagesById.get(otherId);
      if (!other) continue;
      if (other.type === "event" && other.timeIndex?.era && columnKeys.includes(other.timeIndex.era)) {
        tally[other.timeIndex.era] = (tally[other.timeIndex.era] ?? 0) + 1;
      }
    }
    let bestEra: string | null = null;
    let bestCount = 0;
    for (const [k, v] of Object.entries(tally)) {
      if (v > bestCount) { bestEra = k; bestCount = v; }
    }
    return bestEra ?? "timeless";
  };

  // Bucket pages.
  type Bucket = WikiPageRecord[];
  const byEra: Record<string, Bucket> = {};
  const timeless: Bucket = [];
  for (const key of columnKeys) byEra[key] = [];

  for (const p of pages) {
    const b = bucketOf(p);
    if (b === "timeless") timeless.push(p);
    else byEra[b].push(p);
  }

  // Sort within each era: events by timeIndex.index ASC, non-events alphabetically.
  for (const key of columnKeys) {
    byEra[key].sort((a, b) => {
      const aIsEvent = a.type === "event" && a.timeIndex;
      const bIsEvent = b.type === "event" && b.timeIndex;
      if (aIsEvent && !bIsEvent) return -1;
      if (!aIsEvent && bIsEvent) return 1;
      if (aIsEvent && bIsEvent) {
        const ia = a.timeIndex!.index;
        const ib = b.timeIndex!.index;
        if (ia !== ib) return ia - ib;
      }
      return a.title.localeCompare(b.title);
    });
  }

  // Sort timeless: voice_identity first, then concept, then the rest.
  const TIMELESS_TYPE_ORDER: WikiPageType[] = [
    "voice_identity", "concept", "relationship", "entity", "timeline", "event",
  ];
  timeless.sort((a, b) => {
    const ta = TIMELESS_TYPE_ORDER.indexOf(a.type);
    const tb = TIMELESS_TYPE_ORDER.indexOf(b.type);
    if (ta !== tb) return ta - tb;
    return a.title.localeCompare(b.title);
  });

  const nodes: Node[] = [];

  // Place era column pages. Distribute vertically in [LANE_TOP, LANE_BOTTOM]
  // and alternate horizontal offsets to reduce overlap.
  for (const col of eraColumns) {
    const pagesInCol = byEra[col.key];
    if (pagesInCol.length === 0) continue;

    const usableH = LANE_BOTTOM - LANE_TOP;
    const gap = pagesInCol.length > 1 ? usableH / (pagesInCol.length - 1) : 0;
    const innerW = col.right - col.left - LANE_PAD_X * 2;

    pagesInCol.forEach((page, i) => {
      const y = pagesInCol.length === 1
        ? (LANE_TOP + LANE_BOTTOM) / 2
        : LANE_TOP + gap * i;

      // Jitter X within column so stacked nodes don't collide visually.
      // Deterministic: use slug hash.
      const h = stringHash(page.slug);
      const jitterFrac = ((h % 1000) / 1000 - 0.5) * 0.75; // -0.375..+0.375 of inner width
      const x = col.center + jitterFrac * innerW;

      nodes.push({
        page, x, y,
        r: nodeRadius(page),
        eraKey: col.key,
        col: col.index,
      });
    });
  }

  // Place timeless nodes along the bottom band, spread horizontally.
  if (timeless.length > 0) {
    const usableW2 = W - SIDE_PAD * 2 - 40;
    const gap = timeless.length > 1 ? usableW2 / (timeless.length - 1) : 0;
    timeless.forEach((page, i) => {
      const x = timeless.length === 1
        ? W / 2
        : SIDE_PAD + 20 + gap * i;
      nodes.push({
        page,
        x,
        y: TIMELESS_Y,
        r: nodeRadius(page),
        eraKey: "timeless",
        col: -1,
      });
    });
  }

  return { nodes, eraColumns, columnXs };
}

function nodeRadius(page: WikiPageRecord): number {
  // Slightly larger radius for more-central page types.
  switch (page.type) {
    case "entity":       return 7;
    case "event":        return 6.5;
    case "relationship": return 6;
    case "concept":      return 6;
    case "voice_identity": return 6.5;
    case "timeline":     return 5.5;
    default:             return 6;
  }
}

/* ── Pure helpers ──────────────────────────────────────────────── */

function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function truncateLabel(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function labelForType(t: WikiPageType): string {
  switch (t) {
    case "voice_identity": return "Voice ID";
    case "entity":        return "Entity";
    case "event":         return "Event";
    case "concept":       return "Concept";
    case "relationship":  return "Relationship";
    case "timeline":      return "Timeline";
  }
}
