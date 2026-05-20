"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

const ACCENT = "var(--accent-strong)";
const DIVIDER = "var(--border)";
const MONO = '"JetBrains Mono", monospace';

const TEXT_ACTIVE = "var(--text-primary)";
const TEXT_HOVER = "var(--text-secondary)";
const TEXT_IDLE = "var(--text-tertiary)";

const BG_ACTIVE = "var(--accent-soft)";
const BG_HOVER = "var(--card-hover)";

export type TabItem<K extends string = string> = {
  key: K;
  label: string;
  href: string;
};

/**
 * Terminal-style tab nav. Each tab sits inside a segment with a
 * `border-right`; the nav itself adds a leading `border-left` so the
 * row reads as a row of CLI segments. Active and hover both render a
 * subtle bg + 2px accent `border-bottom`; idle is just muted text on
 * the bare ground.
 *
 * Labels are mono (JetBrains Mono) to commit to the terminal feel —
 * consumers who want humanist labels should fork the primitive rather
 * than parameterize it; the mono font is what makes the dividers and
 * the border treatment cohere.
 *
 * `trailing` slots in after the last tab and inherits the segment
 * chrome — wrap action buttons in a node that handles its own padding
 * + border-right and the row stays visually continuous.
 */
export function TabBar<K extends string>({
  items,
  active,
  trailing,
}: {
  items: TabItem<K>[];
  /** Pass `null` when no tab should be highlighted (e.g. on a sibling route). */
  active: K | null;
  trailing?: ReactNode;
}) {
  const [hoveredKey, setHoveredKey] = useState<K | null>(null);

  return (
    <nav
      style={{
        display: "flex",
        alignSelf: "stretch",
        alignItems: "stretch",
        height: "100%",
        // Leading divider so the first tab has a left edge that matches
        // every other tab's right edge — keeps the row reading as a
        // continuous strip of segments.
        borderLeft: items.length > 0 ? `1px solid ${DIVIDER}` : undefined,
      }}
    >
      {items.map((tab) => {
        const isActive = tab.key === active;
        const isHovered = !isActive && hoveredKey === tab.key;
        const showAccent = isActive || isHovered;

        return (
          <Link
            key={tab.key}
            href={tab.href}
            onMouseEnter={() => setHoveredKey(tab.key)}
            onMouseLeave={() =>
              setHoveredKey((cur) => (cur === tab.key ? null : cur))
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              alignSelf: "stretch",
              padding: "0 18px",
              borderRight: `1px solid ${DIVIDER}`,
              // 2px under-bar lights up on active or hover; idle keeps a
              // transparent 2px so the row's height stays steady when
              // selection / pointer moves.
              borderBottom: `2px solid ${showAccent ? ACCENT : "transparent"}`,
              background: isActive
                ? BG_ACTIVE
                : isHovered
                  ? BG_HOVER
                  : "transparent",
              fontFamily: MONO,
              fontSize: 12,
              fontWeight: isActive ? 600 : 500,
              color: isActive
                ? TEXT_ACTIVE
                : isHovered
                  ? TEXT_HOVER
                  : TEXT_IDLE,
              textDecoration: "none",
              transition:
                "background 120ms ease, color 120ms ease, border-color 120ms ease",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
      {trailing}
    </nav>
  );
}
