"use client";

import type { PlanOp } from "@odyssey/wiki-ingest";

/**
 * OpsLog — compact execution trace for the active ingestion plan.
 */

const FONT_MONO = "var(--font-mono, 'JetBrains Mono'), ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";
const DANGER = "var(--danger)";

export type OpQueueRow =
  | { state: "done"; op: PlanOp; tokens: number; edgesAdded: number }
  | { state: "writing"; op: PlanOp; tokens: number }
  | { state: "queued"; op: PlanOp }
  | { state: "failed"; op: PlanOp; tokens: number; error: string };

export type OpsLogProps = {
  queue: OpQueueRow[];
  opsDone: number;
  opsTotal: number;
};

export function OpsLog({ queue, opsDone, opsTotal }: OpsLogProps) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
      <style>{ANIM_CSS}</style>
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: ACCENT,
          }}
        >
          execution trace
        </span>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          {opsDone} / {opsTotal || "—"} ops
        </span>
      </header>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--input-border)",
          borderRadius: "var(--radius-lg)",
          background: "var(--input-bg)",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-base)",
          padding: "6px 0",
          overflow: "hidden",
        }}
      >
        <ColumnHeader />

        {queue.length === 0 ? (
          <div
            style={{
              padding: "14px 18px",
              fontSize: "var(--font-size-base)",
            color: "var(--text-tertiary)",
          }}
        >
            waiting for plan…
          </div>
        ) : (
          queue.map((row, i) => (
            <OpRow
              key={row.op.slug}
              row={row}
              index={i + 1}
              isLast={i === queue.length - 1}
            />
          ))
        )}
      </div>
    </section>
  );
}

/* ── Sub-components ───────────────────────────────────────────── */

function ColumnHeader() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "6px 18px",
        fontSize: "var(--font-size-2xs)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--text-tertiary)",
        borderBottom: "1px solid var(--divider)",
      }}
    >
      <span style={{ width: 22, flexShrink: 0 }} />
      <span style={{ width: 30, flexShrink: 0 }}>#</span>
      <span style={{ width: 74, flexShrink: 0 }}>Action</span>
      <span style={{ flex: 1, paddingLeft: "var(--space-8)", minWidth: 0 }}>Slug</span>
      <span style={{ width: 80, flexShrink: 0, textAlign: "right" }}>+Edges</span>
      <span style={{ width: 90, flexShrink: 0, textAlign: "right" }}>Tokens</span>
    </div>
  );
}

function OpRow({
  row,
  index,
  isLast,
}: {
  row: OpQueueRow;
  index: number;
  isLast: boolean;
}) {
  const isDone = row.state === "done";
  const isWriting = row.state === "writing";
  const isFailed = row.state === "failed";
  const isQueued = row.state === "queued";

  const rowStyle: React.CSSProperties = isWriting
    ? {
        background: "color-mix(in srgb, var(--accent-strong) 6%, transparent)",
        borderLeft: `2px solid ${ACCENT}`,
        paddingLeft: "var(--space-16)",
      }
    : isFailed
      ? {
          background: "color-mix(in srgb, var(--danger) 6%, transparent)",
          borderLeft: `2px solid ${DANGER}`,
          paddingLeft: "var(--space-16)",
        }
      : { paddingLeft: "var(--space-18)" };

  const baseColor = isQueued
    ? "var(--text-tertiary)"
    : isFailed
      ? DANGER
      : "var(--text-primary)";

  const indexColor = isQueued
    ? "var(--text-tertiary)"
    : isFailed
      ? DANGER
      : "var(--text-secondary)";

  const actionColor = isWriting
    ? ACCENT
    : isFailed
      ? DANGER
      : "var(--text-secondary)";

  const slugColor = isQueued
    ? "var(--text-tertiary)"
    : isWriting
      ? "var(--text-primary)"
      : isFailed
        ? DANGER
        : "var(--text-primary)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        minHeight: 36,
        padding: "7px 18px",
        paddingLeft: rowStyle.paddingLeft,
        background: rowStyle.background,
        borderLeft: rowStyle.borderLeft,
        borderBottom: isLast ? "none" : "1px solid var(--divider)",
        color: baseColor,
        opacity: isQueued ? 0.72 : 1,
      }}
    >
      {/* Status glyph gutter */}
      <span
        style={{
          width: 22,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
        }}
      >
        {isDone && <span style={{ color: ACCENT }}>✓</span>}
        {isWriting && <PulseDot color={ACCENT} />}
        {isFailed && <span style={{ color: DANGER }}>✕</span>}
        {isQueued && (
          <span style={{ color: "var(--text-quaternary)" }}>○</span>
        )}
      </span>

      <span
        style={{
          width: 30,
          flexShrink: 0,
          color: indexColor,
        }}
      >
        {String(index).padStart(2, "0")}
      </span>

      <span
        style={{
          width: 74,
          flexShrink: 0,
          color: actionColor,
          fontWeight: isWriting ? 600 : 400,
        }}
      >
        {row.op.action}
      </span>

      <span
        style={{
          flex: 1,
          paddingLeft: "var(--space-8)",
          minWidth: 0,
          color: slugColor,
          fontWeight: isWriting ? 600 : 400,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {row.op.slug}
        {isWriting && (
          <span
            style={{
              color: "var(--text-tertiary)",
              fontWeight: 400,
              marginLeft: "var(--space-8)",
            }}
          >
            ·{" "}
            {row.op.action === "create" ? "drafting body" : "revising body"}
          </span>
        )}
        {isFailed && (
          <span
            style={{
              color: DANGER,
              fontWeight: 400,
              marginLeft: "var(--space-8)",
              opacity: 0.85,
            }}
          >
            · {row.error.slice(0, 80)}
          </span>
        )}
      </span>

      <span
        style={{
          width: 80,
          flexShrink: 0,
          textAlign: "right",
          color: isDone ? ACCENT : isWriting ? ACCENT : "var(--text-tertiary)",
        }}
      >
        {isDone && `+${row.edgesAdded}`}
        {isWriting && "writing"}
        {isQueued && "—"}
        {isFailed && "—"}
      </span>

      <span
        style={{
          width: 90,
          flexShrink: 0,
          textAlign: "right",
          color: isQueued
            ? "var(--text-tertiary)"
            : isWriting
              ? ACCENT
              : isFailed
                ? DANGER
                : "var(--text-secondary)",
          textTransform: isQueued || isFailed ? "uppercase" : "none",
          letterSpacing: isQueued || isFailed ? "0.08em" : "normal",
          fontSize: isQueued || isFailed ? 11 : 12,
        }}
      >
        {isDone && row.tokens.toLocaleString()}
        {isWriting && row.tokens.toLocaleString()}
        {isQueued && "queued"}
        {isFailed && "failed"}
      </span>
    </div>
  );
}

function PulseDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "var(--radius-pill)",
        background: color,
        boxShadow: `0 0 10px ${color}`,
        animation: "ops-log-pulse 1.1s ease-in-out infinite",
      }}
    />
  );
}

const ANIM_CSS = `@keyframes ops-log-pulse{0%,100%{opacity:1}50%{opacity:.4}}`;
