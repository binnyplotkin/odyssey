"use client";

import { type ReactNode } from "react";

/**
 * ResolvedSummary — the "it worked" moment after a successful ingestion.
 * V3 (hero metric) direction: a single celebratory card with one dominant
 * mint number, a context paragraph, a generative graph snapshot showing
 * new vs existing nodes/edges, and two clear next-steps.
 *
 * Self-contained: depends only on theme CSS variables and `color-mix`.
 * The graph snapshot is procedural — given `pagesNew` and `pagesExisting`,
 * we lay out a small mint constellation joined to an existing constellation.
 *
 * Width: designed for the LiveProgress column (~1240px). Below that the
 * grid collapses to a single column gracefully via flex wrap.
 */

const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const FONT_HEAD = "'Inter', system-ui, sans-serif";
const ACCENT = "var(--accent-strong)";

export type ResolvedSummaryProps = {
  /** Pages newly created this run. */
  pagesCreated: number;
  /** Pages revised this run. */
  pagesUpdated: number;
  /** Edges added this run. */
  edgesAdded: number;
  /** Tokens consumed this run. */
  tokensUsed: number;
  /** Duration in seconds (the run's startedAt → finishedAt). */
  durationSec: number;
  /** Total pages in the wiki *after* the run (existing + newly-created). */
  totalPages: number;
  /** Name of the entity that the run densified most (e.g. "abraham"). */
  densifiedAround?: string;
  /** Percent density gain across the densified region. */
  densityGainPct?: number;
  /** Primary action — open the knowledge graph. */
  onOpenKnowledge: () => void;
  /** Secondary action — run another ingestion. */
  onFeedAnother: () => void;
};

export function ResolvedSummary({
  pagesCreated,
  pagesUpdated,
  edgesAdded,
  tokensUsed,
  durationSec,
  totalPages,
  densifiedAround,
  densityGainPct,
  onOpenKnowledge,
  onFeedAnother,
}: ResolvedSummaryProps) {
  const sub = buildContextSentence({
    edgesAdded,
    pagesUpdated,
    tokensUsed,
    densifiedAround,
    densityGainPct,
  });

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "stretch",
        gap: 0,
        padding: "48px 52px",
        border: "1px solid color-mix(in srgb, var(--accent-strong) 35%, transparent)",
        background: "color-mix(in srgb, var(--accent-strong) 5%, transparent)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          flex: "1.4 1 480px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          paddingRight: 32,
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: ACCENT,
          }}
        >
          <CheckIcon />
          complete · {durationSec.toFixed(1)}s
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: FONT_HEAD,
              fontSize: 120,
              fontWeight: 600,
              letterSpacing: "-0.04em",
              color: ACCENT,
              lineHeight: 1,
            }}
          >
            +{pagesCreated}
          </span>
          <span
            style={{
              fontFamily: FONT_HEAD,
              fontSize: 26,
              color: "var(--text-tertiary)",
              fontWeight: 400,
              letterSpacing: "-0.01em",
            }}
          >
            new {pagesCreated === 1 ? "page" : "pages"}
          </span>
        </div>

        <p
          style={{
            fontFamily: FONT_HEAD,
            fontSize: 15,
            lineHeight: "24px",
            color: "var(--text-secondary)",
            margin: 0,
            maxWidth: 540,
          }}
        >
          {sub}
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 6, flexWrap: "wrap" }}>
          <PrimaryButton onClick={onOpenKnowledge}>
            Open knowledge graph ↗
          </PrimaryButton>
          <GhostButton onClick={onFeedAnother}>Run another</GhostButton>
        </div>
      </div>

      <div
        style={{
          flex: "1 1 320px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 14,
          minWidth: 0,
        }}
      >
        <GraphSnapshot
          newCount={Math.min(8, Math.max(0, pagesCreated))}
          existingCount={Math.min(10, Math.max(2, totalPages - pagesCreated))}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
          }}
        >
          <LegendDot color={ACCENT} label="added this run" />
          <LegendDot
            color="var(--text-quaternary)"
            label="existing"
          />
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────── */

function buildContextSentence(args: {
  edgesAdded: number;
  pagesUpdated: number;
  tokensUsed: number;
  densifiedAround?: string;
  densityGainPct?: number;
}): string {
  const parts: string[] = [];
  parts.push(`+${args.edgesAdded} ${args.edgesAdded === 1 ? "edge" : "edges"}`);
  if (args.pagesUpdated > 0) {
    parts.push(
      `${args.pagesUpdated} ${args.pagesUpdated === 1 ? "page" : "pages"} revised`,
    );
  }
  parts.push(`${args.tokensUsed.toLocaleString()} tokens spent`);
  const trailing =
    args.densifiedAround && args.densityGainPct !== undefined
      ? `. The graph just got ${args.densityGainPct}% denser around ${args.densifiedAround}.`
      : ".";
  return `${parts.join(", ")}${trailing}`;
}

/* ── Sub-components ───────────────────────────────────────────── */

function PrimaryButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 22px",
        background: ACCENT,
        border: `1px solid ${ACCENT}`,
        color: "var(--background)",
        fontFamily: FONT_HEAD,
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function GhostButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "12px 20px",
        background: "transparent",
        border: "1px solid var(--border)",
        color: "var(--text-primary)",
        fontFamily: FONT_HEAD,
        fontSize: 14,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
      <path
        d="M2 5.5l2 2 5-5.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: 999,
          background: color,
        }}
      />
      {label}
    </span>
  );
}

/* ── Graph snapshot SVG ──────────────────────────────────────── */

type NodeKind = "new" | "existing";
type GraphNode = { x: number; y: number; r: number; kind: NodeKind };

function GraphSnapshot({
  newCount,
  existingCount,
}: {
  newCount: number;
  existingCount: number;
}) {
  const W = 300;
  const H = 200;
  const layout = layoutGraph(newCount, existingCount, W, H);

  return (
    <svg
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      fill="none"
      style={{ display: "block", maxWidth: "100%" }}
      aria-hidden
    >
      {layout.edges.map((edge, i) => {
        const a = layout.nodes[edge.from];
        const b = layout.nodes[edge.to];
        const isNewEdge =
          a?.kind === "new" || b?.kind === "new";
        if (!a || !b) return null;
        return (
          <line
            key={`e${i}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={isNewEdge ? "var(--accent-strong)" : "color-mix(in srgb, var(--text-primary) 18%, transparent)"}
            strokeWidth={isNewEdge ? 1.4 : 1}
            strokeOpacity={isNewEdge ? 0.85 : 1}
          />
        );
      })}
      {layout.nodes.map((node, i) => (
        <g key={`n${i}`}>
          {node.kind === "new" && (
            <circle
              cx={node.x}
              cy={node.y}
              r={node.r + 5}
              fill="none"
              stroke="var(--accent-strong)"
              strokeWidth={1}
              opacity={0.4}
            />
          )}
          <circle
            cx={node.x}
            cy={node.y}
            r={node.r}
            fill={
              node.kind === "new"
                ? "var(--accent-strong)"
                : "color-mix(in srgb, var(--text-primary) 40%, transparent)"
            }
          />
        </g>
      ))}
    </svg>
  );
}

function layoutGraph(
  newCount: number,
  existingCount: number,
  width: number,
  height: number,
): { nodes: GraphNode[]; edges: Array<{ from: number; to: number }> } {
  const nodes: GraphNode[] = [];
  const edges: Array<{ from: number; to: number }> = [];

  // Existing constellation — clustered toward the upper-right.
  const existingCenter = { x: width * 0.62, y: height * 0.42 };
  for (let i = 0; i < existingCount; i++) {
    const angle = (i / Math.max(1, existingCount)) * Math.PI * 2;
    const radius = 38 + (i % 3) * 18;
    nodes.push({
      x: existingCenter.x + Math.cos(angle) * radius,
      y: existingCenter.y + Math.sin(angle) * radius * 0.7,
      r: 5 - (i % 3),
      kind: "existing",
    });
  }

  // New constellation — clustered toward the lower-left, anchored by 1-2 bridges to the existing cluster.
  const newStartIndex = nodes.length;
  const newCenter = { x: width * 0.32, y: height * 0.72 };
  for (let i = 0; i < newCount; i++) {
    const angle = (i / Math.max(1, newCount)) * Math.PI * 2 + 0.4;
    const radius = 30 + (i % 2) * 22;
    nodes.push({
      x: newCenter.x + Math.cos(angle) * radius,
      y: newCenter.y + Math.sin(angle) * radius * 0.65,
      r: 5,
      kind: "new",
    });
  }

  // Edges: connect each existing node to its next sibling (chain), and each new node to its previous + a bridge to an existing node.
  for (let i = 0; i < existingCount - 1; i++) {
    edges.push({ from: i, to: i + 1 });
  }
  for (let i = 0; i < newCount; i++) {
    const here = newStartIndex + i;
    if (i > 0) edges.push({ from: newStartIndex + i - 1, to: here });
    if (existingCount > 0) {
      const bridgeTarget = i % existingCount;
      edges.push({ from: bridgeTarget, to: here });
    }
  }

  return { nodes, edges };
}
