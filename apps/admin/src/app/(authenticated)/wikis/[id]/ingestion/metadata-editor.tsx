"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { EnumMenu, type EnumMenuOption } from "./enum-menu";

/**
 * Metadata editor — Section 02 of the wiki ingestion flow.
 *
 * Eyebrow + classifier status on top, then source title / kind controls,
 * followed by a dedicated tags row.
 *
 * Self-contained: depends only on CSS variables from the admin theme. Generic
 * over the kind enum so callers can pass their own narrow union without
 * losing type safety on `onKindChange`.
 */

const FONT_BODY = "var(--font-body, Inter), system-ui, sans-serif";
const FONT_MONO =
  "var(--font-mono, 'JetBrains Mono'), ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";
const ACCENT_SOFT = "var(--accent-soft)";
const ACCENT_LINE =
  "color-mix(in srgb, var(--accent-strong) 30%, transparent)";
const DANGER = "var(--status-error)";
const ACTIVE_RING =
  "0 0 0 3px color-mix(in srgb, var(--accent-strong) 22%, transparent)";

// Inline `style` can't target ::placeholder, so this keeps placeholder copy
// on the global token used by the source ghost and other form controls.
const PLACEHOLDER_CSS = `
  .ingestion-metadata-input::placeholder {
    color: var(--text-placeholder);
  }
  .ingestion-metadata-input:focus {
    border-color: var(--accent-border) !important;
    box-shadow: var(--ring-shadow-selected);
  }
  .ingestion-tags-field:focus-within {
    border-color: var(--accent-border) !important;
    box-shadow: var(--ring-shadow-selected);
  }
`;

export type MetadataKindOption<K extends string> = EnumMenuOption<K>;

export type MetadataEditorProps<K extends string> = {
  title: string;
  onTitleChange: (next: string) => void;

  kind: K;
  onKindChange: (next: K) => void;
  kindOptions: MetadataKindOption<K>[];

  tags: string[];
  onTagsChange: (next: string[]) => void;

  /** Classifier pass-through (matches the host's existing flags). */
  classifying?: boolean;
  classifiedBy?: "ai" | null;
  classifyError?: string | null;
  canRegenerate?: boolean;
  onRegenerate?: () => void;

  stepLabel?: string;
};

export function MetadataEditor<K extends string>({
  title,
  onTitleChange,
  kind,
  onKindChange,
  kindOptions,
  tags,
  onTagsChange,
  classifying = false,
  classifiedBy = null,
  classifyError = null,
  canRegenerate = false,
  onRegenerate,
  stepLabel = "metadata",
}: MetadataEditorProps<K>) {
  const [titleFocused, setTitleFocused] = useState(false);
  const [tagsFocused, setTagsFocused] = useState(false);

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
        paddingTop: "var(--space-2)",
      }}
    >
      <style>{PLACEHOLDER_CSS}</style>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-24)",
          flexWrap: "wrap",
          rowGap: "var(--space-10)",
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
        <ClassifierStatus
          classifying={classifying}
          classifiedBy={classifiedBy}
          classifyError={classifyError}
          canRegenerate={canRegenerate}
          onRegenerate={onRegenerate}
        />
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(260px, 1fr) minmax(142px, 220px)",
          gap: "var(--space-10)",
          alignItems: "end",
        }}
      >
        <FieldLabel label="Source title">
          <input
            data-ingestion-title-input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            onPointerDown={() => setTitleFocused(true)}
            onFocus={() => setTitleFocused(true)}
            onBlur={() => setTitleFocused(false)}
            placeholder="e.g. KJV · the binding (ch. 22)"
            className="ingestion-metadata-input"
            style={inputStyle(titleFocused)}
          />
        </FieldLabel>
        <FieldLabel label="Kind">
          <EnumMenu
            value={kind}
            onChange={onKindChange}
            options={kindOptions}
            ariaLabel="Source kind"
          />
        </FieldLabel>
        <FieldLabel label="Tags" trailing="frontmatter" style={{ gridColumn: "1 / -1" }}>
          <TagsField
            tags={tags}
            focused={tagsFocused}
            onFocusChange={setTagsFocused}
            onTagsChange={onTagsChange}
          />
        </FieldLabel>
      </div>
    </section>
  );
}

/* ── Classifier status (two-segment terminal control) ─────────── */

function ClassifierStatus({
  classifying,
  classifiedBy,
  classifyError,
  canRegenerate,
  onRegenerate,
}: {
  classifying: boolean;
  classifiedBy: "ai" | null;
  classifyError: string | null;
  canRegenerate: boolean;
  onRegenerate?: () => void;
}) {
  if (classifying) {
    return (
      <StatusChip
        dot={<PulseDot color={ACCENT} />}
        text="classifying…"
        color={ACCENT}
      />
    );
  }

  if (classifyError) {
    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "stretch",
          gap: "var(--space-6)",
          height: 22,
        }}
      >
        <StatusChip
          dot={<Dot color={DANGER} />}
          text={`failed · ${classifyError.slice(0, 60)}`}
          color={DANGER}
        />
        {canRegenerate && onRegenerate && (
          <ActionButton onClick={onRegenerate} label="Retry" color={DANGER} />
        )}
      </div>
    );
  }

  if (classifiedBy === "ai") {
    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "stretch",
          gap: "var(--space-6)",
          height: 22,
        }}
      >
        <StatusChip
          dot={<Dot color={ACCENT} glow />}
          text="Haiku · auto-filled"
        />
        {onRegenerate && (
          <IconActionButton
            onClick={onRegenerate}
            disabled={!canRegenerate}
            ariaLabel="Regenerate metadata"
          />
        )}
      </div>
    );
  }

  if (canRegenerate && onRegenerate) {
    return (
      <ActionButton
        onClick={onRegenerate}
        label="✦ auto-fill title, kind, tags"
      />
    );
  }

  return null;
}

function StatusChip({
  dot,
  text,
  color = "var(--text-secondary)",
  attached = false,
}: {
  dot: ReactNode;
  text: string;
  color?: string;
  attached?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "0 10px",
        height: 22,
        border: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
        borderRight: attached
          ? "none"
          : "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
        borderRadius: attached
          ? "var(--radius-pill) 0 0 var(--radius-pill)"
          : "var(--radius-pill)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color,
      }}
    >
      {dot}
      {text}
    </span>
  );
}

function ActionButton({
  onClick,
  label,
  disabled = false,
  color = ACCENT,
  attached = false,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  color?: string;
  attached?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-6)",
        padding: "0 12px",
        height: 22,
        background: disabled ? "transparent" : ACCENT_SOFT,
        border: `1px solid ${disabled ? "var(--border)" : ACCENT_LINE}`,
        borderRadius: attached
          ? "0 var(--radius-pill) var(--radius-pill) 0"
          : "var(--radius-pill)",
        color: disabled ? "var(--text-placeholder)" : color,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}
    >
      <RegenerateIcon color={disabled ? "var(--text-placeholder)" : color} />
      {label}
    </button>
  );
}

function IconActionButton({
  onClick,
  disabled = false,
  ariaLabel,
  color = ACCENT,
}: {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  color?: string;
}) {
  const iconColor = disabled ? "var(--text-placeholder)" : color;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 22,
        padding: 0,
        background: disabled ? "transparent" : ACCENT_SOFT,
        border: `1px solid ${disabled ? "var(--border)" : ACCENT_LINE}`,
        borderRadius: "var(--radius-pill)",
        color: iconColor,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <RegenerateIcon color={iconColor} />
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
        borderRadius: "var(--radius-pill)",
        background: color,
        boxShadow: glow ? `0 0 6px ${color}` : undefined,
        flexShrink: 0,
      }}
    />
  );
}

function PulseDot({ color }: { color: string }) {
  return (
    <>
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: "var(--radius-pill)",
          background: color,
          animation: "pulse 1.1s ease-in-out infinite",
          flexShrink: 0,
        }}
      />
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}`}</style>
    </>
  );
}

function RegenerateIcon({ color }: { color: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
      <path
        d="M1.5 5.5a4 4 0 016.8-2.8L10 4.2M9.5 5.5a4 4 0 01-6.8 2.8L1 6.8"
        stroke={color}
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M10 1.5v2.7H7.3M1 9.5V6.8h2.7"
        stroke={color}
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Field shell + inputs ─────────────────────────────────────── */

function FieldLabel({
  label,
  trailing,
  children,
  style,
}: {
  label: string;
  trailing?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        <span>{label}</span>
        {trailing && (
          <span style={{ color: "var(--text-placeholder)" }}>{trailing}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function inputStyle(focused = false): CSSProperties {
  return {
    width: "100%",
    height: 34,
    padding: "0 11px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: focused ? ACCENT_LINE : "var(--control-border)",
    borderRadius: "var(--radius-md)",
    background: "var(--control-bg)",
    boxShadow: focused ? ACTIVE_RING : undefined,
    color: "var(--text-primary)",
    fontFamily: FONT_BODY,
    fontSize: "var(--font-size-base)",
    outline: "none",
    transition: "border-color 140ms ease, box-shadow 140ms ease",
  };
}

/* ── Tags field ───────────────────────────────────────────────── */

function TagsField({
  tags,
  focused,
  onFocusChange,
  onTagsChange,
}: {
  tags: string[];
  focused: boolean;
  onFocusChange: (next: boolean) => void;
  onTagsChange: (next: string[]) => void;
}) {
  return (
    <div
      className="ingestion-tags-field"
      data-ingestion-tags-field
      onPointerDownCapture={() => onFocusChange(true)}
      onFocusCapture={() => onFocusChange(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          onFocusChange(false);
        }
      }}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-6)",
        padding: "5px 10px",
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: focused ? ACCENT_LINE : "var(--control-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--control-bg)",
        boxShadow: focused ? ACTIVE_RING : undefined,
        minHeight: 34,
        transition: "border-color 140ms ease, box-shadow 140ms ease",
      }}
    >
      {tags.map((t) => (
        <span
          key={t}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-5)",
            padding: "1px 7px",
            background: ACCENT_SOFT,
            border: `1px solid ${ACCENT_LINE}`,
            borderRadius: "var(--radius-pill)",
            fontFamily: FONT_BODY,
            fontSize: "var(--font-size-xs)",
            color: ACCENT,
          }}
        >
          {t}
          <button
            type="button"
            onClick={() => onTagsChange(tags.filter((x) => x !== t))}
            style={{
              background: "transparent",
              border: "none",
              color: ACCENT,
              cursor: "pointer",
              padding: 0,
              fontSize: "var(--font-size-base)",
              opacity: 0.7,
              lineHeight: 1,
            }}
            aria-label={`Remove tag ${t}`}
          >
            ×
          </button>
        </span>
      ))}
      <TagDraftInput tags={tags} onTagsChange={onTagsChange} />
    </div>
  );
}

function TagDraftInput({
  tags,
  onTagsChange,
}: {
  tags: string[];
  onTagsChange: (next: string[]) => void;
}) {
  return (
    <input
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== ",") return;
        e.preventDefault();
        const raw = e.currentTarget.value.trim().toLowerCase();
        if (!raw || tags.includes(raw)) {
          e.currentTarget.value = "";
          return;
        }
        onTagsChange([...tags, raw]);
        e.currentTarget.value = "";
      }}
      placeholder="+ add tag"
      className="ingestion-metadata-input"
      style={{
        flex: 1,
        minWidth: 100,
        border: "none",
        background: "transparent",
        color: "var(--text-primary)",
        fontFamily: FONT_BODY,
        fontSize: "var(--font-size-xs)",
        outline: "none",
      }}
    />
  );
}
