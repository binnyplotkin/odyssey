"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Click-to-edit inline text. Renders a button (with the value) when idle;
 * swaps to an input + ✓ / ✗ buttons when editing.
 *
 * Commit triggers: ✓ click, Enter key. Cancel triggers: ✗ click, Escape key.
 * Blur does NOT commit — onMouseDown handlers on the action buttons fire
 * before the input's blur, but we still ignore the blur to keep behavior
 * predictable across mouse / keyboard / focus-traversal paths.
 *
 * The button uses the same box geometry as the input (padding + margin +
 * border-width never change), so toggling edit mode doesn't shift the
 * surrounding layout by a pixel.
 */
export type EditableTextProps = {
  value: string;
  onChange: (next: string) => void | Promise<void>;
  ariaLabel: string;
  /** Style applied to both states. The component handles background +
   * border-color swaps; everything else (font, color, size) comes from here. */
  style?: React.CSSProperties;
  maxLength?: number;
};

export function EditableText({
  value,
  onChange,
  ariaLabel,
  style,
  maxLength = 80,
}: EditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset draft when upstream value changes (e.g. live update from another
  // surface that edited the same field).
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // Focus + select on entering edit mode.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function commit() {
    const next = draft.trim();
    if (next && next !== value) {
      void onChange(next);
    } else {
      setDraft(value);
    }
    setEditing(false);
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  // Shared box geometry so the layout stays put across non-edit / hover /
  // edit states. Only border-color + background swap; padding + margin +
  // border-width never change.
  const boxStyle: React.CSSProperties = {
    borderRadius: "var(--radius-sm)",
    padding: "2px 6px",
    margin: "-2px -6px",
    borderStyle: "solid",
    borderWidth: 1,
  };

  if (editing) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-8)" }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          aria-label={ariaLabel}
          maxLength={maxLength}
          style={{
            ...style,
            ...boxStyle,
            background: "var(--control-bg)",
            borderColor: "var(--border)",
            outline: "none",
            color: "var(--foreground)",
            // boxStyle's negative right margin (which preserves the idle
            // button's text position) would pull the ✓ button closer than
            // the ✓↔✗ gap. Reset margin-right so all flex gaps are equal.
            marginRight: 0,
            // Width tracks the draft length in `ch` units so the input
            // hugs the content. We pad by 2ch to cover letter-spacing
            // accumulation (the `size` attribute would clip uppercase +
            // mono + tracked text). 8ch floor keeps short names usable.
            width: `${Math.max(draft.length + 2, 8)}ch`,
          }}
        />
        {/* onMouseDown so the click registers before the input's blur. */}
        <ActionButton
          ariaLabel={`Save ${ariaLabel.toLowerCase()}`}
          tone="confirm"
          onMouseDown={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </ActionButton>
        <ActionButton
          ariaLabel={`Cancel ${ariaLabel.toLowerCase()} edit`}
          tone="cancel"
          onMouseDown={(e) => {
            e.preventDefault();
            cancel();
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </ActionButton>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={`Edit ${ariaLabel.toLowerCase()}`}
      style={{
        ...style,
        ...boxStyle,
        background: "transparent",
        borderColor: "transparent",
        cursor: "text",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "transparent";
      }}
    >
      {value}
    </button>
  );
}

function ActionButton({
  children,
  ariaLabel,
  tone,
  onMouseDown,
}: {
  children: React.ReactNode;
  ariaLabel: string;
  tone: "confirm" | "cancel";
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const color = tone === "confirm" ? "var(--accent-strong)" : "var(--text-tertiary)";
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onMouseDown={onMouseDown}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        padding: 0,
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${tone === "confirm" ? "var(--accent-glow)" : "var(--border)"}`,
        background: tone === "confirm"
          ? "color-mix(in srgb, var(--accent-strong) 12%, transparent)"
          : "transparent",
        color,
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}
