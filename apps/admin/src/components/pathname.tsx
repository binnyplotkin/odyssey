"use client";

import Link from "next/link";
import { Fragment } from "react";
import { EditableText } from "@/components/editable-text";

/**
 * Pathname — reusable breadcrumb in the locked phosphor/terminal style.
 * Renders mono uppercase segments separated by quartet slashes.
 * Each segment is a `<Link>` so any level of the path can be navigated
 * back to with a single click; the last segment is rendered as bold
 * primary-color text (no chrome), surfacing the active context purely
 * through type contrast against the muted siblings.
 *
 * Pages compose segments explicitly — we don't auto-parse the URL so the
 * displayed segment labels can differ from the URL slug (e.g. show a
 * character title where the URL has the slug).
 *
 * The final segment can opt into inline rename by passing `editable` —
 * see PathnameSegment. The tag styling stays the same; click swaps to an
 * input + ✓ / ✗ buttons.
 *
 * Example:
 *   <Pathname segments={[
 *     { label: "characters", href: "/characters" },
 *     { label: "abraham", href: "/characters/abraham" },
 *     { label: "sandbox", href: "/characters/abraham/sandbox", tag: true },
 *   ]} />
 */

const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

export type PathnameSegment = {
  /** The visible label. Rendered in lowercase by the component's
   * `textTransform`, so pass the natural casing — the component will
   * uppercase it for display. */
  label: string;
  /** Destination for the Link wrapping this segment. */
  href: string;
  /** When true, this segment renders bold in --text-primary (the
   * "you are here" marker). Typically the right-most segment; kept
   * as a flag rather than auto-detected so a page can suppress the
   * marker if it wants a flat breadcrumb. */
  tag?: boolean;
  /** When set, the segment becomes inline-editable. Click swaps the
   * label to an input with ✓ / ✗ buttons; Enter or ✓ commits, Escape
   * or ✗ cancels. Only meaningful on the tag segment — non-tag
   * segments ignore this. */
  editable?: {
    onRename: (next: string) => void | Promise<void>;
    ariaLabel?: string;
  };
};

export type PathnameProps = {
  segments: PathnameSegment[];
};

export function Pathname({ segments }: PathnameProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-8)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-sm)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        minWidth: 0,
      }}
    >
      {segments.map((seg, i) => (
        <Fragment key={`${seg.href}-${i}`}>
          {i > 0 && (
            <span
              aria-hidden
              style={{ color: "var(--text-quaternary)" }}
            >
              /
            </span>
          )}
          {seg.tag ? <TagSegment seg={seg} /> : <PlainSegment seg={seg} />}
        </Fragment>
      ))}
    </nav>
  );
}

/* ── Segment styles ───────────────────────────────────────────── */

function PlainSegment({ seg }: { seg: PathnameSegment }) {
  return (
    <Link
      href={seg.href}
      style={{
        color: "var(--text-tertiary)",
        textDecoration: "none",
        whiteSpace: "nowrap",
        transition: "color 120ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--text-tertiary)";
      }}
    >
      {seg.label}
    </Link>
  );
}

function TagSegment({ seg }: { seg: PathnameSegment }) {
  // Active segment: bold text in --text-primary, no chrome. Sibling
  // segments are --text-tertiary, so contrast alone reads as "you are
  // here." No pill, no border, no tint — keeps the header calm and
  // doesn't compete with the toolbar's mint CTAs to its right.
  if (seg.editable) {
    return (
      <EditableText
        value={seg.label}
        onChange={seg.editable.onRename}
        ariaLabel={seg.editable.ariaLabel ?? "Name"}
        style={{
          color: "var(--text-primary)",
          fontWeight: 600,
          // Inherit the mono/uppercase/tracking from the parent <nav>.
          fontFamily: "inherit",
          fontSize: "inherit",
          letterSpacing: "inherit",
          textTransform: "inherit",
        }}
      />
    );
  }
  return (
    <Link
      href={seg.href}
      style={{
        color: "var(--text-primary)",
        fontWeight: 600,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {seg.label}
    </Link>
  );
}
