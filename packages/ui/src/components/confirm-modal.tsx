"use client";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";

/* ── Types ──────────────────────────────────────────────────── */

export type ConfirmModalProps = {
  open: boolean;
  /** Called for Esc, backdrop click, or the Cancel button. */
  onClose: () => void;
  /** Async-safe — the modal will show `pendingLabel` while it resolves. */
  onConfirm: () => void | Promise<void>;
  /** Title in the header (e.g. "Delete voice?"). */
  title: string;
  /** Small subtitle under the title (e.g. "cannot be undone"). */
  subtitle?: string;
  /** Lede paragraph above the bullets. ReactNode so callers can bold names. */
  description?: ReactNode;
  /** Consequence bullets — each rendered with a red × glyph. */
  bullets?: ReactNode[];
  /** Soft-blue info banner at the bottom of the body (e.g. "Prefer Archive"). */
  hint?: ReactNode;
  /** Defaults to "confirm". */
  confirmLabel?: string;
  /** Defaults to "cancel". */
  cancelLabel?: string;
  /** "destructive" paints the confirm button red. Default "default" (mint). */
  tone?: "default" | "destructive";
  /** External pending flag (e.g. delete in flight). Disables both buttons. */
  pending?: boolean;
  /** Disable the confirm button without disabling cancel. */
  confirmDisabled?: boolean;
};

/* ── Tokens ─────────────────────────────────────────────────── */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_DISPLAY = "'Space Grotesk', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

/* ── Component ──────────────────────────────────────────────── */

export function ConfirmModal(props: ConfirmModalProps) {
  if (!props.open) return null;
  return <ConfirmModalInner {...props} />;
}

function ConfirmModalInner({
  onClose,
  onConfirm,
  title,
  subtitle,
  description,
  bullets,
  hint,
  confirmLabel = "confirm",
  cancelLabel = "cancel",
  tone = "default",
  pending = false,
  confirmDisabled = false,
}: ConfirmModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const destructive = tone === "destructive";

  const handleConfirm = useCallback(() => {
    if (pending || confirmDisabled) return;
    void onConfirm();
  }, [pending, confirmDisabled, onConfirm]);

  // Esc cancels, Enter confirms. Trap focus to the panel via tab.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!pending) onClose();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirm();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleConfirm, onClose, pending]);

  // Body scroll lock so the page doesn't drift behind the modal.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Move focus into the panel on open so Enter targets the confirm button.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const accent = destructive ? "#E8A0A0" : "var(--accent-strong)";
  const accentBorder = destructive
    ? "rgba(232,160,160,0.30)"
    : "color-mix(in srgb, var(--accent-strong) 30%, transparent)";
  const accentSoft = destructive
    ? "rgba(232,160,160,0.10)"
    : "color-mix(in srgb, var(--accent-strong) 10%, transparent)";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
      style={backdropStyle}
    >
      <div ref={panelRef} style={panelStyle(destructive)}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 16,
            padding: "24px 24px 8px 24px",
          }}
        >
          <div
            aria-hidden
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: 8,
              background: accentSoft,
              border: `1px solid ${accentBorder}`,
              flexShrink: 0,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke={accent}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
            <div
              id="confirm-modal-title"
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: "var(--text-primary)",
              }}
            >
              {title}
            </div>
            {subtitle && (
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: destructive
                    ? "rgba(232,160,160,0.75)"
                    : "var(--text-tertiary)",
                }}
              >
                {subtitle}
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        {(description || bullets || hint) && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              padding: "12px 24px 24px 24px",
            }}
          >
            {description && (
              <div
                style={{
                  fontFamily: FONT_HEAD,
                  fontSize: 13,
                  lineHeight: "20px",
                  color: "var(--text-secondary)",
                }}
              >
                {description}
              </div>
            )}

            {bullets && bullets.length > 0 && (
              <ul
                style={{
                  margin: 0,
                  padding: 0,
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {bullets.map((b, i) => (
                  <li
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      fontFamily: FONT_HEAD,
                      fontSize: 12,
                      lineHeight: "18px",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        flexShrink: 0,
                        color: accent,
                        fontFamily: FONT_MONO,
                      }}
                    >
                      ×
                    </span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}

            {hint && (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "10px 12px",
                  background:
                    "color-mix(in srgb, var(--accent-strong) 5%, transparent)",
                  border:
                    "1px solid color-mix(in srgb, var(--accent-strong) 18%, transparent)",
                  borderRadius: 6,
                  fontFamily: FONT_HEAD,
                  fontSize: 11,
                  lineHeight: "16px",
                  color: "var(--text-secondary)",
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--accent-strong)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flexShrink: 0, marginTop: 1 }}
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>{hint}</span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "16px 24px",
            borderTop: "1px solid var(--divider)",
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: "0.12em",
              color: "var(--text-quaternary)",
            }}
          >
            <span style={{ color: "var(--text-tertiary)" }}>esc</span> cancel
            <span style={{ margin: "0 6px" }}>·</span>
            <span style={{ color: "var(--text-tertiary)" }}>↵</span> confirm
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
                fontFamily: FONT_HEAD,
                fontSize: 12,
                fontWeight: 600,
                cursor: pending ? "progress" : "pointer",
                opacity: pending ? 0.6 : 1,
              }}
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmRef}
              type="button"
              onClick={handleConfirm}
              disabled={pending || confirmDisabled}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "8px 16px",
                borderRadius: 8,
                background: accent,
                border: `1px solid ${accent}`,
                color: destructive ? "#0A0A0A" : "var(--background)",
                fontFamily: FONT_HEAD,
                fontSize: 12,
                fontWeight: 600,
                cursor:
                  pending || confirmDisabled ? "not-allowed" : "pointer",
                opacity: pending || confirmDisabled ? 0.6 : 1,
              }}
            >
              {pending ? "…" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  background: "rgba(0,0,0,0.55)",
  backdropFilter: "blur(2px)",
};

function panelStyle(destructive: boolean): CSSProperties {
  return {
    width: 440,
    maxWidth: "100%",
    display: "flex",
    flexDirection: "column",
    background: "var(--background)",
    border: `1px solid ${destructive ? "rgba(232,160,160,0.30)" : "var(--border)"}`,
    borderRadius: 12,
    boxShadow: "0 24px 64px rgba(0,0,0,0.75)",
  };
}
