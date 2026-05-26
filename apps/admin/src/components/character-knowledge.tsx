"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { recomputeKnowledgeLayout } from "@/app/(authenticated)/characters/actions";
import type { LayoutPoint } from "@/lib/kg-layout";

/* ── Types ─────────────────────────────────────────────────────── */

type WikiPageType =
  | "entity"
  | "event"
  | "concept"
  | "relationship"
  | "timeline"
  | "voice_identity";

type PageLite = {
  id: string;
  slug: string;
  type: WikiPageType;
  title: string;
  summary: string | null;
  body: string;
  timeIndex: { era: string; index: number } | null;
  knowsFuture: boolean;
  hasEmbedding: boolean;
};

type EdgeLite = {
  fromPageId: string;
  toPageId: string;
  kind: string;
  strength: number;
};

type Props = {
  characterId: string;
  characterSlug: string;
  pages: PageLite[];
  edges: EdgeLite[];
  layout: LayoutPoint[];
  embeddedCount: number;
  totalCount: number;
  initialFocusSlug: string | null;
  routeBase?: string;
};

/* ── Tokens ────────────────────────────────────────────────────── */

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  panel: "var(--panel)",
  border: "var(--border)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

const TYPE_COLOR: Record<WikiPageType, string> = {
  entity: "#8FD1CB",
  event: "#E879A0",
  concept: "#8B5CF6",
  relationship: "#FACC15",
  timeline: "rgba(255,255,255,0.45)",
  voice_identity: "#FFFFFF",
};

const TYPE_LABEL: Record<WikiPageType, string> = {
  entity: "People & places",
  event: "Events",
  concept: "Concepts",
  relationship: "Relationships",
  timeline: "Timeline",
  voice_identity: "Voice",
};

const ALL_TYPES: WikiPageType[] = [
  "entity",
  "event",
  "concept",
  "relationship",
  "timeline",
  "voice_identity",
];

/* ── Component ─────────────────────────────────────────────────── */

export function CharacterKnowledge({
  characterId, characterSlug, pages, edges, layout, embeddedCount, totalCount, initialFocusSlug,
  routeBase,
}: Props) {
  const router = useRouter();
  const base = routeBase ?? `/characters/${characterSlug}`;
  const [recomputing, startRecompute] = useTransition();
  const [searchQuery, setSearchQuery] = useState("");
  // Build quick lookups.
  const layoutById = useMemo(() => {
    const m = new Map<string, LayoutPoint>();
    for (const p of layout) m.set(p.id, p);
    return m;
  }, [layout]);

  const pageById = useMemo(() => {
    const m = new Map<string, PageLite>();
    for (const p of pages) m.set(p.id, p);
    return m;
  }, [pages]);

  const pageBySlug = useMemo(() => {
    const m = new Map<string, PageLite>();
    for (const p of pages) m.set(p.slug, p);
    return m;
  }, [pages]);

  // Edge degree (how connected each node is) — drives node size.
  const degreeById = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of edges) {
      d.set(e.fromPageId, (d.get(e.fromPageId) ?? 0) + 1);
      d.set(e.toPageId, (d.get(e.toPageId) ?? 0) + 1);
    }
    return d;
  }, [edges]);
  const maxDegree = useMemo(() => {
    let m = 0;
    for (const v of degreeById.values()) if (v > m) m = v;
    return m;
  }, [degreeById]);

  const [enabledTypes, setEnabledTypes] = useState<Set<WikiPageType>>(
    () => new Set(ALL_TYPES),
  );

  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (initialFocusSlug) {
      const p = pages.find((p) => p.slug === initialFocusSlug);
      if (p) return p.id;
    }
    return pages[0]?.id ?? null;
  });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Pan / zoom state, viewBox-based.
  const [view, setView] = useState({ x: -1.4, y: -1.4, w: 2.8, h: 2.8 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; vx: number; vy: number } | null>(null);

  useEffect(() => {
    // Wheel handler must be non-passive to call preventDefault.
    const el = svgRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const svg = svgRef.current!;
      const rect = svg.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width;
      const my = (e.clientY - rect.top) / rect.height;
      setView((v) => {
        const factor = Math.exp(e.deltaY * 0.0015);
        const newW = Math.min(6, Math.max(0.4, v.w * factor));
        const newH = Math.min(6, Math.max(0.4, v.h * factor));
        // Keep the point under the cursor stable.
        const px = v.x + mx * v.w;
        const py = v.y + my * v.h;
        return { x: px - mx * newW, y: py - my * newH, w: newW, h: newH };
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    const target = e.target as SVGElement;
    // Don't start a pan if the user clicked a node.
    if (target.dataset.kgNode) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      vx: view.x,
      vy: view.y,
    };
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragRef.current) return;
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - dragRef.current.startX) / rect.width) * view.w;
    const dy = ((e.clientY - dragRef.current.startY) / rect.height) * view.h;
    setView((v) => ({ ...v, x: dragRef.current!.vx - dx, y: dragRef.current!.vy - dy }));
  }
  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    dragRef.current = null;
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
  }

  function resetView() {
    setView({ x: -1.4, y: -1.4, w: 2.8, h: 2.8 });
  }

  function toggleType(t: WikiPageType) {
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  // Search matches — case-insensitive substring on title or slug.
  const query = searchQuery.trim().toLowerCase();
  const matchIds = useMemo(() => {
    if (!query) return null;
    const ids = new Set<string>();
    for (const p of pages) {
      if (p.title.toLowerCase().includes(query) || p.slug.toLowerCase().includes(query)) {
        ids.add(p.id);
      }
    }
    return ids;
  }, [query, pages]);

  // Visible nodes & edges (post type-filter).
  const visiblePages = useMemo(
    () => pages.filter((p) => enabledTypes.has(p.type)),
    [pages, enabledTypes],
  );
  const visibleIds = useMemo(() => new Set(visiblePages.map((p) => p.id)), [visiblePages]);
  const visibleEdges = useMemo(
    () => edges.filter((e) => visibleIds.has(e.fromPageId) && visibleIds.has(e.toPageId)),
    [edges, visibleIds],
  );

  // Edges of the hovered/selected node — emphasized.
  const focusedId = hoveredId ?? selectedId;
  const focusedEdgeKey = useMemo(() => {
    if (!focusedId) return new Set<string>();
    const keys = new Set<string>();
    for (const e of edges) {
      if (e.fromPageId === focusedId || e.toPageId === focusedId) {
        keys.add(`${e.fromPageId}|${e.toPageId}|${e.kind}`);
      }
    }
    return keys;
  }, [focusedId, edges]);

  const selected = selectedId ? pageById.get(selectedId) ?? null : null;
  const selectedEdges = useMemo(() => {
    if (!selectedId) return [];
    return edges.filter((e) => e.fromPageId === selectedId || e.toPageId === selectedId);
  }, [selectedId, edges]);

  return (
    <div style={{ display: "flex", gap: "var(--space-16)", height: "100%", minHeight: 600 }}>
      {/* ── Graph canvas ──────────────────────────────────────────── */}
      <div style={{
        flex: 1, minWidth: 0, position: "relative", overflow: "hidden",
        background: T.panel, border: `1px solid ${T.border}`, borderRadius: "var(--radius-2xl)",
      }}>
        <div style={{
          position: "absolute", top: 14, left: 14, right: 14, zIndex: 2,
          display: "flex", flexDirection: "column", gap: "var(--space-8)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: "var(--space-8)",
              padding: "6px 12px", borderRadius: "var(--radius-pill)",
              background: "rgba(12,14,20,0.65)", backdropFilter: "blur(8px)",
              border: `1px solid ${T.border}`,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#8FD1CB", boxShadow: "0 0 8px 0 rgba(140,231,210,0.55)" }} />
              <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Knowledge graph
              </span>
              <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.muted }}>
                {totalCount} nodes · {edges.length} edges · {embeddedCount}/{totalCount} embedded
              </span>
            </div>

            <div style={{ flex: 1 }} />

            <div style={{
              display: "flex", alignItems: "center", gap: "var(--space-6)",
              padding: "4px 10px 4px 12px", borderRadius: "var(--radius-pill)",
              background: "rgba(12,14,20,0.65)", backdropFilter: "blur(8px)",
              border: `1px solid ${query ? "#8FD1CB" : T.border}`,
              minWidth: 220,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={query ? "#8FD1CB" : T.muted as string} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search…"
                style={{
                  flex: 1, minWidth: 0,
                  background: "transparent", border: "none", outline: "none",
                  color: T.fg, fontFamily: T.fontBody, fontSize: "var(--font-size-sm)",
                }}
              />
              {query && (
                <>
                  <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: T.muted }}>
                    {matchIds?.size ?? 0}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    style={{
                      padding: 0, background: "transparent", border: "none",
                      color: T.muted, cursor: "pointer", fontFamily: T.fontBody, fontSize: "var(--font-size-lg)", lineHeight: 1,
                    }}
                    aria-label="Clear search"
                  >×</button>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={resetView}
              style={{
                padding: "5px 10px", borderRadius: "var(--radius-pill)",
                border: `1px solid ${T.border}`, background: "rgba(12,14,20,0.65)",
                color: T.muted, fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", cursor: "pointer",
                backdropFilter: "blur(8px)",
              }}
              title="Reset view"
            >
              Reset
            </button>
            <button
              type="button"
              disabled={recomputing}
              onClick={() => {
                startRecompute(async () => {
                  await recomputeKnowledgeLayout(characterId);
                  router.refresh();
                });
              }}
              style={{
                padding: "5px 10px", borderRadius: "var(--radius-pill)",
                border: `1px solid ${T.border}`, background: "rgba(12,14,20,0.65)",
                color: recomputing ? T.muted : T.fg,
                fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", cursor: recomputing ? "not-allowed" : "pointer",
                backdropFilter: "blur(8px)",
                opacity: recomputing ? 0.6 : 1,
              }}
              title="Recompute the 2D layout from page embeddings"
            >
              {recomputing ? "Recomputing…" : "Recompute"}
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", flexWrap: "wrap" }}>
            {ALL_TYPES.map((t) => {
              const on = enabledTypes.has(t);
              const color = TYPE_COLOR[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "var(--space-6)",
                    padding: "4px 10px", borderRadius: "var(--radius-pill)",
                    border: `1px solid ${on ? color : T.border}`,
                    background: on ? `${color}1A` : "rgba(12,14,20,0.65)",
                    color: on ? T.fg : T.muted,
                    fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", cursor: "pointer",
                    backdropFilter: "blur(8px)",
                  }}
                  aria-pressed={on}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                  {TYPE_LABEL[t]}
                </button>
              );
            })}
          </div>
        </div>

        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          width="100%"
          height="100%"
          style={{ display: "block", touchAction: "none", cursor: dragRef.current ? "grabbing" : "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* Soft ambient wash centered on the data cluster */}
          <defs>
            <radialGradient id="kg-wash" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#8FD1CB" stopOpacity="0.08" />
              <stop offset="80%" stopColor="#8FD1CB" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect x={-2} y={-2} width={4} height={4} fill="url(#kg-wash)" />

          {/* Edges */}
          {visibleEdges.map((e) => {
            const a = layoutById.get(e.fromPageId);
            const b = layoutById.get(e.toPageId);
            if (!a || !b) return null;
            const key = `${e.fromPageId}|${e.toPageId}|${e.kind}`;
            const emphasized = focusedEdgeKey.has(key);
            const dimmed = focusedId !== null && !emphasized;
            return (
              <line
                key={key}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={emphasized ? "rgba(140,231,210,0.85)" : "rgba(140,231,210,0.22)"}
                strokeWidth={emphasized ? 1.4 : 0.7}
                strokeOpacity={dimmed ? 0.25 : 1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          {/* Nodes */}
          {visiblePages.map((p) => {
            const pos = layoutById.get(p.id);
            if (!pos) return null;
            const degree = degreeById.get(p.id) ?? 0;
            const r = nodeRadius(degree, maxDegree, p.type);
            const isSelected = p.id === selectedId;
            const isHovered = p.id === hoveredId;
            const isFocused = isSelected || isHovered;
            const searchActive = matchIds !== null;
            const isMatch = searchActive && matchIds!.has(p.id);
            const isDimmed = (focusedId !== null && !isFocused
                && !edgesTouch(edges, focusedId, p.id))
              || (searchActive && !isMatch);
            const color = TYPE_COLOR[p.type];
            return (
              <g key={p.id} style={{ cursor: "pointer", transformBox: "fill-box", transformOrigin: "center" }} className={isMatch ? "kg-pulse" : undefined}>
                <circle
                  data-kg-node="1"
                  cx={pos.x}
                  cy={pos.y}
                  r={r}
                  fill={color}
                  fillOpacity={isDimmed ? 0.18 : 1}
                  stroke={isSelected ? "#FFFFFF" : isMatch ? "#8FD1CB" : isHovered ? color : "transparent"}
                  strokeWidth={isSelected ? 2 : isMatch ? 1.5 : isHovered ? 1.5 : 0}
                  vectorEffect="non-scaling-stroke"
                  style={isMatch ? { filter: `drop-shadow(0 0 ${r * 2}px ${color})` } : undefined}
                  onClick={() => setSelectedId(p.id)}
                  onMouseEnter={() => setHoveredId(p.id)}
                  onMouseLeave={() => setHoveredId((id) => (id === p.id ? null : id))}
                >
                  <title>{p.title}</title>
                </circle>
                {(isFocused || isMatch || view.w < 1.2) && (
                  <text
                    x={pos.x}
                    y={pos.y - r * 1.6}
                    fill={isDimmed ? T.muted as string : T.fg as string}
                    fontSize={view.w * 0.018}
                    fontFamily={T.fontBody}
                    fontWeight={500}
                    textAnchor="middle"
                    style={{ pointerEvents: "none" }}
                  >
                    {p.title}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        <style>{`
          @keyframes kg-pulse-anim {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.85; transform: scale(1.18); }
          }
          .kg-pulse {
            animation: kg-pulse-anim 1.6s ease-in-out infinite;
            transform-origin: center;
            transform-box: fill-box;
          }
        `}</style>

        {/* Help overlay */}
        <div style={{
          position: "absolute", bottom: 12, left: 14, zIndex: 2,
          padding: "5px 10px", borderRadius: "var(--radius-pill)",
          background: "rgba(12,14,20,0.65)", backdropFilter: "blur(8px)",
          border: `1px solid ${T.border}`,
          fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: T.muted, letterSpacing: "0.08em",
        }}>
          drag · scroll to zoom · click a node
        </div>

        {totalCount === 0 && <EmptyOverlay routeBase={base} />}
        {totalCount > 0 && embeddedCount === 0 && <NoEmbeddingsOverlay />}
      </div>

      {/* ── Detail panel ──────────────────────────────────────────── */}
      <DetailPanel
        page={selected}
        routeBase={base}
        edges={selectedEdges}
        pageBySlug={pageBySlug}
        pageById={pageById}
        onNavigate={(id) => setSelectedId(id)}
      />
    </div>
  );
}

/* ── Detail panel ──────────────────────────────────────────────── */

function DetailPanel({
  page, routeBase, edges, pageById, pageBySlug, onNavigate,
}: {
  page: PageLite | null;
  routeBase: string;
  edges: EdgeLite[];
  pageById: Map<string, PageLite>;
  pageBySlug: Map<string, PageLite>;
  onNavigate: (id: string) => void;
}) {
  if (!page) {
    return (
      <div style={detailPanelStyle}>
        <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted, lineHeight: "18px" }}>
          Select a node to inspect.
        </span>
      </div>
    );
  }

  const color = TYPE_COLOR[page.type];
  const bodyPreview = page.body.length > 480 ? page.body.slice(0, 480) + "…" : page.body;

  return (
    <div style={detailPanelStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <span style={{
          fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          {page.type.replace("_", " ")}
        </span>
        {page.timeIndex && (
          <span style={{
            padding: "1px 7px", borderRadius: "var(--radius-xs)",
            background: "rgba(255,255,255,0.05)",
            fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: T.muted, letterSpacing: "0.06em",
          }}>
            {page.timeIndex.era}
          </span>
        )}
        {page.knowsFuture && (
          <span style={{
            padding: "1px 7px", borderRadius: "var(--radius-xs)",
            background: "rgba(168,140,255,0.12)",
            fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: "#8B5CF6",
          }}>
            future
          </span>
        )}
      </div>

      <div>
        <h3 style={{
          margin: 0, fontFamily: T.fontHeading, fontSize: 20, fontWeight: 700, color: T.fg, lineHeight: "24px",
        }}>
          {page.title}
        </h3>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted }}>
          {page.slug}
        </span>
      </div>

      {page.summary && (
        <p style={{
          margin: 0, fontFamily: T.fontBody, fontSize: "var(--font-size-md)", lineHeight: "19px",
          color: "rgba(255,255,255,0.78)",
        }}>
          {page.summary}
        </p>
      )}

      {bodyPreview && (
        <pre style={{
          margin: 0, fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", lineHeight: "17px",
          color: "rgba(255,255,255,0.62)",
          whiteSpace: "pre-wrap", wordBreak: "break-word",
          maxHeight: 220, overflow: "auto",
          padding: "10px 12px",
          background: "rgba(255,255,255,0.03)", borderRadius: "var(--radius-md)",
          border: `1px solid ${T.border}`,
        }}>
          {bodyPreview}
        </pre>
      )}

      <div style={{
        display: "flex", flexDirection: "column", gap: "var(--space-6)",
        paddingTop: "var(--space-12)", borderTop: `1px solid ${T.border}`,
      }}>
        <span style={{
          fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          Connections · {edges.length}
        </span>
        {edges.length === 0 ? (
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted }}>
            No edges yet.
          </span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", maxHeight: 220, overflow: "auto" }}>
            {edges.map((e, i) => {
              const otherId = e.fromPageId === page.id ? e.toPageId : e.fromPageId;
              const other = pageById.get(otherId);
              if (!other) return null;
              const direction = e.fromPageId === page.id ? "→" : "←";
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onNavigate(other.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: "var(--space-8)",
                    padding: "5px 8px", borderRadius: "var(--radius-sm)",
                    border: "1px solid transparent",
                    background: "transparent",
                    color: T.fg,
                    fontFamily: T.fontBody, fontSize: "var(--font-size-base)",
                    cursor: "pointer", textAlign: "left",
                  }}
                  onMouseEnter={(ev) => (ev.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                  onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: TYPE_COLOR[other.type], flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {other.title}
                  </span>
                  <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: T.muted }}>
                    {direction} {e.kind.replace("_", " ")}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "var(--space-8)", paddingTop: "var(--space-10)", borderTop: `1px solid ${T.border}` }}>
        <Link
          href={`${routeBase}/wiki?page=${page.slug}`}
          style={{
            flex: 1, textAlign: "center",
            padding: "6px 12px", borderRadius: "var(--radius-md)",
            border: `1px solid ${T.border}`, background: "transparent",
            color: T.fg, textDecoration: "none",
            fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontWeight: 500,
          }}
        >
          Open in wiki
        </Link>
        <Link
          href={`${routeBase}/wiki/${page.slug}?edit=1`}
          style={{
            flex: 1, textAlign: "center",
            padding: "6px 12px", borderRadius: "var(--radius-md)",
            border: "none", background: "#8FD1CB",
            color: "#0C0E14", textDecoration: "none",
            fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontWeight: 600,
          }}
        >
          Edit page
        </Link>
      </div>
    </div>
  );
}

/* ── Empty / loading states ────────────────────────────────────── */

function EmptyOverlay({ routeBase }: { routeBase: string }) {
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 3,
      display: "flex", alignItems: "center", justifyContent: "center",
      pointerEvents: "none",
    }}>
      <div style={{
        display: "flex", flexDirection: "column", gap: "var(--space-10)", alignItems: "center",
        padding: "20px 24px", borderRadius: "var(--radius-xl)",
        background: "rgba(12,14,20,0.85)", backdropFilter: "blur(8px)",
        border: `1px solid ${T.border}`,
        pointerEvents: "auto",
      }}>
        <span style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-xl)", fontWeight: 600, color: T.fg }}>
          No knowledge yet
        </span>
        <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted, textAlign: "center", maxWidth: 280 }}>
          Ingest a source to grow the graph. Once pages exist, they appear here laid out in semantic space.
        </span>
        <Link href={`${routeBase}/ingestion`} style={{
          padding: "6px 14px", borderRadius: "var(--radius-md)", background: "#8FD1CB",
          color: "#0C0E14", textDecoration: "none",
          fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontWeight: 600,
        }}>
          Open ingestion
        </Link>
      </div>
    </div>
  );
}

function NoEmbeddingsOverlay() {
  return (
    <div style={{
      position: "absolute", bottom: 14, right: 14, zIndex: 3,
      padding: "8px 12px", borderRadius: "var(--radius-md)",
      background: "rgba(250,204,21,0.08)", border: "1px solid rgba(250,204,21,0.25)",
      backdropFilter: "blur(8px)",
    }}>
      <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: "#FACC15" }}>
        Pages have no embeddings — layout is approximate. Re-ingest to populate.
      </span>
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */

const detailPanelStyle: React.CSSProperties = {
  width: 380, flexShrink: 0,
  display: "flex", flexDirection: "column", gap: "var(--space-14)",
  padding: "16px 18px",
  background: T.panel, border: `1px solid ${T.border}`, borderRadius: "var(--radius-2xl)",
  overflow: "auto",
};

function nodeRadius(degree: number, maxDegree: number, type: WikiPageType): number {
  // voice_identity is the anchor — always slightly larger.
  if (type === "voice_identity") return 0.028;
  const base = 0.012;
  const scaled = maxDegree > 0 ? (degree / maxDegree) * 0.018 : 0;
  return base + scaled;
}

function edgesTouch(edges: EdgeLite[], a: string, b: string): boolean {
  for (const e of edges) {
    if ((e.fromPageId === a && e.toPageId === b) || (e.fromPageId === b && e.toPageId === a)) return true;
  }
  return false;
}
