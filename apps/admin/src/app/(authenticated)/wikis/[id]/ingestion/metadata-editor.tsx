"use client";

import { type CSSProperties, type ReactNode } from "react";
import { EnumMenu, type EnumMenuOption } from "./enum-menu";

/**
 * Metadata editor — Section 02 of the wiki ingestion flow.
 *
 * Eyebrow + classifier status on top, then a 2-column row (source title +
 * kind dropdown), then a tags chip row. Mirrors the Paper V1 direction:
 * sharp-cornered terminal chrome throughout, with the AI classifier surfaced
 * as a two-segment status/action control on the trailing edge of the header.
 *
 * Self-contained: depends only on CSS variables from the admin theme. Generic
 * over the kind enum so callers can pass their own narrow union without
 * losing type safety on `onKindChange`.
 */

const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";
const ACCENT_SOFT = "var(--accent-soft)";
const ACCENT_LINE = "color-mix(in srgb, var(--accent-strong) 30%, transparent)";
const DANGER = "var(--danger)";

// Placeholder text matches the Section 1 ghost overlay (rgba 255/255/255 .15).
// Inline `style` can't target ::placeholder, so we inject a scoped rule.
const PLACEHOLDER_CSS = `
  .ingestion-metadata-input::placeholder {
    color: var(--text-placeholder);
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
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <style>{PLACEHOLDER_CSS}</style>
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
          gridTemplateColumns: "1.5fr 1fr",
          gap: 14,
        }}
      >
        <FieldLabel label="Source title">
          <input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="e.g. KJV · the binding (ch. 22)"
            className="ingestion-metadata-input"
            style={inputStyle()}
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
      </div>

      <FieldLabel
        label="Tags · feed the page frontmatter"
        trailing="⌘K · suggestions"
      >
        <TagsField tags={tags} onTagsChange={onTagsChange} />
      </FieldLabel>
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
        style={{ display: "inline-flex", alignItems: "stretch", height: 24 }}
      >
        <StatusChip
          dot={<Dot color={DANGER} />}
          text={`failed · ${classifyError.slice(0, 60)}`}
          color={DANGER}
          attached
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
        style={{ display: "inline-flex", alignItems: "stretch", height: 24 }}
      >
        <StatusChip
          dot={<Dot color={ACCENT} glow />}
          text="Haiku · auto-filled"
          attached
        />
        {onRegenerate && (
          <ActionButton
            onClick={onRegenerate}
            disabled={!canRegenerate}
            label="Regenerate"
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
        height: 24,
        border: "1px solid var(--border)",
        borderRight: attached ? "none" : "1px solid var(--border)",
        fontFamily: FONT_MONO,
        fontSize: 10,
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
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "0 12px",
        height: 24,
        background: disabled ? "transparent" : ACCENT_SOFT,
        border: `1px solid ${disabled ? "var(--border)" : ACCENT_LINE}`,
        color: disabled ? "var(--text-placeholder)" : color,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: FONT_MONO,
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}
    >
      <RegenerateIcon color={disabled ? "var(--text-placeholder)" : color} />
      {label}
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

function PulseDot({ color }: { color: string }) {
  return (
    <>
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: 999,
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
}: {
  label: string;
  trailing?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          fontFamily: FONT_MONO,
          fontSize: 10,
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

function inputStyle(): CSSProperties {
  return {
    width: "100%",
    padding: "8px 12px",
    border: "1px solid var(--border)",
    background: "var(--card)",
    color: "var(--text-primary)",
    fontFamily: FONT_MONO,
    fontSize: 12,
    outline: "none",
  };
}

/* ── Tags field ───────────────────────────────────────────────── */

function TagsField({
  tags,
  onTagsChange,
}: {
  tags: string[];
  onTagsChange: (next: string[]) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        border: "1px solid var(--border)",
        background: "var(--card)",
        minHeight: 36,
      }}
    >
      {tags.map((t) => (
        <span
          key={t}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "2px 8px",
            background: ACCENT_SOFT,
            border: `1px solid ${ACCENT_LINE}`,
            fontFamily: FONT_MONO,
            fontSize: 11,
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
              fontSize: 12,
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
        fontFamily: FONT_MONO,
        fontSize: 11,
        outline: "none",
      }}
    />
  );
}
