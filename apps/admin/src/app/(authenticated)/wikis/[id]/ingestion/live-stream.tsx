"use client";

import { type CSSProperties } from "react";
import type { IngestionEvent, PlanOp } from "@odyssey/wiki-ingest";

/**
 * LiveStream — compact context panel during the running phase.
 */

const FONT_MONO = "var(--font-mono, 'JetBrains Mono'), ui-monospace, monospace";
const FONT_HEAD = "var(--font-body, Inter), system-ui, sans-serif";
const ACCENT = "var(--accent-strong)";
const AMBER = "var(--status-processing)";
const PANEL_BG = "var(--control-bg)";

export type ActiveWriteSnapshot = {
  op: PlanOp;
  /** 1-based index of this op within the plan. */
  indexInPlan: number;
  /** Total ops in the plan. */
  totalOps: number;
  /** Tokens streamed for this op so far. */
  tokensStreamed: number;
};

export type LiveStreamProps = {
  events: IngestionEvent[];
  startedAt: number;
  /** Ops currently being written. Parallel ingestion can have several. */
  activeWrites: ActiveWriteSnapshot[];
};

export function LiveStream({
  events,
  startedAt,
  activeWrites,
}: LiveStreamProps) {
  const tailRows = deriveTailRows(events, startedAt);
  const loadedIndex = events.find(
    (e): e is Extract<IngestionEvent, { type: "loaded-index" }> =>
      e.type === "loaded-index",
  );
  const planComplete = events.find((e) => e.type === "plan-complete");
  const subPhase: IdleSubPhase = !loadedIndex
    ? "loading-index"
    : !planComplete
      ? "planning"
      : "between-ops";
  const pageCount = loadedIndex?.pageCount ?? null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
      }}
    >
      <style>{ANIM_CSS}</style>

      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "var(--space-10)",
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
            context
          </span>
          {activeWrites.length > 0 ? (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-sm)",
                color: "var(--text-tertiary)",
              }}
            >
              {activeWrites.length === 1
                ? `${activeWrites[0].indexInPlan} of ${activeWrites[0].totalOps}`
                : `${activeWrites.length} active`}
            </span>
          ) : (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-sm)",
                color: "var(--text-tertiary)",
              }}
            >
              {subPhase === "loading-index"
                ? "loading"
                : subPhase === "planning"
                  ? "planning"
                  : "between ops"}
            </span>
          )}
        </div>
        <LiveBadge />
      </header>

      {activeWrites.length > 0 ? (
        <ActiveWritesHero writes={activeWrites} />
      ) : (
        <IdleHero phase={subPhase} pageCount={pageCount} />
      )}

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          padding: "0 2px",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          event trace
        </span>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          {events.length} events
        </span>
      </div>

      <TailLog rows={tailRows} />
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────── */

function LiveBadge() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-8)",
        padding: "3px 9px",
        border: "1px solid var(--accent-border)",
        borderRadius: "var(--radius-pill)",
        background: "var(--accent-soft)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: ACCENT,
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: "var(--radius-pill)",
          background: "var(--accent-strong)",
          boxShadow:
            "0 0 8px color-mix(in srgb, var(--accent-strong) 70%, transparent)",
          animation: "live-stream-pulse 1.1s ease-in-out infinite",
        }}
      />
      LIVE
    </span>
  );
}

function HeroCard({ write }: { write: ActiveWriteSnapshot }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
        padding: "16px 18px",
        border: "1px solid var(--accent-border)",
        borderRadius: "var(--radius-lg)",
        background: PANEL_BG,
        boxShadow:
          "0 0 0 1px color-mix(in srgb, var(--accent-strong) 4%, transparent)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ color: ACCENT }}>
          {write.op.action} · {write.op.type}
        </span>
        <span style={{ color: "var(--text-tertiary)" }}>
          op {String(write.indexInPlan).padStart(2, "0")}
        </span>
      </div>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-lg)",
          fontWeight: 600,
          color: "var(--text-primary)",
        }}
      >
        {write.op.slug}
      </span>
      {write.op.rationale && (
        <p
          style={{
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-md)",
            lineHeight: "20px",
            color: "var(--text-secondary)",
            margin: 0,
          }}
        >
          {write.op.rationale}
        </p>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-6)",
        }}
      >
        <ShimmerBar />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          <span>{write.tokensStreamed.toLocaleString()} tok streamed</span>
          <span style={{ color: ACCENT }}>
            ▸{" "}
            {write.op.action === "create"
              ? "writing → pages"
              : "updating → pages"}
          </span>
        </div>
      </div>
    </div>
  );
}

function ActiveWritesHero({ writes }: { writes: ActiveWriteSnapshot[] }) {
  if (writes.length === 1) return <HeroCard write={writes[0]} />;

  const preview = writes.slice(0, 3);
  const extraCount = writes.length - preview.length;
  const totalOps = writes[0]?.totalOps ?? 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
        padding: "16px 18px",
        border: "1px solid var(--accent-border)",
        borderRadius: "var(--radius-lg)",
        background: PANEL_BG,
        boxShadow:
          "0 0 0 1px color-mix(in srgb, var(--accent-strong) 4%, transparent)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ color: ACCENT }}>{writes.length} writers active</span>
        <span style={{ color: "var(--text-tertiary)" }}>
          {totalOps > 0 ? `${totalOps} ops` : "parallel"}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-8)",
        }}
      >
        {preview.map((write) => (
          <div
            key={write.op.slug}
            style={{
              display: "grid",
              gridTemplateColumns: "34px minmax(0, 1fr)",
              gap: "var(--space-10)",
              alignItems: "baseline",
              minHeight: 36,
              padding: "8px 0",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                color: "var(--text-tertiary)",
              }}
            >
              {String(write.indexInPlan).padStart(2, "0")}
            </span>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-4)",
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-sm)",
                  color: ACCENT,
                  textTransform: "uppercase",
                }}
              >
                {write.op.action} · {write.op.type}
              </span>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-base)",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {write.op.slug}
              </span>
              {write.op.rationale && (
                <span
                  style={{
                    fontFamily: FONT_HEAD,
                    fontSize: "var(--font-size-sm)",
                    lineHeight: "18px",
                    color: "var(--text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {write.op.rationale}
                </span>
              )}
            </div>
          </div>
        ))}
        {extraCount > 0 && (
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
            }}
          >
            +{extraCount} more writer{extraCount === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-6)",
        }}
      >
        <ShimmerBar />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          <span>
            {writes
              .reduce((sum, write) => sum + write.tokensStreamed, 0)
              .toLocaleString()}{" "}
            tok streamed
          </span>
          <span style={{ color: ACCENT }}>▸ parallel writing → pages</span>
        </div>
      </div>
    </div>
  );
}

type IdleSubPhase = "loading-index" | "planning" | "between-ops";

function IdleHero({
  phase,
  pageCount,
}: {
  phase: IdleSubPhase;
  pageCount: number | null;
}) {
  const eyebrow =
    phase === "loading-index"
      ? "loading context"
      : phase === "planning"
        ? "planning"
        : "between ops";
  const body =
    phase === "loading-index"
      ? "reading existing wiki pages and edges…"
      : phase === "planning"
        ? pageCount !== null
          ? `analyzing ${pageCount.toLocaleString()} pages · drafting plan…`
          : "drafting plan…"
        : "waiting for the next op to start…";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-8)",
        padding: "16px 18px",
        border: "1px solid var(--control-border)",
        borderRadius: "var(--radius-lg)",
        background: PANEL_BG,
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        {eyebrow}
      </span>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-base)",
          lineHeight: 1.55,
          color: "var(--text-secondary)",
        }}
      >
        {body}
      </span>
    </div>
  );
}

function ShimmerBar() {
  return (
    <div
      style={{
        position: "relative",
        height: 3,
        background: "var(--ink-line)",
        borderRadius: "var(--radius-pill)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: "40%",
          background:
            "linear-gradient(90deg, transparent 0%, var(--accent-strong) 50%, transparent 100%)",
          animation: "live-stream-shimmer 1.8s linear infinite",
        }}
      />
    </div>
  );
}

function TailLog({ rows }: { rows: TailRow[] }) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        border: "1px solid var(--control-border)",
        borderRadius: "var(--radius-lg)",
        background: PANEL_BG,
        padding: "5px 0",
        maxHeight: 200,
        overflow: "hidden",
      }}
    >
      {rows.length === 0 ? (
        <div
          style={{
            padding: "9px 14px",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            color: "var(--text-tertiary)",
          }}
        >
          no events yet…
        </div>
      ) : (
        rows.map((row, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: "var(--space-10)",
              minHeight: 30,
              alignItems: "center",
              padding: "5px 14px",
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-sm)",
              lineHeight: "16px",
              // Fade older entries (top is newest in our reversed list)
              opacity: Math.max(0.42, 1 - i * 0.1),
              borderTop: i === 0 ? "none" : "1px solid var(--border-subtle)",
            }}
          >
            <span
              style={{
                width: 50,
                flexShrink: 0,
                color: "var(--text-tertiary)",
              }}
            >
              {row.ts}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                color:
                  row.tone === "error"
                    ? "var(--status-error)"
                    : "var(--text-secondary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  color: glyphColor(row.tone),
                  marginRight: "var(--space-6)",
                }}
              >
                {row.glyph}
              </span>
              {row.detail}
            </span>
          </div>
        ))
      )}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 50,
          background: `linear-gradient(180deg, transparent 0%, var(--background) 120%)`,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

function glyphColor(tone: TailRow["tone"]): string {
  switch (tone) {
    case "ok":
      return ACCENT;
    case "amber":
      return AMBER;
    case "error":
      return "var(--status-error)";
    default:
      return "var(--text-tertiary)";
  }
}

const ANIM_CSS = `
  @keyframes live-stream-pulse{0%,100%{opacity:1}50%{opacity:.4}}
  @keyframes live-stream-shimmer{0%{left:-40%}100%{left:100%}}
`;

/* ── Derivation ──────────────────────────────────────────────── */

type TailRow = {
  ts: string;
  glyph: string;
  detail: string;
  tone: "ok" | "amber" | "error" | "muted" | "neutral";
};

function deriveTailRows(
  events: IngestionEvent[],
  startedAt: number,
): TailRow[] {
  return [...events]
    .map<TailRow>((ev) => {
      const ts = fmtClock(Date.now() - startedAt);
      switch (ev.type) {
        case "queued":
          return {
            ts,
            glyph: "·",
            detail: `queued${ev.model ? ` · ${ev.model}` : ""}`,
            tone: "muted",
          };
        case "started":
          return {
            ts,
            glyph: "●",
            detail: `started · ${ev.model}`,
            tone: "muted",
          };
        case "loaded-index":
          return {
            ts,
            glyph: "···",
            detail: `loaded index · ${ev.pageCount} pages · ${ev.edgeCount} edges`,
            tone: "muted",
          };
        case "planning":
          return { ts, glyph: "···", detail: "planning…", tone: "muted" };
        case "plan-complete":
          return {
            ts,
            glyph: "⚐",
            detail: `plan · ${ev.opCount} ops${
              ev.contradictionCount > 0
                ? ` · ${ev.contradictionCount} contradiction${ev.contradictionCount === 1 ? "" : "s"}`
                : ""
            }`,
            tone: ev.contradictionCount > 0 ? "amber" : "neutral",
          };
        case "op-start":
          return {
            ts,
            glyph: "▸",
            detail: `op-start · ${ev.op.action} ${ev.op.slug}`,
            tone: "neutral",
          };
        case "op-complete":
          return {
            ts,
            glyph: "✓",
            detail: `saved ${ev.page.slug} · +${ev.edgesAdded} edges · ${ev.tokens.toLocaleString()} tok`,
            tone: "ok",
          };
        case "op-failed":
          return {
            ts,
            glyph: "✕",
            detail: `op-failed · ${ev.op.slug} · ${ev.error.slice(0, 60)}`,
            tone: "error",
          };
        case "edges-reconciled":
          return {
            ts,
            glyph: "···",
            detail: `edges · +${ev.added} / −${ev.removed}`,
            tone: "muted",
          };
        case "succeeded":
          return {
            ts,
            glyph: "✓",
            detail: `sealed · ${ev.result.tokensUsed.toLocaleString()} tok total`,
            tone: "ok",
          };
        case "failed":
          return {
            ts,
            glyph: "✕",
            detail: `failed · ${ev.error.slice(0, 80)}`,
            tone: "error",
          };
      }
    })
    .reverse()
    .slice(0, 8);
}

function fmtClock(ms: number): string {
  const total = Math.max(0, ms / 1000);
  if (total < 60) return `${total.toFixed(1)}s`;
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}m${s}s`;
}

// Silence unused-import warning if module shrinks.
void (null as CSSProperties | null);
