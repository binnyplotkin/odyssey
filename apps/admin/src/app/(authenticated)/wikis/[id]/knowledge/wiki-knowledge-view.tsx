"use client";

import Link from "next/link";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { updateWikiPageContent } from "../../actions";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  useReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LayoutPoint } from "@/lib/kg-layout";
import type {
  Contradiction,
  EdgeKind,
  Perspective,
  WikiPageType,
} from "@odyssey/db";

/* ── Tokens (phosphor / terminal) ──────────────────────────────── */

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const DISPLAY = '"Space Grotesk", system-ui, sans-serif';
const BODY = '"Geist", "Inter", system-ui, sans-serif';

const FG = "rgba(255, 255, 255, 0.95)";
const TEXT_PRIMARY = "rgba(255, 255, 255, 0.88)";
const TEXT_SECONDARY = "rgba(255, 255, 255, 0.7)";
const TEXT_MUTED = "rgba(255, 255, 255, 0.55)";
const TEXT_FADED = "rgba(255, 255, 255, 0.4)";
const TEXT_GHOST = "rgba(255, 255, 255, 0.32)";
const TEXT_QUIET = "rgba(255, 255, 255, 0.2)";

const GROUND = "#050505";
const PANEL_BG = "#0A0A0A";
const BORDER = "rgba(255, 255, 255, 0.1)";
const DIVIDER = "rgba(255, 255, 255, 0.06)";
const INPUT_BG = "rgba(255, 255, 255, 0.02)";

const ACCENT = "#8FD1CB";
const ACCENT_SOFT = "rgba(140, 231, 210, 0.06)";
const ACCENT_RING = "rgba(140, 231, 210, 0.3)";

const SECONDARY = "#B79EFF";
const VOICE_ACCENT = "#F472B6";
const BONE = "rgba(255, 255, 255, 0.7)";

const DANGER = "#f87171";
const DANGER_SOFT = "rgba(248, 113, 113, 0.06)";
const DANGER_RING = "rgba(248, 113, 113, 0.36)";

/** Scales normalized layout coords ([-1, 1]) up to a pixel canvas range. */
const LAYOUT_SCALE = 600;

/** Six-color type palette — one hue per page type so the graph reads as
 *  categorical at a glance. The mint accent is reserved for `entity`; the
 *  rest follow the original network-viz convention. */
const TYPE_COLOR: Record<WikiPageType, string> = {
  entity: "#8FD1CB",
  event: "#60A5FA",
  concept: "#A78BFA",
  relationship: "#FACC15",
  timeline: "#2DD4BF",
  voice_identity: "#F472B6",
};

const TYPE_PLURAL: Record<WikiPageType, string> = {
  entity: "entities",
  event: "events",
  concept: "concepts",
  relationship: "relations",
  timeline: "timeline",
  voice_identity: "voice",
};

const TYPE_ORDER: WikiPageType[] = [
  "entity",
  "event",
  "concept",
  "relationship",
  "timeline",
  "voice_identity",
];

/* ── Types ─────────────────────────────────────────────────────── */

export type WikiKnowledgeSourceRef = {
  refId: string;
  sourceId: string;
  title: string;
  kind: string;
  passage: string | null;
  quote: string | null;
  relevanceNote: string | null;
};

export type WikiKnowledgePage = {
  id: string;
  slug: string;
  type: WikiPageType;
  title: string;
  summary: string | null;
  body: string;
  frontmatter: Record<string, unknown>;
  confidence: number;
  timeIndex: { era: string; index: number } | null;
  perspective: Perspective;
  contradictions: Contradiction[];
  knowsFuture: boolean;
  sources: WikiKnowledgeSourceRef[];
  updatedAt: string;
};

export type WikiKnowledgeEdge = {
  fromPageId: string;
  toPageId: string;
  kind?: EdgeKind;
  strength: number;
};

export type WikiKnowledgeViewProps = {
  wikiId: string;
  pages: WikiKnowledgePage[];
  edges: WikiKnowledgeEdge[];
  layout: LayoutPoint[];
  embeddedCount: number;
  totalCount: number;
  initialFocusSlug: string | null;
  routeBase: string;
};

type WikiNodeData = {
  page: WikiKnowledgePage;
  color: string;
  radius: number;
  showLabel: boolean;
  dimmed: boolean;
  selected: boolean;
  recent: boolean;
  activity: number;
};

/* ── Component ─────────────────────────────────────────────────── */

export function WikiKnowledgeView(props: WikiKnowledgeViewProps) {
  return (
    <ReactFlowProvider>
      <WikiKnowledgeCanvas {...props} />
    </ReactFlowProvider>
  );
}

function WikiKnowledgeCanvas({
  wikiId,
  pages,
  edges,
  layout,
  embeddedCount,
  totalCount,
  initialFocusSlug,
  routeBase,
}: WikiKnowledgeViewProps) {
  const [query, setQuery] = useState("");
  const [hiddenTypes, setHiddenTypes] = useState<Set<WikiPageType>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (!initialFocusSlug) return null;
    return pages.find((p) => p.slug === initialFocusSlug)?.id ?? null;
  });
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
  }, []);

  const pageById = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);
  const animatedLayout = useAnimatedLayout(layout, 450);

  const layoutById = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const p of animatedLayout) m.set(p.id, p);
    return m;
  }, [animatedLayout]);

  const degreeById = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) {
      m.set(e.fromPageId, (m.get(e.fromPageId) ?? 0) + 1);
      m.set(e.toPageId, (m.get(e.toPageId) ?? 0) + 1);
    }
    return m;
  }, [edges]);

  const maxDegree = useMemo(
    () => Math.max(1, ...Array.from(degreeById.values())),
    [degreeById],
  );

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of pages) c[p.type] = (c[p.type] ?? 0) + 1;
    return c;
  }, [pages]);

  const recentNodeIds = useMemo(() => {
    if (!nowMs) return new Set<string>();
    const oneDay = 24 * 60 * 60 * 1000;
    const recent = pages
      .map((p) => ({ id: p.id, updated: Date.parse(p.updatedAt) }))
      .filter((p) => Number.isFinite(p.updated) && nowMs - p.updated < oneDay)
      .sort((a, b) => b.updated - a.updated)
      .slice(0, 6)
      .map((p) => p.id);
    return new Set(recent);
  }, [pages, nowMs]);

  const q = query.trim().toLowerCase();
  function matchesQuery(p: WikiKnowledgePage): boolean {
    if (!q) return true;
    return (
      p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)
    );
  }

  function toggleType(t: WikiPageType) {
    const next = new Set(hiddenTypes);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setHiddenTypes(next);
  }

  /* Build React Flow nodes. */
  const flowNodes = useMemo<FlowNode<WikiNodeData>[]>(() => {
    const out: FlowNode<WikiNodeData>[] = [];
    for (const p of pages) {
      const pos = layoutById.get(p.id);
      if (!pos) continue;
      const deg = degreeById.get(p.id) ?? 0;
      const radius = Math.min(11, 4 + Math.sqrt(deg) * 1.2);
      const dimmed = hiddenTypes.has(p.type) || !matchesQuery(p);
      const isSel = p.id === selectedId;
      const isRecent = recentNodeIds.has(p.id);
      const activity = Math.min(1, deg / maxDegree + (isRecent ? 0.18 : 0));
      out.push({
        id: p.id,
        type: "wiki",
        position: { x: pos.x * LAYOUT_SCALE, y: pos.y * LAYOUT_SCALE },
        data: {
          page: p,
          color: TYPE_COLOR[p.type],
          radius,
          showLabel: !dimmed && (deg >= 3 || isSel),
          dimmed,
          selected: isSel,
          recent: isRecent,
          activity,
        },
        draggable: false,
        selectable: true,
      });
    }
    return out;
  }, [
    pages,
    layoutById,
    degreeById,
    maxDegree,
    hiddenTypes,
    selectedId,
    q,
    recentNodeIds,
  ]);

  /* Build React Flow edges. */
  const flowEdges = useMemo<FlowEdge[]>(() => {
    return edges.map((e, i) => {
      const pa = pageById.get(e.fromPageId);
      const pb = pageById.get(e.toPageId);
      const hide =
        !pa ||
        !pb ||
        hiddenTypes.has(pa.type) ||
        hiddenTypes.has(pb.type) ||
        (q.length > 0 && !matchesQuery(pa) && !matchesQuery(pb));
      const isSel =
        selectedId !== null &&
        (e.fromPageId === selectedId || e.toPageId === selectedId);
      const isContradiction = e.kind === "contradicts";
      const edgeColor = isContradiction ? DANGER : ACCENT;
      const isStrong = e.strength >= 0.78;
      return {
        id: `${e.fromPageId}->${e.toPageId}-${i}`,
        source: e.fromPageId,
        target: e.toPageId,
        type: "straight",
        animated: isSel || isStrong,
        className: isSel
          ? "knowledge-edge-active"
          : isStrong
            ? "knowledge-edge-live"
            : undefined,
        hidden: hide,
        selectable: false,
        focusable: false,
        interactionWidth: 0,
        style: {
          stroke: isSel
            ? edgeColor
            : isContradiction
              ? "rgba(248, 113, 113, 0.45)"
              : isStrong
                ? "rgba(140, 231, 210, 0.42)"
                : "rgba(255, 255, 255, 0.14)",
          strokeWidth: isSel ? 1.5 : isStrong ? 1.1 : 0.75,
          opacity: isSel ? 0.92 : isContradiction ? 0.55 : isStrong ? 0.7 : 0.5,
          strokeDasharray: isSel
            ? "5 8"
            : isContradiction
              ? "3 7"
              : isStrong
                ? "1 10"
                : undefined,
          pointerEvents: "none",
        },
      } satisfies FlowEdge;
    });
  }, [edges, pageById, hiddenTypes, selectedId, q]);

  const selected = selectedId ? (pageById.get(selectedId) ?? null) : null;
  const neighbours = useMemo(() => {
    if (!selected) return [];
    const best = new Map<string, number>();
    for (const e of edges) {
      let otherId: string | null = null;
      if (e.fromPageId === selected.id) otherId = e.toPageId;
      else if (e.toPageId === selected.id) otherId = e.fromPageId;
      if (!otherId) continue;
      const prev = best.get(otherId);
      if (prev === undefined || e.strength > prev) {
        best.set(otherId, e.strength);
      }
    }
    const out: Array<{ page: WikiKnowledgePage; strength: number }> = [];
    for (const [id, strength] of best) {
      const page = pageById.get(id);
      if (page) out.push({ page, strength });
    }
    out.sort((a, b) => b.strength - a.strength);
    return out;
  }, [selected, edges, pageById]);

  // Esc clears the selection
  useEffect(() => {
    if (!selectedId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  return (
    <div
      style={{
        position: "relative",
        height: "calc(100vh - 67px)",
        overflow: "hidden",
        background: GROUND,
      }}
    >
      <KnowledgeGraphStyles />
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        selectNodesOnDrag={false}
        onNodeClick={(_e, n) => setSelectedId(n.id)}
        onPaneClick={() => setSelectedId(null)}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.4, maxZoom: 1.5 }}
        minZoom={0.3}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
      >
        <Background
          variant={BackgroundVariant.Lines}
          gap={40}
          size={1}
          color="rgba(255, 255, 255, 0.025)"
        />
      </ReactFlow>

      <FilterPanel
        query={query}
        setQuery={setQuery}
        typeCounts={typeCounts}
        hiddenTypes={hiddenTypes}
        toggleType={toggleType}
        totalNodes={pages.length}
        embeddedCount={embeddedCount}
        totalCount={totalCount}
      />

      {selected && (
        <NodeDetailPanel
          wikiId={wikiId}
          page={selected}
          neighbours={neighbours}
          pageById={pageById}
          routeBase={routeBase}
          onClose={() => setSelectedId(null)}
        />
      )}

      <BottomToolbar />
    </div>
  );
}

/* ── Styles ───────────────────────────────────────────────────── */

function KnowledgeGraphStyles() {
  return (
    <style>{`
      @keyframes knowledgeEdgeCurrent {
        from { stroke-dashoffset: 18; }
        to { stroke-dashoffset: 0; }
      }
      /* Subtler than the original 0.82 → 1.24 sweep — keeps the "alive"
         feel without competing with the selection signal at 14+ nodes. */
      @keyframes knowledgeNodePulse {
        0%, 100% { transform: scale(0.95); }
        50% { transform: scale(1.10); }
      }
      .knowledge-edge-active .react-flow__edge-path {
        animation: knowledgeEdgeCurrent 1.4s linear infinite;
      }
      .knowledge-edge-live .react-flow__edge-path {
        animation: knowledgeEdgeCurrent 3.2s linear infinite;
      }
      .knowledge-node-selected,
      .knowledge-node-recent,
      .knowledge-node-active {
        animation: knowledgeNodePulse 2.4s ease-in-out infinite;
      }
      .react-flow__pane {
        cursor: grab;
      }
      .react-flow__pane.dragging {
        cursor: grabbing;
      }
    `}</style>
  );
}

/* ── Custom node ─────────────────────────────────────────────── */

const NODE_TYPES: NodeTypes = {
  wiki: WikiGraphNode,
};

function WikiGraphNode({ data }: NodeProps<FlowNode<WikiNodeData>>) {
  const { color, radius, showLabel, dimmed, selected, recent, activity, page } =
    data;
  const diameter = radius * 2;
  const active = !selected && !recent && activity >= 0.62;
  return (
    <div
      style={{
        position: "relative",
        width: diameter,
        height: diameter,
        transform: "translate(-50%, -50%)",
        opacity: dimmed ? 0.18 : 1,
        pointerEvents: dimmed ? "none" : "auto",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          left: "50%",
          top: "50%",
          width: 1,
          height: 1,
          background: "transparent",
          border: "none",
          opacity: 0,
          pointerEvents: "none",
        }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          left: "50%",
          top: "50%",
          width: 1,
          height: 1,
          background: "transparent",
          border: "none",
          opacity: 0,
          pointerEvents: "none",
        }}
      />
      {/* Square dot — barely-rounded for crispness. The pulse class
          applies a 0.95 → 1.10 scale loop, so the dot "breathes" without
          the old 0.82 → 1.24 jumpiness. */}
      <div
        className={
          selected
            ? "knowledge-node-selected"
            : recent
              ? "knowledge-node-recent"
              : active
                ? "knowledge-node-active"
                : undefined
        }
        style={{
          position: "absolute",
          inset: selected ? "8%" : recent || active ? "14%" : "20%",
          borderRadius: 1,
          background: color,
          boxShadow: selected
            ? `0 0 16px ${color}66`
            : recent
              ? `0 0 11px ${color}44`
              : `0 0 ${8 + Math.round(activity * 8)}px ${color}${activity > 0.62 ? "3D" : "22"}`,
          opacity:
            page.confidence < 0.5
              ? 0.52
              : selected || recent || active
                ? 1
                : 0.66 + activity * 0.28,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "transparent",
        }}
      />
      {showLabel && (
        <div
          style={{
            position: "absolute",
            left: "100%",
            top: "50%",
            transform: "translateY(-50%)",
            marginLeft: "var(--space-6)",
            whiteSpace: "nowrap",
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            fontWeight: selected ? 500 : 400,
            letterSpacing: selected ? "0.05em" : "0.02em",
            color: selected ? FG : TEXT_SECONDARY,
            pointerEvents: "none",
          }}
        >
          {page.title}
        </div>
      )}
    </div>
  );
}

/* ── Filter rail (left) ──────────────────────────────────────── */

function FilterPanel({
  query,
  setQuery,
  typeCounts,
  hiddenTypes,
  toggleType,
  totalNodes,
  embeddedCount,
  totalCount,
}: {
  query: string;
  setQuery: (s: string) => void;
  typeCounts: Record<string, number>;
  hiddenTypes: Set<WikiPageType>;
  toggleType: (t: WikiPageType) => void;
  totalNodes: number;
  embeddedCount: number;
  totalCount: number;
}) {
  const visible = totalNodes - TYPE_ORDER.reduce(
    (acc, t) => acc + (hiddenTypes.has(t) ? typeCounts[t] ?? 0 : 0),
    0,
  );
  const embedPct =
    totalCount === 0 ? 0 : Math.round((embeddedCount / totalCount) * 100);

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        width: 288,
        display: "flex",
        flexDirection: "column",
        background: PANEL_BG,
        border: `1px solid ${BORDER}`,
        zIndex: 5,
        maxHeight: "calc(100vh - 100px)",
        overflow: "hidden auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-12)",
          padding: "14px 16px",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: ACCENT,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            color: FG,
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            fontWeight: 500,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Knowledge
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ color: TEXT_FADED, fontFamily: MONO, fontSize: "var(--font-size-xs)" }}>
          {visible} / {totalNodes}
        </span>
      </div>

      {/* Search */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-10)",
          padding: "0 14px",
          height: 38,
          borderBottom: `1px solid ${DIVIDER}`,
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 13 13"
          fill="none"
          style={{ flexShrink: 0 }}
        >
          <circle cx="5.5" cy="5.5" r="3.5" stroke={TEXT_MUTED} strokeWidth="1" />
          <line
            x1="8.5"
            y1="8.5"
            x2="11.5"
            y2="11.5"
            stroke={TEXT_MUTED}
            strokeWidth="1"
            strokeLinecap="square"
          />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the graph…"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: FG,
            fontFamily: MONO,
            fontSize: "var(--font-size-base)",
          }}
        />
        <span style={{ color: TEXT_GHOST, fontFamily: MONO, fontSize: "var(--font-size-xs)" }}>
          ⌘F
        </span>
      </div>

      {/* Types */}
      <RailSection label="Types" trailing={`${TYPE_ORDER.length}`}>
        {TYPE_ORDER.map((t) => (
          <TypeRow
            key={t}
            type={t}
            count={typeCounts[t] ?? 0}
            hidden={hiddenTypes.has(t)}
            onToggle={() => toggleType(t)}
          />
        ))}
      </RailSection>

      {/* Embedding status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-10)",
          padding: "12px 16px",
          borderTop: `1px solid ${BORDER}`,
          background: embedPct === 100 ? ACCENT_SOFT : "transparent",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: embedPct === 100 ? ACCENT : TEXT_MUTED,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            flex: 1,
            color: TEXT_SECONDARY,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {embeddedCount} / {totalCount} embedded
        </span>
        <span style={{ color: TEXT_GHOST, fontFamily: MONO, fontSize: "var(--font-size-xs)" }}>
          {embedPct}%
        </span>
      </div>
    </div>
  );
}

function RailSection({
  label,
  trailing,
  children,
}: {
  label: string;
  trailing?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-10)",
          padding: "16px 16px 8px 16px",
          color: TEXT_FADED,
          fontFamily: MONO,
          fontSize: "var(--font-size-xs)",
          fontWeight: 500,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        <span>{label}</span>
        <span style={{ flex: 1, height: 1, background: DIVIDER }} />
        {trailing && <span style={{ color: TEXT_GHOST }}>{trailing}</span>}
      </div>
      {children}
    </div>
  );
}

function TypeRow({
  type,
  count,
  hidden,
  onToggle,
}: {
  type: WikiPageType;
  count: number;
  hidden: boolean;
  onToggle: () => void;
}) {
  const color = TYPE_COLOR[type];
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-10)",
        height: 36,
        padding: "0 16px",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
        opacity: hidden ? 0.5 : 1,
        transition: "opacity 150ms",
      }}
    >
      {hidden ? (
        <span
          style={{
            width: 8,
            height: 8,
            border: `1px solid ${TEXT_FADED}`,
            flexShrink: 0,
          }}
        />
      ) : (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: color,
            flexShrink: 0,
          }}
        />
      )}
      <span
        style={{
          flex: 1,
          color: hidden ? TEXT_MUTED : TEXT_PRIMARY,
          fontFamily: BODY,
          fontSize: "var(--font-size-base)",
          textTransform: "capitalize",
          textDecoration: hidden ? "line-through" : "none",
          textDecorationColor: TEXT_GHOST,
        }}
      >
        {type === "voice_identity" ? "Voice identity" : TYPE_PLURAL[type]}
      </span>
      <span
        style={{
          color: TEXT_MUTED,
          fontFamily: MONO,
          fontSize: "var(--font-size-xs)",
        }}
      >
        {pad2(count)}
      </span>
      <span
        style={{
          color: hidden ? TEXT_GHOST : TEXT_SECONDARY,
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
          width: 14,
          textAlign: "center",
        }}
      >
        {hidden ? "○" : "●"}
      </span>
    </button>
  );
}

/* ── Bottom toolbar ──────────────────────────────────────────── */

function BottomToolbar() {
  const flow = useReactFlow();
  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: 16,
        width: "fit-content",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-8)",
        padding: "0 10px",
        height: 36,
        background: PANEL_BG,
        border: `1px solid ${BORDER}`,
        zIndex: 4,
      }}
    >
      <ToolbarIconButton label="−" onClick={() => flow.zoomOut?.()} />
      <ToolbarIconButton label="+" onClick={() => flow.zoomIn?.()} />
      <span
        style={{ width: 1, height: 16, background: BORDER, margin: "0 2px" }}
      />
      <ToolbarTextButton
        label="Fit ↻"
        onClick={() => flow.fitView?.({ padding: 0.2 })}
      />
    </div>
  );
}

function ToolbarIconButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        border: `1px solid ${BORDER}`,
        background: "transparent",
        color: TEXT_SECONDARY,
        fontFamily: MONO,
        fontSize: "var(--font-size-md)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function ToolbarTextButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        height: 24,
        padding: "0 12px",
        border: `1px solid ${BORDER}`,
        background: "transparent",
        color: TEXT_SECONDARY,
        fontFamily: MONO,
        fontSize: "var(--font-size-xs)",
        fontWeight: 500,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

/* ── Node detail panel ───────────────────────────────────────── */

type PanelTab = "overview" | "page" | "sources";

function NodeDetailPanel({
  wikiId,
  page,
  neighbours,
  pageById,
  routeBase,
  onClose,
}: {
  wikiId: string;
  page: WikiKnowledgePage;
  neighbours: Array<{ page: WikiKnowledgePage; strength: number }>;
  pageById: Map<string, WikiKnowledgePage>;
  routeBase: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<PanelTab>("overview");

  useEffect(() => {
    setTab("overview");
  }, [page.id]);

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        bottom: 16,
        width: 500,
        display: "flex",
        flexDirection: "column",
        background: PANEL_BG,
        border: `1px solid ${BORDER}`,
        overflow: "hidden",
        zIndex: 5,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-12)",
          padding: "14px 16px",
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: ACCENT,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            color: TEXT_FADED,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            fontWeight: 500,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Node
        </span>
        <span style={{ color: TEXT_QUIET, fontFamily: MONO }}>·</span>
        <span
          style={{
            color: TEXT_SECONDARY,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {page.type === "voice_identity" ? "Voice identity" : page.type}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ color: TEXT_GHOST, fontFamily: MONO, fontSize: "var(--font-size-xs)" }}>
          esc to close
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          style={{
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            background: "transparent",
            color: TEXT_MUTED,
            fontFamily: MONO,
            fontSize: "var(--font-size-lg)",
            cursor: "pointer",
          }}
        >
          ×
        </button>
      </div>

      {/* Identity */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-8)",
          padding: "18px 18px 16px 18px",
          borderBottom: `1px solid ${DIVIDER}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-10)",
            color: TEXT_FADED,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {routeBase}/pages/{page.slug}
          </span>
          <span style={{ flex: 1, height: 1, background: DIVIDER }} />
          <span style={{ color: ACCENT }}>● active</span>
        </div>
        <div
          style={{
            color: FG,
            fontFamily: DISPLAY,
            fontSize: 28,
            fontWeight: 500,
            lineHeight: "34px",
            letterSpacing: "-0.01em",
          }}
        >
          {page.title}
        </div>
        {page.summary && (
          <div
            style={{
              color: TEXT_SECONDARY,
              fontFamily: BODY,
              fontSize: "var(--font-size-md)",
              lineHeight: "20px",
            }}
          >
            {page.summary}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
        }}
      >
        <PanelTabButton
          label="Overview"
          active={tab === "overview"}
          onClick={() => setTab("overview")}
        />
        <PanelTabButton
          label="Page"
          active={tab === "page"}
          onClick={() => setTab("page")}
        />
        <PanelTabButton
          label="Sources"
          active={tab === "sources"}
          onClick={() => setTab("sources")}
          count={page.sources.length}
        />
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {tab === "overview" ? (
          <OverviewView
            page={page}
            neighbours={neighbours}
            pageById={pageById}
            routeBase={routeBase}
          />
        ) : tab === "page" ? (
          <PageView wikiId={wikiId} page={page} />
        ) : (
          <SourcesView sources={page.sources} />
        )}
      </div>

      {/* Actions footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-8)",
          padding: "12px 16px",
          borderTop: `1px solid ${BORDER}`,
          flexShrink: 0,
        }}
      >
        <Link
          href={`${routeBase}/pages/${page.slug}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-6)",
            padding: "7px 12px",
            border: `1px solid rgba(255, 255, 255, 0.16)`,
            color: TEXT_PRIMARY,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            fontWeight: 500,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            textDecoration: "none",
          }}
        >
          OPEN PAGE ↗
        </Link>
        <span style={{ flex: 1 }} />
        <span style={{ color: TEXT_GHOST, fontFamily: MONO, fontSize: "var(--font-size-xs)" }}>
          tab · navigate
        </span>
      </div>
    </div>
  );
}

function PanelTabButton({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-6)",
        height: 36,
        border: "none",
        background: "transparent",
        borderBottom: `1.5px solid ${active ? ACCENT : "transparent"}`,
        marginBottom: -1,
        fontFamily: MONO,
        fontSize: "var(--font-size-sm)",
        fontWeight: active ? 500 : 400,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: active ? ACCENT : TEXT_FADED,
        cursor: "pointer",
        transition: "color 150ms, border-color 150ms",
      }}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span
          style={{
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            color: active ? ACCENT : TEXT_GHOST,
            letterSpacing: "0.04em",
          }}
        >
          · {count}
        </span>
      )}
    </button>
  );
}

/* ── Overview tab ────────────────────────────────────────────── */

function OverviewView({
  page,
  neighbours,
  pageById,
  routeBase,
}: {
  page: WikiKnowledgePage;
  neighbours: Array<{ page: WikiKnowledgePage; strength: number }>;
  pageById: Map<string, WikiKnowledgePage>;
  routeBase: string;
}) {
  const persp = page.perspective ?? {};
  const hasPerspective =
    !!persp.knowsHow ||
    (persp.feels && persp.feels.length > 0) ||
    !!persp.stake;
  const confidencePct = Math.round((page.confidence ?? 0) * 100);
  const flagCount =
    page.contradictions.length + (page.knowsFuture ? 1 : 0);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Meta */}
      <PanelSectionHeader label="Meta" />
      <MetaRow
        label="Confidence"
        value={
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", flex: 1 }}>
            <div
              style={{
                flex: 1,
                height: 4,
                background: "rgba(255, 255, 255, 0.06)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${confidencePct}%`,
                  background:
                    page.confidence < 0.5 ? DANGER : ACCENT,
                }}
              />
            </div>
            <span
              style={{
                color: FG,
                fontFamily: MONO,
                fontSize: "var(--font-size-base)",
                minWidth: 40,
                textAlign: "right",
              }}
            >
              {(page.confidence ?? 0).toFixed(2)}
            </span>
          </div>
        }
      />
      {page.timeIndex && (
        <MetaRow
          label="Time index"
          value={
            <span style={{ color: TEXT_PRIMARY, fontFamily: MONO, fontSize: "var(--font-size-base)" }}>
              {page.timeIndex.era} · t={page.timeIndex.index}
            </span>
          }
        />
      )}
      <MetaRow
        label="Updated"
        value={
          <span style={{ color: TEXT_PRIMARY, fontFamily: MONO, fontSize: "var(--font-size-base)" }}>
            {relative(page.updatedAt)}
          </span>
        }
        last
      />

      {/* Flags */}
      {flagCount > 0 && (
        <>
          <PanelSectionHeader
            label="Flags"
            trailing={pad2(flagCount)}
            withTopBorder
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-6)",
              padding: "0 18px 14px 18px",
            }}
          >
            {page.contradictions.map((c) => {
              const other = pageById.get(c.otherPageId);
              return (
                <FlagBlock
                  key={`${c.otherPageId}-${c.note.slice(0, 16)}`}
                  tone="danger"
                  label="CONTRADICTION"
                  body={
                    <>
                      {other ? (
                        <Link
                          href={`${routeBase}/pages/${other.slug}`}
                          style={{
                            color: "rgba(248, 113, 113, 0.95)",
                            fontFamily: BODY,
                            fontSize: "var(--font-size-base)",
                            textDecoration: "none",
                          }}
                        >
                          {other.title}
                        </Link>
                      ) : (
                        <span
                          style={{
                            color: "rgba(248, 113, 113, 0.7)",
                            fontFamily: MONO,
                            fontSize: "var(--font-size-sm)",
                            fontStyle: "italic",
                          }}
                        >
                          (unknown page)
                        </span>
                      )}
                      <span
                        style={{
                          color: "rgba(248, 113, 113, 0.7)",
                          fontFamily: BODY,
                          fontSize: "var(--font-size-base)",
                          marginLeft: "var(--space-6)",
                        }}
                      >
                        — {c.note}
                      </span>
                    </>
                  }
                />
              );
            })}
            {page.knowsFuture && (
              <FlagBlock
                tone="accent"
                label="KNOWS FUTURE"
                body={
                  <span
                    style={{
                      color: TEXT_SECONDARY,
                      fontFamily: BODY,
                      fontSize: "var(--font-size-base)",
                    }}
                  >
                    Page narration is informed by events later in the timeline.
                  </span>
                }
              />
            )}
          </div>
        </>
      )}

      {/* Perspective */}
      {hasPerspective && (
        <>
          <PanelSectionHeader label="Perspective" withTopBorder />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "0 18px 14px 18px",
              gap: 0,
            }}
          >
            {persp.knowsHow && (
              <KvRow label="Knows how" value={persp.knowsHow} />
            )}
            {persp.feels && persp.feels.length > 0 && (
              <KvRow
                label="Feels"
                value={
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)" }}>
                    {persp.feels.map((tag) => (
                      <span
                        key={tag}
                        style={{
                          padding: "2px 8px",
                          border: `1px solid ${BORDER}`,
                          color: TEXT_PRIMARY,
                          fontFamily: MONO,
                          fontSize: "var(--font-size-xs)",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                }
              />
            )}
            {persp.stake && <KvRow label="Stake" value={persp.stake} />}
          </div>
        </>
      )}

      {/* Edges */}
      {neighbours.length > 0 && (
        <>
          <PanelSectionHeader
            label="Edges"
            trailing={`${pad2(neighbours.length)} connected`}
            withTopBorder
          />
          {neighbours.slice(0, 12).map((n, i) => (
            <EdgeRow
              key={n.page.id}
              page={n.page}
              strength={n.strength}
              routeBase={routeBase}
              last={i === Math.min(neighbours.length, 12) - 1}
            />
          ))}
        </>
      )}
    </div>
  );
}

function PanelSectionHeader({
  label,
  trailing,
  withTopBorder,
}: {
  label: string;
  trailing?: string;
  withTopBorder?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-10)",
        padding: "14px 18px 8px 18px",
        borderTop: withTopBorder ? `1px solid ${DIVIDER}` : "none",
        color: TEXT_FADED,
        fontFamily: MONO,
        fontSize: "var(--font-size-xs)",
        fontWeight: 500,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
      }}
    >
      <span>{label}</span>
      <span style={{ flex: 1, height: 1, background: DIVIDER }} />
      {trailing && <span style={{ color: TEXT_GHOST }}>{trailing}</span>}
    </div>
  );
}

function MetaRow({
  label,
  value,
  last,
}: {
  label: string;
  value: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 18px",
        gap: "var(--space-10)",
        borderBottom: last ? "none" : `1px solid ${DIVIDER}`,
      }}
    >
      <span
        style={{
          width: 110,
          color: TEXT_FADED,
          fontFamily: MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
        {value}
      </div>
    </div>
  );
}

function KvRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        padding: "8px 0",
        gap: "var(--space-14)",
      }}
    >
      <span
        style={{
          width: 110,
          flexShrink: 0,
          color: TEXT_FADED,
          fontFamily: MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          paddingTop: "var(--space-2)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          flex: 1,
          color: TEXT_PRIMARY,
          fontFamily: MONO,
          fontSize: "var(--font-size-base)",
          lineHeight: "18px",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function FlagBlock({
  tone,
  label,
  body,
}: {
  tone: "danger" | "accent";
  label: string;
  body: ReactNode;
}) {
  const isDanger = tone === "danger";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-10)",
        padding: "10px 12px",
        border: `1px solid ${isDanger ? DANGER_RING : ACCENT_RING}`,
        background: isDanger ? DANGER_SOFT : ACCENT_SOFT,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: isDanger ? DANGER : ACCENT,
          flexShrink: 0,
          marginTop: "var(--space-5)",
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", flex: 1 }}>
        <span
          style={{
            color: isDanger ? DANGER : ACCENT,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            fontWeight: 500,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        <span style={{ lineHeight: "18px" }}>{body}</span>
      </div>
    </div>
  );
}

function EdgeRow({
  page,
  strength,
  routeBase,
  last,
}: {
  page: WikiKnowledgePage;
  strength: number;
  routeBase: string;
  last?: boolean;
}) {
  return (
    <Link
      href={`${routeBase}/pages/${page.slug}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-10)",
        height: 40,
        padding: "0 18px",
        borderTop: `1px solid ${DIVIDER}`,
        borderBottom: last ? `1px solid ${DIVIDER}` : "none",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: TYPE_COLOR[page.type],
          flexShrink: 0,
        }}
      />
      <span
        style={{
          flex: 1,
          color: TEXT_PRIMARY,
          fontFamily: BODY,
          fontSize: "var(--font-size-base)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {page.title}
      </span>
      <span
        style={{
          color: TEXT_MUTED,
          fontFamily: MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.06em",
        }}
      >
        {strength.toFixed(2)}
      </span>
    </Link>
  );
}

/* ── Page tab ────────────────────────────────────────────────── */

function PageView({
  wikiId,
  page,
}: {
  wikiId: string;
  page: WikiKnowledgePage;
}) {
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setEditing(false);
  }, [page.id]);

  if (editing) {
    return (
      <PageEditForm
        wikiId={wikiId}
        page={page}
        onDone={() => setEditing(false)}
      />
    );
  }
  return <PageReadContent page={page} onEdit={() => setEditing(true)} />;
}

function PageReadContent({
  page,
  onEdit,
}: {
  page: WikiKnowledgePage;
  onEdit: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--space-12)",
          padding: "16px 18px 14px 18px",
          borderBottom: `1px solid ${DIVIDER}`,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2
            style={{
              margin: 0,
              color: FG,
              fontFamily: DISPLAY,
              fontSize: 20,
              fontWeight: 500,
              letterSpacing: "-0.005em",
              lineHeight: "26px",
            }}
          >
            {page.title}
          </h2>
          <div
            style={{
              marginTop: "var(--space-6)",
              fontFamily: MONO,
              fontSize: "var(--font-size-xs)",
              color: TEXT_GHOST,
              letterSpacing: "0.06em",
              display: "flex",
              gap: "var(--space-8)",
              flexWrap: "wrap",
            }}
          >
            <span>/pages/{page.slug}</span>
            {page.timeIndex && (
              <>
                <span style={{ color: TEXT_QUIET }}>·</span>
                <span>
                  {page.timeIndex.era} · t={page.timeIndex.index}
                </span>
              </>
            )}
            <span style={{ color: TEXT_QUIET }}>·</span>
            <span>conf {(page.confidence ?? 0).toFixed(2)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: "var(--space-6)",
            padding: "6px 12px",
            border: `1px solid rgba(255, 255, 255, 0.16)`,
            background: "transparent",
            color: TEXT_PRIMARY,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            fontWeight: 500,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          EDIT
        </button>
      </div>

      {page.summary && (
        <div
          style={{
            padding: "14px 18px",
            color: TEXT_SECONDARY,
            fontFamily: BODY,
            fontSize: "var(--font-size-md)",
            lineHeight: "20px",
            borderBottom: `1px solid ${DIVIDER}`,
          }}
        >
          {page.summary}
        </div>
      )}

      <FrontmatterSection page={page} />

      {page.body.trim() && (
        <>
          <PanelSectionHeader label="Body" withTopBorder />
          <pre
            style={{
              margin: 0,
              padding: "0 18px 18px 18px",
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              lineHeight: "18px",
              color: TEXT_PRIMARY,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {page.body}
          </pre>
        </>
      )}
    </div>
  );
}

/* ── Sources tab ─────────────────────────────────────────────── */

function SourcesView({ sources }: { sources: WikiKnowledgeSourceRef[] }) {
  if (sources.length === 0) {
    return (
      <div
        style={{
          padding: "40px 24px",
          textAlign: "center",
          color: TEXT_FADED,
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
          letterSpacing: "0.04em",
        }}
      >
        No source citations on this page.
        <div
          style={{
            marginTop: "var(--space-6)",
            fontSize: "var(--font-size-xs)",
            color: TEXT_GHOST,
            letterSpacing: "0.06em",
          }}
        >
          Sources are created by the ingestion pipeline.
        </div>
      </div>
    );
  }
  return <SourcesSection sources={sources} />;
}

function SourcesSection({ sources }: { sources: WikiKnowledgeSourceRef[] }) {
  return (
    <>
      <PanelSectionHeader
        label="Sources"
        trailing={`${pad2(sources.length)} cited`}
      />
      <div style={{ display: "flex", flexDirection: "column" }}>
        {sources.map((s, i) => (
          <div
            key={s.refId}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-6)",
              padding: "12px 18px",
              borderTop: i === 0 ? `1px solid ${DIVIDER}` : "none",
              borderBottom: `1px solid ${DIVIDER}`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-10)",
              }}
            >
              <span
                style={{
                  flex: 1,
                  color: FG,
                  fontFamily: BODY,
                  fontSize: "var(--font-size-md)",
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.title}
              </span>
              <span
                style={{
                  color: TEXT_FADED,
                  fontFamily: MONO,
                  fontSize: "var(--font-size-xs)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  flexShrink: 0,
                }}
              >
                {s.kind}
              </span>
            </div>
            {s.passage && (
              <div
                style={{
                  color: TEXT_FADED,
                  fontFamily: MONO,
                  fontSize: "var(--font-size-xs)",
                  letterSpacing: "0.04em",
                }}
              >
                {s.passage}
              </div>
            )}
            {s.quote && (
              <blockquote
                style={{
                  margin: 0,
                  paddingLeft: "var(--space-10)",
                  borderLeft: `2px solid ${ACCENT_RING}`,
                  color: TEXT_SECONDARY,
                  fontFamily: BODY,
                  fontSize: "var(--font-size-base)",
                  fontStyle: "italic",
                  lineHeight: "18px",
                }}
              >
                {s.quote}
              </blockquote>
            )}
            {s.relevanceNote && (
              <div
                style={{
                  color: TEXT_SECONDARY,
                  fontFamily: BODY,
                  fontSize: "var(--font-size-base)",
                  lineHeight: "18px",
                }}
              >
                {s.relevanceNote}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Frontmatter (type-aware) ───────────────────────────────── */

function FrontmatterSection({ page }: { page: WikiKnowledgePage }) {
  const rows = frontmatterRows(page);
  if (rows.length === 0) return null;
  return (
    <>
      <PanelSectionHeader label="Frontmatter" withTopBorder />
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((r, i) => (
          <MetaRow
            key={r.label}
            label={r.label}
            value={
              <span
                style={{ color: TEXT_PRIMARY, fontFamily: MONO, fontSize: "var(--font-size-base)" }}
              >
                {r.value}
              </span>
            }
            last={i === rows.length - 1}
          />
        ))}
      </div>
    </>
  );
}

function frontmatterRows(
  page: WikiKnowledgePage,
): Array<{ label: string; value: string }> {
  const fm = page.frontmatter;
  const rows: Array<{ label: string; value: string }> = [];

  const aliases = Array.isArray(fm.aliases) ? (fm.aliases as string[]) : [];

  switch (page.type) {
    case "entity": {
      if (typeof fm.kind === "string")
        rows.push({ label: "kind", value: fm.kind });
      if (aliases.length > 0)
        rows.push({ label: "aliases", value: aliases.join(", ") });
      if (typeof fm.firstAppearance === "string")
        rows.push({ label: "first appears", value: fm.firstAppearance });
      if (typeof fm.lastAppearance === "string")
        rows.push({ label: "last appears", value: fm.lastAppearance });
      break;
    }
    case "event": {
      if (
        fm.when &&
        typeof fm.when === "object" &&
        "era" in (fm.when as object)
      ) {
        const w = fm.when as { era: string; index: number };
        rows.push({ label: "when", value: `${w.era} · t=${w.index}` });
      }
      if (typeof fm.where === "string")
        rows.push({ label: "where", value: fm.where });
      if (Array.isArray(fm.participants) && fm.participants.length > 0)
        rows.push({
          label: "participants",
          value: (fm.participants as string[]).join(", "),
        });
      if (Array.isArray(fm.causes) && fm.causes.length > 0)
        rows.push({
          label: "causes",
          value: (fm.causes as string[]).join(", "),
        });
      if (Array.isArray(fm.effects) && fm.effects.length > 0)
        rows.push({
          label: "effects",
          value: (fm.effects as string[]).join(", "),
        });
      break;
    }
    case "concept": {
      if (aliases.length > 0)
        rows.push({ label: "aliases", value: aliases.join(", ") });
      if (Array.isArray(fm.instances) && fm.instances.length > 0)
        rows.push({
          label: "instances",
          value: (fm.instances as string[]).join(", "),
        });
      if (Array.isArray(fm.relatedConcepts) && fm.relatedConcepts.length > 0)
        rows.push({
          label: "related",
          value: (fm.relatedConcepts as string[]).join(", "),
        });
      break;
    }
    case "relationship": {
      if (typeof fm.kind === "string")
        rows.push({ label: "kind", value: fm.kind });
      if (typeof fm.from === "string")
        rows.push({ label: "from", value: fm.from });
      if (typeof fm.to === "string") rows.push({ label: "to", value: fm.to });
      if (Array.isArray(fm.evolution) && fm.evolution.length > 0)
        rows.push({
          label: "evolution",
          value: (fm.evolution as string[]).join(" → "),
        });
      break;
    }
    case "voice_identity": {
      const arrays: Array<[string, string]> = [
        ["speech patterns", "speechPatterns"],
        ["idioms", "idioms"],
        ["beliefs", "beliefs"],
        ["emotional range", "emotionalRange"],
        ["taboos", "taboos"],
      ];
      for (const [label, key] of arrays) {
        const v = (fm as Record<string, unknown>)[key];
        if (Array.isArray(v) && v.length > 0) {
          rows.push({ label, value: (v as string[]).join(", ") });
        }
      }
      break;
    }
    case "timeline":
      break;
  }

  return rows;
}

/* ── Edit form ───────────────────────────────────────────────── */

function PageEditForm({
  wikiId,
  page,
  onDone,
}: {
  wikiId: string;
  page: WikiKnowledgePage;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(page.title);
  const [summary, setSummary] = useState(page.summary ?? "");
  const [body, setBody] = useState(page.body);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setTitle(page.title);
    setSummary(page.summary ?? "");
    setBody(page.body);
    setError(null);
    setSavedAt(null);
  }, [page.id]);

  const dirty =
    title !== page.title ||
    summary !== (page.summary ?? "") ||
    body !== page.body;

  function save() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title cannot be empty");
      return;
    }
    startTransition(async () => {
      const res = await updateWikiPageContent(wikiId, page.id, {
        title: trimmed,
        summary,
        body,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setSavedAt(Date.now());
      onDone();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <PanelSectionHeader label="Title" />
      <div style={{ padding: "0 18px 12px 18px" }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          spellCheck={false}
          style={editInputStyle()}
        />
      </div>

      <PanelSectionHeader label="Summary" withTopBorder />
      <div style={{ padding: "0 18px 12px 18px" }}>
        <AutoTextarea
          value={summary}
          onChange={setSummary}
          minRows={2}
          placeholder="One-sentence description…"
        />
      </div>

      <PanelSectionHeader label="Body · markdown" withTopBorder />
      <div style={{ padding: "0 18px 12px 18px" }}>
        <AutoTextarea
          value={body}
          onChange={setBody}
          minRows={10}
          mono
          placeholder="The full page body…"
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-12)",
          padding: "12px 18px 18px 18px",
          borderTop: `1px solid ${DIVIDER}`,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-8)",
            color: error
              ? DANGER
              : savedAt
                ? ACCENT
                : dirty
                  ? ACCENT
                  : TEXT_FADED,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.04em",
          }}
        >
          {(dirty || error || savedAt) && (
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: error ? DANGER : ACCENT,
              }}
            />
          )}
          {error
            ? error
            : pending
              ? "saving…"
              : savedAt
                ? "saved · re-embeds in background"
                : dirty
                  ? "unsaved changes"
                  : "in sync"}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          style={{
            display: "flex",
            alignItems: "center",
            height: 30,
            padding: "0 14px",
            border: `1px solid rgba(255, 255, 255, 0.16)`,
            background: "transparent",
            color: TEXT_PRIMARY,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            fontWeight: 500,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            cursor: pending ? "not-allowed" : "pointer",
            opacity: pending ? 0.5 : 1,
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          style={{
            display: "flex",
            alignItems: "center",
            height: 30,
            padding: "0 16px",
            border: "none",
            background: dirty && !pending ? ACCENT : ACCENT_SOFT,
            color: dirty && !pending ? "#050505" : ACCENT,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            cursor: dirty && !pending ? "pointer" : "not-allowed",
            opacity: !dirty || pending ? 0.6 : 1,
          }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function editInputStyle(): CSSProperties {
  return {
    width: "100%",
    padding: "8px 12px",
    border: `1px solid rgba(255, 255, 255, 0.12)`,
    background: INPUT_BG,
    color: FG,
    fontFamily: BODY,
    fontSize: "var(--font-size-md)",
    outline: "none",
  };
}

function AutoTextarea({
  value,
  onChange,
  minRows,
  mono,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  minRows: number;
  mono?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={minRows}
      placeholder={placeholder}
      spellCheck={false}
      style={{
        width: "100%",
        padding: "8px 12px",
        border: `1px solid rgba(255, 255, 255, 0.12)`,
        background: INPUT_BG,
        color: FG,
        fontFamily: mono ? MONO : BODY,
        fontSize: mono ? 12 : 13,
        lineHeight: mono ? "20px" : "20px",
        outline: "none",
        resize: "none",
        overflow: "hidden",
      }}
    />
  );
}

/* ── Helpers ───────────────────────────────────────────────── */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function relative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ── Animated layout hook ──────────────────────────────────── */

function useAnimatedLayout(
  target: LayoutPoint[],
  durationMs: number,
): LayoutPoint[] {
  const [displayed, setDisplayed] = useState<LayoutPoint[]>(target);
  const displayedRef = useRef(displayed);
  displayedRef.current = displayed;

  useEffect(() => {
    const from = displayedRef.current;
    const fromById = new Map(from.map((p) => [p.id, p]));
    const start =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    let raf = 0;
    function frame(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next: LayoutPoint[] = target.map((p) => {
        const f = fromById.get(p.id) ?? p;
        return {
          id: p.id,
          x: f.x + (p.x - f.x) * eased,
          y: f.y + (p.y - f.y) * eased,
        };
      });
      setDisplayed(next);
      if (t < 1) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return displayed;
}
