"use client";

/**
 * /voices loading skeleton — auto-rendered by Next.js while the server
 * component fetches voices from the DB. Mirrors the D-card layout so the
 * page doesn't jolt when real data arrives: same toolbar position, same
 * card grid shape, same internal block heights.
 *
 * Client component because we need `useHeaderContent().setFlush(true)`
 * to claim the full-bleed layout (same call the live VoicesGrid makes).
 * Without it the admin shell wraps children in 2rem of padding, which
 * shows up as an unwanted indent during the loading flash and collapses
 * when the real page mounts. `useLayoutEffect` fires synchronously before
 * paint so the padding never actually renders.
 */

import { useLayoutEffect } from "react";
import { useHeaderContent } from "@/components/header-context";

const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

const SHIMMER = `
  @keyframes voices-loading-shimmer {
    0%   { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
`;

// Reusable shimmer "fill" — applied to every placeholder rectangle.
// Centralized so palette tweaks land in one place.
const shimmer: React.CSSProperties = {
  background:
    "linear-gradient(90deg, var(--ink-soft) 0%, color-mix(in srgb, var(--text-primary) 9%, transparent) 50%, var(--ink-soft) 100%)",
  backgroundSize: "200% 100%",
  animation: "voices-loading-shimmer 1.6s ease-in-out infinite",
  borderRadius: "var(--radius-xs)",
};

export default function VoicesLoading() {
  // Claim the full-bleed layout so the skeleton's internal 24/40 padding
  // is the ONLY horizontal padding the viewer sees. Without this the
  // admin shell adds another 2rem and the skeleton appears indented
  // relative to the loaded state. Resetting on unmount is a no-op since
  // VoicesGrid sets the same value on mount, but the cleanup keeps the
  // contract symmetric for any future page that doesn't want flush.
  const { setFlush } = useHeaderContent();
  useLayoutEffect(() => {
    setFlush(true);
    return () => setFlush(false);
  }, [setFlush]);

  // 8 ghost cards matches the populated artboard (4 cols × 2 rows on the
  // 1800w design). On narrow viewports the flex wraps; the count is just
  // a visual placeholder, the layout doesn't promise a real card count.
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
          {/* Search input placeholder — same 360w as the live one,
             *  pill shape to match the new control */}
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
          {/* "showing N of N" count placeholder */}
          <div
            style={{
              ...shimmer,
              width: 100,
              height: 12,
            }}
            aria-hidden
          />
        </div>

        {/* Sort menu placeholder — pill shape to match the new control */}
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
      {/* Mirrors the live grid in voices-grid.tsx so the skeleton
       * reflows at the same breakpoints (4 cols ≳1640px, 3 ≳1240,
       * 2 ≳840, 1 below). Don't switch to flex-wrap — fixed card
       * widths in a flex container can't auto-fill a remaining
       * track and end up looking like a sparse 2-col layout on
       * desktop. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: "var(--space-16)",
          width: "100%",
          padding: "0 40px 56px",
        }}
        aria-busy="true"
        aria-label="Loading voices"
      >
        {Array.from({ length: cardCount }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      {/* Off-screen status for screen readers — gives assistive tech a
          single hook instead of asking it to inspect the ghost grid. */}
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
        Loading voice library
      </span>
    </div>
  );
}

/* One ghost voice card matching the live D card's vertical rhythm so the
 * transition from skeleton → real data is dimensionally stable. The
 * status pill is rendered as a faint accent-tinted block (not gray) to
 * hint that most voices arrive in the "ready" state — keeps the empty
 * skeleton from feeling totally lifeless. */
function SkeletonCard() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        padding: "var(--space-18)",
        gap: "var(--space-14)",
        borderRadius: "var(--radius-2xl)",
        background: "var(--card)",
        border: "1px solid var(--card-border)",
      }}
    >
      {/* Top row: mini wave + identity + status pill ghost */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
        <div
          style={{
            ...shimmer,
            width: 38,
            height: 38,
            borderRadius: "var(--radius-md)",
            flexShrink: 0,
          }}
          aria-hidden
        />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <div style={{ ...shimmer, width: "55%", height: 16 }} aria-hidden />
          <div style={{ ...shimmer, width: "70%", height: 10 }} aria-hidden />
        </div>
        {/* Status pill ghost — accent-tinted (most voices arrive READY) */}
        <div
          style={{
            width: 56,
            height: 18,
            borderRadius: "var(--radius-pill)",
            background: "var(--accent-fill)",
            backgroundSize: "200% 100%",
            animation: "voices-loading-shimmer 1.6s ease-in-out infinite",
            flexShrink: 0,
          }}
          aria-hidden
        />
      </div>

      {/* Description — two lines of ghost text */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        <div style={{ ...shimmer, width: "92%", height: 11 }} aria-hidden />
        <div style={{ ...shimmer, width: "65%", height: 11 }} aria-hidden />
      </div>

      {/* Middle block ghost — sized to match the BindingsBlock height so
          the card doesn't jump when real data fills in */}
      <div
        style={{
          height: 78,
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-14)",
          background: "var(--ink-wash)",
          border:
            "1px solid var(--ink-soft)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-10)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div style={{ ...shimmer, width: 56, height: 8 }} aria-hidden />
            <div style={{ ...shimmer, width: 92, height: 12 }} aria-hidden />
          </div>
          {/* Ghost avatar stack */}
          <div style={{ display: "flex" }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  ...shimmer,
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  marginLeft: i > 0 ? -8 : 0,
                  border: "2px solid var(--background)",
                }}
                aria-hidden
              />
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: "var(--space-6)" }}>
          <div style={{ ...shimmer, width: 58, height: 18, borderRadius: "var(--radius-sm)" }} aria-hidden />
          <div style={{ ...shimmer, width: 46, height: 18, borderRadius: "var(--radius-sm)" }} aria-hidden />
        </div>
      </div>

      {/* Footer: provider badge ghost + 3-dot menu ghost */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: "var(--space-10)",
          marginTop: "var(--space-2)",
          borderTop:
            "1px solid var(--ink-soft)",
        }}
      >
        <div
          style={{
            ...shimmer,
            width: 56,
            height: 16,
            borderRadius: "var(--radius-sm)",
            fontFamily: FONT_MONO,
          }}
          aria-hidden
        />
        <div
          style={{
            ...shimmer,
            width: 26,
            height: 26,
            borderRadius: "var(--radius-sm)",
          }}
          aria-hidden
        />
      </div>
    </div>
  );
}
