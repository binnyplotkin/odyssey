"use client";

import { useRef, type ChangeEvent, type ClipboardEvent, type Ref } from "react";

export type PdfUploadState =
  | { status: "idle" }
  | { status: "extracting"; filename: string }
  | { status: "loaded"; filename: string; pages: number; chars: number }
  | { status: "error"; filename: string; error: string };

/**
 * Source composer — Section 01 of the wiki ingestion flow.
 *
 * Eyebrow on top, a bordered card below with a right-aligned token meter,
 * and a multi-line textarea with a quiet empty-state caret.
 *
 * Self-contained: depends on CSS variables (`--accent-strong`, `--border`,
 * `--border-subtle`, `--text-*`) from the admin theme, but holds no other coupling
 * to the ingestion view, so it can be lifted into other paste-based flows.
 */

const FONT_BODY = "var(--font-body, Inter), system-ui, sans-serif";
const FONT_MONO =
  "var(--font-mono, 'JetBrains Mono'), ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";

const SOURCE_FOCUS_CSS = `
  .ingestion-source-input:focus-within {
    border-color: var(--accent-border) !important;
    box-shadow: var(--ring-shadow-selected);
  }

  @keyframes ingestion-source-caret-blink {
    0%, 45% { opacity: 1; }
    46%, 100% { opacity: 0; }
  }

  .ingestion-source-empty-caret {
    animation: ingestion-source-caret-blink 1.08s steps(1, end) infinite;
  }
`;

export type SourceComposerProps = {
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

  /** Eyebrow override — defaults to `source`. */
  stepLabel?: string;

  /** When provided, shows an "Upload PDF" control; called with the picked file. */
  onSelectPdf?: (file: File) => void;
  /** Upload/extract status, rendered as a file chip. */
  pdfState?: PdfUploadState;
};

export function SourceComposer({
  value,
  onChange,
  onPaste,
  textareaRef,
  tokens,
  maxTokens = 120_000,
  stepLabel = "source",
  onSelectPdf,
  pdfState,
}: SourceComposerProps) {
  const tokenCeiling = `${Math.round(maxTokens / 1000)}k`;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const extracting = pdfState?.status === "extracting";

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so re-selecting the same file re-fires onChange.
    e.target.value = "";
    if (file && onSelectPdf) onSelectPdf(file);
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-14)" }}>
      <style>{SOURCE_FOCUS_CSS}</style>
      <header
        style={{
          display: "flex",
          alignItems: "center",
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
          {stepLabel}
        </span>
        {onSelectPdf && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={extracting}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "5px 12px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--control-border)",
                background: "var(--control-bg)",
                color: "var(--text-secondary)",
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: extracting ? "default" : "pointer",
                opacity: extracting ? 0.6 : 1,
              }}
            >
              {extracting ? "Extracting…" : "↑ Upload PDF"}
            </button>
          </>
        )}
      </header>

      <div
        className="ingestion-source-input"
        data-ingestion-source-shell
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--control-border)",
          borderRadius: "var(--radius-lg)",
          background: "var(--control-bg)",
          overflow: "hidden",
          transition: "border-color 140ms ease, box-shadow 140ms ease",
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
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-quaternary)",
          }}
        >
          {tokens.toLocaleString()} / ~{tokenCeiling} tokens
        </span>

        {pdfState && pdfState.status !== "idle" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 18px",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <span
              aria-hidden
              style={{ fontFamily: FONT_MONO, color: ACCENT }}
            >
              ▤
            </span>
            <span
              style={{
                fontFamily: FONT_BODY,
                fontSize: "var(--font-size-sm)",
                fontWeight: 600,
                color: "var(--text-primary)",
                maxWidth: "46%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {pdfState.filename}
            </span>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color:
                  pdfState.status === "error"
                    ? "var(--status-error)"
                    : "var(--text-tertiary)",
              }}
            >
              {pdfState.status === "extracting" && "extracting…"}
              {pdfState.status === "loaded" &&
                `text extracted · ${pdfState.pages} ${
                  pdfState.pages === 1 ? "page" : "pages"
                } · ~${Math.round(pdfState.chars / 1000)}k chars`}
              {pdfState.status === "error" && `failed — ${pdfState.error}`}
            </span>
          </div>
        )}

        <div
          style={{
            position: "relative",
            padding: "28px 28px 32px",
            minHeight: 380,
          }}
        >
          {value.length === 0 && (
            <span
              className="ingestion-source-empty-caret"
              aria-hidden
              style={{
                position: "absolute",
                top: 31,
                left: 28,
                width: 1,
                height: "var(--font-size-lg)",
                borderRadius: "var(--radius-pill)",
                background: ACCENT,
                opacity: 0.9,
              }}
            />
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
              minHeight: 310,
              padding: 0,
              border: "none",
              background: "transparent",
              color: "var(--text-primary)",
              caretColor: ACCENT,
              fontFamily: FONT_BODY,
              fontSize: "var(--font-size-lg)",
              lineHeight: 1.62,
              resize: "vertical",
              outline: "none",
            }}
          />
        </div>
      </div>
    </section>
  );
}
