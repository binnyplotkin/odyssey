"use client";

import { type ClipboardEvent, type CSSProperties, type Ref } from "react";

/**
 * Source composer — Section 01 of the wiki ingestion flow.
 *
 * Eyebrow + mode-tabs row on top, a bordered card below with a right-aligned
 * token meter, a multi-line textarea (with a ghost placeholder visible until
 * the user types), and a bottom options strip with a `↵ to ingest` hint.
 *
 * Self-contained: depends on CSS variables (`--accent-strong`, `--border`,
 * `--divider`, `--text-*`) from the admin theme, but holds no other coupling
 * to the ingestion view, so it can be lifted into other flows that want the
 * same paste / upload / fetch surface.
 */

export type SourceMode = "paste" | "upload" | "url";

export type SourcePreviewChunk = {
  index: number;
  text: string;
  tokens: number;
  chars: number;
};

const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";
const ACCENT_SOFT = "var(--accent-soft)";

export type SourceComposerProps = {
  /** Active input mode (paste / upload / url). */
  mode: SourceMode;
  onModeChange: (next: SourceMode) => void;

  /** Textarea content. */
  value: string;
  onChange: (next: string) => void;

  /** Optional paste handler — fires on the textarea's onPaste. */
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void;

  /** Ref to the underlying textarea, e.g. for post-paste value reads. */
  textareaRef?: Ref<HTMLTextAreaElement>;

  /** Approx token count for the current `value`. Displayed top-right. */
  tokens: number;
  /** Token ceiling, displayed as `~{maxTokens / 1000}k`. Default 120000. */
  maxTokens?: number;

  /** Multi-line hint shown behind the textarea when `value` is empty. */
  ghostSample?: string;

  /** Show the client-side chunk preview panel. */
  chunkPreviewEnabled: boolean;
  onChunkPreviewChange: (next: boolean) => void;

  /** Normalize source whitespace before estimates/classification/run. */
  normalizeWhitespace: boolean;
  onNormalizeWhitespaceChange: (next: boolean) => void;

  /** Preview chunks derived from the effective source text. */
  previewChunks: SourcePreviewChunk[];
  normalizedCharDelta?: number;

  /** Eyebrow override — defaults to `source`. */
  stepLabel?: string;
};

export function SourceComposer({
  mode,
  onModeChange,
  value,
  onChange,
  onPaste,
  textareaRef,
  tokens,
  maxTokens = 120_000,
  ghostSample,
  chunkPreviewEnabled,
  onChunkPreviewChange,
  normalizeWhitespace,
  onNormalizeWhitespaceChange,
  previewChunks,
  normalizedCharDelta = 0,
  stepLabel = "source",
}: SourceComposerProps) {
  const tokenCeiling = `${Math.round(maxTokens / 1000)}k`;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
          flexWrap: "wrap",
          rowGap: 14,
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
        <PillToggle
          value={mode}
          onChange={onModeChange}
          options={[
            { value: "paste", label: "paste" },
            { value: "upload", label: "upload file", disabled: true },
            { value: "url", label: "fetch url", disabled: true },
          ]}
        />
      </header>

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          background: "var(--card)",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 14,
            right: 18,
            zIndex: 1,
            pointerEvents: "none",
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          {tokens.toLocaleString()} / ~{tokenCeiling} tokens
        </span>

        <div
          style={{
            position: "relative",
            padding: "22px 22px 26px",
            minHeight: 260,
          }}
        >
          {value.length === 0 && ghostSample && (
            <pre
              aria-hidden
              style={{
                position: "absolute",
                inset: "22px 22px 26px",
                margin: 0,
                pointerEvents: "none",
                fontFamily: FONT_MONO,
                fontSize: 13,
                lineHeight: 1.55,
                color: "var(--text-placeholder)",
                whiteSpace: "pre-wrap",
              }}
            >
              {ghostSample}
            </pre>
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onPaste={onPaste}
            spellCheck={false}
            style={{
              position: "relative",
              width: "100%",
              minHeight: 220,
              padding: 0,
              border: "none",
              background: "transparent",
              color: "var(--text-secondary)",
              caretColor: ACCENT,
              fontFamily: FONT_MONO,
              fontSize: 13,
              lineHeight: 1.55,
              resize: "vertical",
              outline: "none",
            }}
          />
        </div>

        {chunkPreviewEnabled && (
          <ChunkPreview
            chunks={previewChunks}
            normalizeWhitespace={normalizeWhitespace}
            normalizedCharDelta={normalizedCharDelta}
          />
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 18,
            padding: "14px 18px",
            borderTop: "1px solid var(--divider)",
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: "var(--text-tertiary)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <OptionChip
              label="chunk preview"
              checked={chunkPreviewEnabled}
              onChange={onChunkPreviewChange}
            />
            <OptionChip
              label="normalize whitespace"
              checked={normalizeWhitespace}
              onChange={onNormalizeWhitespaceChange}
            />
          </div>
          <span>↵ to ingest</span>
        </div>
      </div>
    </section>
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */

function OptionChip({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: 0,
        border: "none",
        background: "transparent",
        color: "var(--muted)",
        cursor: "pointer",
        font: "inherit",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: 2,
          border: `1px solid ${checked ? ACCENT : "var(--text-placeholder)"}`,
          background: checked ? ACCENT_SOFT : "transparent",
          flexShrink: 0,
        }}
      />
      <span>{label}</span>
    </button>
  );
}

function ChunkPreview({
  chunks,
  normalizeWhitespace,
  normalizedCharDelta,
}: {
  chunks: SourcePreviewChunk[];
  normalizeWhitespace: boolean;
  normalizedCharDelta: number;
}) {
  const visible = chunks.slice(0, 12);
  const hidden = Math.max(0, chunks.length - visible.length);

  return (
    <div
      style={{
        borderTop: "1px solid var(--divider)",
        background: "var(--background)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
          padding: "12px 18px",
          borderBottom: "1px solid var(--divider)",
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        <span>{chunks.length.toLocaleString()} estimated chunks</span>
        <span>
          {normalizeWhitespace
            ? `${normalizedCharDelta >= 0 ? "+" : ""}${normalizedCharDelta.toLocaleString()} chars normalized`
            : "raw source"}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          maxHeight: 260,
          overflow: "auto",
        }}
      >
        {visible.length === 0 ? (
          <div
            style={{
              padding: "16px 18px",
              fontFamily: FONT_MONO,
              fontSize: 12,
              color: "var(--text-tertiary)",
            }}
          >
            paste source text to preview chunks
          </div>
        ) : (
          visible.map((chunk) => (
            <div
              key={chunk.index}
              style={{
                display: "grid",
                gridTemplateColumns: "88px minmax(0, 1fr)",
                gap: 14,
                padding: "12px 18px",
                borderBottom: "1px solid var(--divider)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  color: "var(--text-tertiary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                }}
              >
                <span style={{ color: ACCENT }}>
                  {String(chunk.index).padStart(2, "0")}
                </span>
                <span>{chunk.tokens.toLocaleString()} tok</span>
                <span>{chunk.chars.toLocaleString()} ch</span>
              </div>
              <pre
                style={{
                  margin: 0,
                  maxHeight: 72,
                  overflow: "hidden",
                  whiteSpace: "pre-wrap",
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: "var(--text-secondary)",
                }}
              >
                {chunk.text}
              </pre>
            </div>
          ))
        )}
        {hidden > 0 && (
          <div
            style={{
              padding: "10px 18px",
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
            }}
          >
            +{hidden.toLocaleString()} more chunks
          </div>
        )}
      </div>
    </div>
  );
}

function PillToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
}) {
  return (
    <div
      style={{
        display: "flex",
        padding: 2,
        gap: 2,
        background: "var(--card)",
        border: "1px solid var(--border)",
        fontFamily: FONT_MONO,
        fontSize: 10,
        flexShrink: 0,
      }}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={o.disabled}
            title={o.disabled ? "coming soon" : undefined}
            onClick={() => {
              if (!o.disabled) onChange(o.value);
            }}
            style={pillButtonStyle(active, !!o.disabled)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function pillButtonStyle(active: boolean, disabled: boolean): CSSProperties {
  return {
    padding: "4px 8px",
    border: "none",
    background: active ? ACCENT_SOFT : "transparent",
    color: disabled ? "var(--text-tertiary)" : active ? ACCENT : "var(--muted)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    whiteSpace: "nowrap",
  };
}
