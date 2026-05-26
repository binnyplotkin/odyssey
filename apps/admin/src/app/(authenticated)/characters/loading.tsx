"use client";

/**
 * /characters loading skeleton — Next renders this while the page's
 * server component fetches summaries. Mirrors the live CharactersGrid
 * layout (page padding, pill search, 3-stat card, model-badge footer)
 * so the transition from skeleton → real data lands without layout
 * shift.
 *
 * Client component because we need `useHeaderContent().setFlush(true)`
 * to claim the full-bleed layout — otherwise the admin shell wraps
 * children in 2rem of padding for one frame, then collapses when the
 * real grid mounts. Same trick as /voices.
 */

import { useLayoutEffect } from "react";
import { useHeaderContent } from "@/components/header-context";

const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

const SHIMMER = `
  @keyframes characters-loading-shimmer {
    0%   { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
`;

const shimmer: React.CSSProperties = {
  background:
    "linear-gradient(90deg, var(--ink-soft) 0%, color-mix(in srgb, var(--text-primary) 9%, transparent) 50%, var(--ink-soft) 100%)",
  backgroundSize: "200% 100%",
  animation: "characters-loading-shimmer 1.6s ease-in-out infinite",
  borderRadius: "var(--radius-xs)",
};

export default function CharactersLoading() {
  const { setFlush } = useHeaderContent();
  useLayoutEffect(() => {
    setFlush(true);
    return () => setFlush(false);
  }, [setFlush]);

  const cardCount = 8;

  return (
    <div
      style={{
        minHeight: "100%",
        background: "var(--background)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{SHIMMER}</style>

      {/* ── Toolbar skeleton ──────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-16)",
          flexWrap: "wrap",
          padding: "24px 40px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-16)",
            flex: "1 1 490px",
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          <div
            style={{
              ...shimmer,
              width: 360,
              maxWidth: "100%",
              height: 36,
              flex: "0 1 360px",
              borderRadius: "var(--radius-pill)",
            }}
            aria-hidden
          />
          <div
            style={{
              ...shimmer,
              width: 140,
              height: 12,
            }}
            aria-hidden
          />
        </div>
        <div
          style={{
            ...shimmer,
            width: 180,
            height: 32,
            borderRadius: "var(--radius-pill)",
          }}
          aria-hidden
        />
      </div>

      {/* ── Card grid skeleton ────────────────────────────────────── */}
      {/* Mirrors the live grid: minmax(360px, 1fr) so the skeleton
       * reflows at the same breakpoints (4 cols ≳1640px, 3 ≳1240,
       * 2 ≳840, 1 below). */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: "var(--space-16)",
          width: "100%",
          padding: "0 40px 56px",
        }}
        aria-busy="true"
        aria-label="Loading characters"
      >
        {Array.from({ length: cardCount }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      <span
        role="status"
        aria-live="polite"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        Loading characters
      </span>
    </div>
  );
}

/** Ghost character card matching the live card's rhythm — 48×48
 * portrait, title + meta stack, 2-line essence, 3-cell stats panel,
 * model-badge footer. Same minHeight as the real card so a row with
 * mixed empty/loaded states doesn't jolt vertically. */
function SkeletonCard() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 280,
        padding: "var(--space-18)",
        gap: "var(--space-14)",
        borderRadius: "var(--radius-2xl)",
        background: "var(--card)",
        border: "1px solid var(--card-border)",
        minWidth: 0,
      }}
    >
      {/* Top row: portrait + title + meta */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
        <div
          style={{
            ...shimmer,
            width: 48,
            height: 48,
            borderRadius: "var(--radius-lg)",
            flexShrink: 0,
          }}
          aria-hidden
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-5)",
            flex: 1,
            minWidth: 0,
          }}
        >
          <div style={{ ...shimmer, width: "62%", height: 18 }} aria-hidden />
          <div style={{ ...shimmer, width: "40%", height: 10 }} aria-hidden />
        </div>
      </div>

      {/* Essence — 2 lines of ghost text */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        <div style={{ ...shimmer, width: "100%", height: 12 }} aria-hidden />
        <div style={{ ...shimmer, width: "72%", height: 12 }} aria-hidden />
      </div>

      {/* Stats panel — 3 cells inside the rounded inner block, same
       * 14px padding + 10px radius + hairline border as the live one */}
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          padding: "var(--space-14)",
          background:
            "var(--ink-wash)",
          border:
            "1px solid var(--ink-soft)",
          borderRadius: "var(--radius-lg)",
        }}
      >
        <StatCellSkeleton first />
        <StatCellSkeleton accent />
        <StatCellSkeleton last />
      </div>

      {/* Footer — model badge ghost (single pill, left-aligned) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          paddingTop: "var(--space-10)",
          marginTop: "auto",
          borderTop:
            "1px solid var(--ink-soft)",
        }}
      >
        <div
          style={{
            ...shimmer,
            width: 96,
            height: 18,
            borderRadius: "var(--radius-sm)",
            fontFamily: FONT_MONO,
          }}
          aria-hidden
        />
      </div>
    </div>
  );
}

function StatCellSkeleton({
  first,
  accent,
  last,
}: {
  first?: boolean;
  accent?: boolean;
  last?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: first || last ? "0 6px" : "0 6px",
        paddingLeft: first ? 0 : 6,
        paddingRight: last ? 0 : 6,
        borderRight: last
          ? "none"
          : "1px solid var(--ink-soft)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
      }}
    >
      <div style={{ ...shimmer, width: 38, height: 9, borderRadius: "var(--radius-xs)" }} aria-hidden />
      <div
        style={{
          ...shimmer,
          width: accent ? 28 : 56,
          height: accent ? 14 : 11,
          borderRadius: "var(--radius-xs)",
        }}
        aria-hidden
      />
    </div>
  );
}
