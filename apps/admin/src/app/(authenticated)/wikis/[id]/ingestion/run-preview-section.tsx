"use client";

import { type ReactNode } from "react";
import { MODELS, estimateCost, type ModelId } from "@odyssey/wiki-ingest";

/**
 * Run preview section — Step 04 of the wiki ingestion flow.
 *
 * Outcome-framed: answers "what's about to happen?" before the user commits
 * to Feed the engine. Four columns of projected stats (cost / duration /
 * chunks / new pages) with a header status pill that calls out the
 * destination wiki and gates the action button.
 *
 * Numbers are heuristics for now — output tokens estimated at 40% of input,
 * chunks at ~512 tok each, pages at roughly half the chunks (multi-chunk
 * merging is common), and edges at ~3.5 per page. The pipeline can swap in
 * a real estimate later without touching the consumer.
 */

const FONT_MONO = "var(--font-mono, 'JetBrains Mono'), ui-monospace, monospace";
const FONT_HEAD = "var(--font-body, Inter), system-ui, sans-serif";
const ACCENT = "var(--accent-strong)";

const CHUNK_TOKEN_BUDGET = 512;
const OUTPUT_RATIO = 0.4;
const PAGES_PER_CHUNK = 0.5;
const EDGES_PER_PAGE = 3.5;

export type RunPreviewSectionProps = {
  tokens: number;
  model: ModelId;
  wikiTitle: string;
  canRun: boolean;
  stepLabel?: string;
};

export function RunPreviewSection({
  tokens,
  model,
  wikiTitle,
  canRun,
  stepLabel = "run preview",
}: RunPreviewSectionProps) {
  const outputTokens = Math.max(0, Math.round(tokens * OUTPUT_RATIO));
  const cost = estimateCost(model, tokens, outputTokens);
  const inputCost = (tokens / 1_000_000) * MODELS[model].inPerMTok;
  const outputCost = (outputTokens / 1_000_000) * MODELS[model].outPerMTok;
  const seconds = Math.max(3, Math.round(tokens / 2000));
  const chunks = Math.max(0, Math.ceil(tokens / CHUNK_TOKEN_BUDGET));
  const pages = Math.max(0, Math.ceil(chunks * PAGES_PER_CHUNK));
  const edges = Math.round(pages * EDGES_PER_PAGE);
  const opCount = Math.max(1, chunks + 2);
  const msPerOp = opCount === 0 ? 0 : Math.round((seconds * 1000) / opCount);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 22,
          paddingBottom: 0,
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          {stepLabel}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "3px 8px",
            border: "1px solid color-mix(in srgb, var(--border) 62%, transparent)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: canRun ? "var(--text-secondary)" : "var(--text-tertiary)",
          }}
        >
          <Dot
            color={canRun ? ACCENT : "var(--text-placeholder)"}
            glow={canRun}
          />
          {canRun ? `writes to ${wikiTitle}` : "waiting for source + title"}
        </span>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 0,
          border: "1px solid color-mix(in srgb, var(--border) 58%, transparent)",
          background: "color-mix(in srgb, var(--card) 58%, transparent)",
          opacity: 0.78,
        }}
      >
        <Stat
          label="Est. cost"
          value={formatCost(cost)}
          detail={`${formatCost(inputCost)} in · ${formatCost(outputCost)} out`}
        />
        <Stat
          label="Duration"
          value={`~${seconds} sec`}
          detail={`${opCount} ops · ~${msPerOp}ms each`}
        />
        <Stat
          label="Chunks"
          value={chunks.toLocaleString()}
          detail={`~${CHUNK_TOKEN_BUDGET} tok each`}
        />
        <Stat
          label="New pages"
          value={`+${pages}`}
          detail={`est. +${edges} edges`}
          accent
        />
      </div>
    </section>
  );
}

/* ── Sub-components ───────────────────────────────────────────── */

function Stat({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        padding: "11px 14px",
        borderRight: "1px solid color-mix(in srgb, var(--divider) 64%, transparent)",
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
          fontSize: 15,
          fontWeight: 600,
          letterSpacing: 0,
          color: accent ? ACCENT : "var(--text-primary)",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-2xs)",
          color: "var(--text-tertiary)",
        }}
      >
        {detail}
      </span>
    </div>
  );
}

function Dot({ color, glow }: { color: string; glow: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "var(--radius-pill)",
        background: color,
        boxShadow: glow ? `0 0 6px ${color}` : undefined,
        flexShrink: 0,
      }}
    />
  );
}

function formatCost(value: number): string {
  if (value <= 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}
