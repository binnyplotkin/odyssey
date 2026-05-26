"use client";

import { type ReactNode } from "react";

/**
 * FailedRecovery — compact incident report for interrupted ingestion.
 */

const FONT_MONO = "var(--font-mono, 'JetBrains Mono'), ui-monospace, monospace";
const FONT_HEAD = "var(--font-body, Inter), system-ui, sans-serif";
const ACCENT = "var(--accent-strong)";
const DANGER = "var(--danger)";

export type FailedRecoveryProps = {
  /** Ops that completed successfully before the halt. */
  opsDone: number;
  /** Total ops in the plan (planned, not just attempted). */
  opsTotal: number;
  /** The slug of the op that failed (if any). */
  failingSlug?: string;
  /** Error message from the run. */
  error: string;
  /** Duration in seconds (startedAt → finishedAt). */
  durationSec: number;
  /** Pages saved before the halt. */
  pagesAdded: number;
  /** Edges added before the halt. */
  edgesAdded: number;
  /** Tokens consumed before the halt. */
  tokensUsed: number;
  /** Total pages in the wiki *after* the partial run (existing + newly-saved). */
  totalPages: number;
  /** Primary action — retry the run with the failing op edited or skipped. */
  onRetry: () => void;
  /** Secondary action — jump to the failing source. */
  onOpenFailingSource?: () => void;
  /** Tertiary action — dismiss and return to idle. */
  onDismiss: () => void;
};

export function FailedRecovery({
  opsDone,
  opsTotal,
  failingSlug,
  error,
  durationSec,
  pagesAdded,
  edgesAdded,
  tokensUsed,
  totalPages,
  onRetry,
  onOpenFailingSource,
  onDismiss,
}: FailedRecoveryProps) {
  const savedSentence = buildSavedSentence({
    pagesAdded,
    edgesAdded,
    tokensUsed,
  });

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "stretch",
        gap: "var(--space-24)",
        padding: "30px 32px",
        border: "1px solid var(--input-border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--input-bg)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          flex: "1.4 1 480px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-16)",
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-10)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: DANGER,
          }}
        >
          <BangIcon />
          halted · {durationSec.toFixed(1)}s
        </div>

        <h2
          style={{
            margin: 0,
            fontFamily: FONT_HEAD,
            fontSize: 34,
            lineHeight: 1.1,
            fontWeight: 600,
            letterSpacing: 0,
            color: "var(--text-primary)",
          }}
        >
          Ingestion stopped
        </h2>

        <MetricStrip
          items={[
            ["Ops", `${opsDone} / ${opsTotal || "—"}`],
            ["Saved", `${pagesAdded}`],
            ["Edges", `+${edgesAdded}`],
            ["Tokens", tokensUsed.toLocaleString()],
          ]}
        />

        {pagesAdded > 0 && (
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
            <span style={{ color: ACCENT, fontWeight: 500 }}>{savedSentence}</span>{" "}
            were saved to the wiki and remain there.
          </p>
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-6)",
            padding: "14px 16px",
            border: `1px solid color-mix(in srgb, ${DANGER} 30%, transparent)`,
            borderRadius: "var(--radius-md)",
            background: `color-mix(in srgb, ${DANGER} 7%, transparent)`,
            maxWidth: 540,
          }}
        >
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-2xs)",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: DANGER,
              opacity: 0.85,
            }}
          >
            reason{failingSlug ? ` · ${failingSlug}` : ""}
          </div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-md)",
              color: DANGER,
              lineHeight: 1.55,
              wordBreak: "break-word",
            }}
          >
            {error}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)", paddingTop: "var(--space-6)", flexWrap: "wrap" }}>
          <PrimaryButton onClick={onRetry}>Retry with edits</PrimaryButton>
          {onOpenFailingSource && failingSlug && (
            <GhostButton onClick={onOpenFailingSource}>
              Open failing source ↗
            </GhostButton>
          )}
          <GhostButton onClick={onDismiss}>Dismiss</GhostButton>
        </div>
      </div>

      <div
        style={{
          flex: "1 1 320px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: "var(--space-14)",
          minWidth: 0,
          opacity: 0.82,
        }}
      >
        <GraphSnapshot
          savedCount={Math.min(8, Math.max(0, pagesAdded))}
          existingCount={Math.min(10, Math.max(2, totalPages - pagesAdded))}
          hasFailedNode={Boolean(failingSlug)}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-14)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <LegendDot color={ACCENT} label="saved" />
          <LegendDot color="var(--text-quaternary)" label="existing" />
          <LegendDot color={DANGER} label="failed" dashed />
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────── */

function buildSavedSentence(args: {
  pagesAdded: number;
  edgesAdded: number;
  tokensUsed: number;
}): string {
  const parts: string[] = [];
  parts.push(`${args.pagesAdded} ${args.pagesAdded === 1 ? "page" : "pages"}`);
  parts.push(`+${args.edgesAdded} ${args.edgesAdded === 1 ? "edge" : "edges"}`);
  parts.push(`${args.tokensUsed.toLocaleString()} tokens`);
  return parts.join(" · ");
}

/* ── Sub-components ───────────────────────────────────────────── */

function MetricStrip({ items }: { items: Array<[string, string]> }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        border: "1px solid var(--divider)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        maxWidth: 620,
      }}
    >
      {items.map(([label, value], index) => (
        <div
          key={label}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
            padding: "12px 14px",
            borderRight:
              index === items.length - 1 ? "none" : "1px solid var(--divider)",
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-2xs)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-lg)",
              fontWeight: 600,
              color: label === "Ops" ? DANGER : "var(--text-primary)",
            }}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

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
        gap: "var(--space-8)",
        padding: "12px 22px",
        background: DANGER,
        border: `1px solid ${DANGER}`,
        borderRadius: "var(--radius-md)",
        color: "var(--background)",
        fontFamily: FONT_HEAD,
        fontSize: "var(--font-size-lg)",
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
        borderRadius: "var(--radius-md)",
        color: "var(--text-primary)",
        fontFamily: FONT_HEAD,
        fontSize: "var(--font-size-lg)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function BangIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
      <circle
        cx="5.5"
        cy="5.5"
        r="4.6"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M5.5 3v3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="5.5" cy="7.8" r="0.7" fill="currentColor" />
    </svg>
  );
}

function LegendDot({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-6)" }}>
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: "var(--radius-pill)",
          background: dashed ? "transparent" : color,
          border: dashed ? `1px dashed ${color}` : undefined,
          boxSizing: "border-box",
        }}
      />
      {label}
    </span>
  );
}

/* ── Graph snapshot SVG ──────────────────────────────────────── */

type NodeKind = "saved" | "existing" | "failed";
type GraphNode = { x: number; y: number; r: number; kind: NodeKind };

function GraphSnapshot({
  savedCount,
  existingCount,
  hasFailedNode,
}: {
  savedCount: number;
  existingCount: number;
  hasFailedNode: boolean;
}) {
  const W = 300;
  const H = 200;
  const layout = layoutGraph(savedCount, existingCount, hasFailedNode, W, H);

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
        if (!a || !b) return null;
        const isFailedEdge =
          a.kind === "failed" || b.kind === "failed";
        const isSavedEdge =
          !isFailedEdge && (a.kind === "saved" || b.kind === "saved");
        return (
          <line
            key={`e${i}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={
              isFailedEdge
                ? DANGER
                : isSavedEdge
                  ? ACCENT
                  : "var(--ink-edge)"
            }
            strokeWidth={isFailedEdge || isSavedEdge ? 1.4 : 1}
            strokeOpacity={isFailedEdge ? 0.7 : isSavedEdge ? 0.85 : 1}
            strokeDasharray={isFailedEdge ? "3 3" : undefined}
          />
        );
      })}
      {layout.nodes.map((node, i) => (
        <g key={`n${i}`}>
          {node.kind === "saved" && (
            <circle
              cx={node.x}
              cy={node.y}
              r={node.r + 5}
              fill="none"
              stroke={ACCENT}
              strokeWidth={1}
              opacity={0.4}
            />
          )}
          {node.kind === "failed" ? (
            <circle
              cx={node.x}
              cy={node.y}
              r={node.r}
              fill="none"
              stroke={DANGER}
              strokeWidth={1.4}
              strokeDasharray="2.5 2.5"
            />
          ) : (
            <circle
              cx={node.x}
              cy={node.y}
              r={node.r}
              fill={
                node.kind === "saved"
                  ? ACCENT
                  : "color-mix(in srgb, var(--text-primary) 40%, transparent)"
              }
            />
          )}
        </g>
      ))}
    </svg>
  );
}

function layoutGraph(
  savedCount: number,
  existingCount: number,
  hasFailedNode: boolean,
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

  // Saved constellation — clustered toward the lower-left, anchored by
  // bridges to the existing cluster (same as Resolved's "new" cluster).
  const savedStartIndex = nodes.length;
  const savedCenter = { x: width * 0.32, y: height * 0.72 };
  for (let i = 0; i < savedCount; i++) {
    const angle = (i / Math.max(1, savedCount)) * Math.PI * 2 + 0.4;
    const radius = 30 + (i % 2) * 22;
    nodes.push({
      x: savedCenter.x + Math.cos(angle) * radius,
      y: savedCenter.y + Math.sin(angle) * radius * 0.65,
      r: 5,
      kind: "saved",
    });
  }

  // Edges: existing chain + each saved node bridges to existing.
  for (let i = 0; i < existingCount - 1; i++) {
    edges.push({ from: i, to: i + 1 });
  }
  for (let i = 0; i < savedCount; i++) {
    const here = savedStartIndex + i;
    if (i > 0) edges.push({ from: savedStartIndex + i - 1, to: here });
    if (existingCount > 0) {
      const bridgeTarget = i % existingCount;
      edges.push({ from: bridgeTarget, to: here });
    }
  }

  // Failed node — placed adjacent to the saved cluster's "next" position,
  // with a dashed bridge attempt from the most recent saved node (or from
  // existing if nothing was saved).
  if (hasFailedNode) {
    const failedIndex = nodes.length;
    nodes.push({
      x: width * 0.18,
      y: height * 0.38,
      r: 6,
      kind: "failed",
    });
    if (savedCount > 0) {
      edges.push({ from: savedStartIndex + savedCount - 1, to: failedIndex });
    } else if (existingCount > 0) {
      edges.push({ from: 0, to: failedIndex });
    }
  }

  return { nodes, edges };
}
