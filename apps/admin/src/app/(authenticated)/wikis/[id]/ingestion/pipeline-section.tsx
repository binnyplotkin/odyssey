"use client";

import { type CSSProperties, type ReactNode } from "react";
import { MODELS, type ModelId } from "@odyssey/wiki-ingest";

/**
 * Pipeline section — Step 03 of the wiki ingestion flow.
 *
 * Promotes the runtime config to a peer of Source / Metadata: eyebrow +
 * status pill on top, then three field columns (prompt template / model /
 * embeddings). The prompt column carries an explicit "Edit" button that
 * opens the prompt-overlay editor; the other two are visual pickers ready
 * to be wired to EnumMenu once the data layer exposes a swap list.
 *
 * Self-contained: depends only on CSS variables from the admin theme and
 * the wiki-ingest MODELS registry (read-only, for the model sub-detail).
 */

const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";
const ACCENT_LINE = "color-mix(in srgb, var(--accent-strong) 40%, transparent)";
const ACCENT_FILL = "var(--accent-soft)";

const PROMPT_DOT = "#8CE7D2";
const MODEL_DOT = "#A48CE7";
const EMBED_DOT = "#E7CB8C";

export type PipelineSectionProps = {
  promptLabel: string;
  promptVersion: string;
  promptTokens: number;
  model: ModelId;
  /** Defaults to "text-embedding-3-large". */
  embeddings?: string;
  /** Defaults to "3072 dims · pgvector cosine". */
  embeddingsDetail?: string;
  /** Opens the prompt editor (existing PromptOverlay). */
  onEditPrompt: () => void;
  /** Step number override (defaults to "03"). */
  /** Step label override (defaults to "pipeline"). */
  stepLabel?: string;
  /** Status pill copy (defaults to "defaults from wiki settings"). */
  statusLabel?: string;
};

export function PipelineSection({
  promptLabel,
  promptVersion,
  promptTokens,
  model,
  embeddings = "text-embedding-3-large",
  embeddingsDetail = "3072 dims · pgvector cosine",
  onEditPrompt,
  stepLabel = "pipeline",
  statusLabel = "defaults from wiki settings",
}: PipelineSectionProps) {
  const modelMeta = MODELS[model];
  const modelDetail = `$${modelMeta.inPerMTok} / Mtok · ${Math.round(modelMeta.context / 1000)}k context`;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 22,
          paddingBottom: 8,
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: ACCENT,
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
            border: "1px solid var(--border)",
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          <Dot color={ACCENT} glow />
          {statusLabel}
        </span>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1.4fr",
          gap: 14,
          alignItems: "start",
        }}
      >
        <Column
          label="Prompt template"
          shortcut="⌘P"
          detail={`${promptTokens} tokens · ${promptVersion}`}
        >
          <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <PickerVisual
                dot={PROMPT_DOT}
                value={`${promptLabel} ${promptVersion}`.trim()}
              />
            </div>
            <EditButton onClick={onEditPrompt} />
          </div>
        </Column>

        <Column label="Model" shortcut="⌘M" detail={modelDetail}>
          <PickerVisual dot={MODEL_DOT} value={model} />
        </Column>

        <Column label="Embeddings" shortcut="⌘E" detail={embeddingsDetail}>
          <PickerVisual dot={EMBED_DOT} value={embeddings} />
        </Column>
      </div>
    </section>
  );
}

/* ── Sub-components ───────────────────────────────────────────── */

function Column({
  label,
  shortcut,
  detail,
  children,
}: {
  label: string;
  shortcut?: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ color: "var(--text-tertiary)" }}>{label}</span>
        {shortcut && (
          <span style={{ color: "var(--text-placeholder)" }}>{shortcut}</span>
        )}
      </div>
      {children}
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: "var(--text-tertiary)",
        }}
      >
        {detail}
      </span>
    </div>
  );
}

function PickerVisual({ dot, value }: { dot: string; value: string }) {
  return (
    <div style={pickerStyle()}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        <Dot color={dot} />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </span>
      </span>
      <Chevron />
    </div>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "0 12px",
        height: 36,
        background: ACCENT_FILL,
        border: `1px solid ${ACCENT_LINE}`,
        color: ACCENT,
        cursor: "pointer",
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        flexShrink: 0,
      }}
    >
      <PencilIcon />
      Edit
    </button>
  );
}

function Dot({ color, glow = false }: { color: string; glow?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: 999,
        background: color,
        boxShadow: glow ? `0 0 6px ${color}` : undefined,
        flexShrink: 0,
      }}
    />
  );
}

function Chevron() {
  return (
    <svg
      width="9"
      height="6"
      viewBox="0 0 9 6"
      fill="none"
      aria-hidden
      style={{ color: "var(--text-placeholder)", flexShrink: 0 }}
    >
      <path
        d="M1 1l3.5 3.5L8 1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M8.5 1.5l2 2L4 10H2v-2L8.5 1.5z"
        stroke={ACCENT}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M7.5 2.5l2 2" stroke={ACCENT} strokeWidth="1" />
    </svg>
  );
}

/* ── Styles ───────────────────────────────────────────────────── */

function pickerStyle(): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    padding: "8px 12px",
    height: 36,
    border: "1px solid var(--border)",
    background: "var(--card)",
    fontFamily: FONT_MONO,
    fontSize: 12,
    color: "var(--text-primary)",
    overflow: "hidden",
  };
}
