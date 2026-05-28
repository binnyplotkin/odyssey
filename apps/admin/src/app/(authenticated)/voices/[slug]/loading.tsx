"use client";

/**
 * /voices/[slug] loading skeleton — auto-rendered by Next.js while the
 * server component fetches the voice row, bindings, previews, attempts,
 * and signed URLs. Mirrors the live VoiceDetail layout so the page
 * doesn't shift when real data arrives: same wrapper padding, same
 * console split, same block sizes per section.
 *
 * Client component because the live page calls
 * `useHeaderContent().setFlush(true)` to opt out of the admin shell's
 * 2rem default padding (the page draws its own 40px gutter). Without
 * the same flush claim here, the skeleton renders indented relative
 * to the loaded state and snaps when the real page mounts.
 * `useLayoutEffect` fires synchronously before paint so the indent
 * never actually shows.
 */

import { useLayoutEffect } from "react";
import { useHeaderContent } from "@/components/header-context";

const SHIMMER = `
  @keyframes voice-detail-loading-shimmer {
    0%   { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
`;

/* Reusable shimmer fill. Token-driven so the placeholder flips with
 * light/dark theme. Same palette as /voices loading.tsx so list →
 * detail navigation doesn't introduce a tonal jump. */
const shimmer: React.CSSProperties = {
  background:
    "linear-gradient(90deg, var(--ink-soft) 0%, color-mix(in srgb, var(--text-primary) 9%, transparent) 50%, var(--ink-soft) 100%)",
  backgroundSize: "200% 100%",
  animation: "voice-detail-loading-shimmer 1.6s ease-in-out infinite",
  borderRadius: "var(--radius-xs)",
};

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-14)",
  padding: "var(--space-18)",
  borderRadius: "var(--radius-2xl)",
  background: "var(--material-card)",
  border: "1px solid var(--border-subtle)",
};

export default function VoiceDetailLoading() {
  /* Claim full-bleed layout. Live page does the same on mount; the
   * cleanup is here to keep the contract symmetric for any future
   * route that doesn't want flush. */
  const { setFlush } = useHeaderContent();
  useLayoutEffect(() => {
    setFlush(true);
    return () => setFlush(false);
  }, [setFlush]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-32)",
        padding: "24px 40px 64px",
      }}
      aria-busy="true"
      aria-label="Loading voice"
    >
      <style>{SHIMMER}</style>

      <PageHeaderSkeleton />

      {/* Console split — main canvas + sticky inspector rail. Mirrors
          the live layout's flex sizing so the column proportions match
          before/after hydration. */}
      <div
        style={{
          display: "flex",
          gap: "var(--space-32)",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <main
          style={{
            flex: "1 1 640px",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-24)",
          }}
        >
          <AuditionPanelSkeleton />
          <SourceClipSkeleton />
          <PreviewGallerySkeleton />
          <BindingsPanelSkeleton />
          <JournalPanelSkeleton />
        </main>
        <aside
          style={{
            flex: "0 1 380px",
            minWidth: 320,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-16)",
          }}
        >
          <RailEngineSkeleton />
          <CurationSkeleton />
          <RailAuditSkeleton />
          <DangerZoneSkeleton />
        </aside>
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
        Loading voice
      </span>
    </div>
  );
}

/* ── Page header ────────────────────────────────────────────────
 * Two-line stack on the left (small id chip + large display name)
 * with an action-button cluster on the right. Mirrors the live
 * PageHeader's flex-row layout. */
function PageHeaderSkeleton() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: "var(--space-32)",
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-10)",
        }}
      >
        {/* id chip */}
        <div style={{ ...shimmer, width: 220, height: 14 }} aria-hidden />
        {/* display name */}
        <div style={{ ...shimmer, width: 340, height: 36 }} aria-hidden />
        {/* meta row */}
        <div style={{ display: "flex", gap: "var(--space-10)" }}>
          <div style={{ ...shimmer, width: 84, height: 12 }} aria-hidden />
          <div style={{ ...shimmer, width: 64, height: 12 }} aria-hidden />
          <div style={{ ...shimmer, width: 96, height: 12 }} aria-hidden />
        </div>
      </div>
      <div style={{ display: "flex", gap: "var(--space-8)", flexShrink: 0 }}>
        <div
          style={{ ...shimmer, width: 116, height: 36, borderRadius: "var(--radius-pill)" }}
          aria-hidden
        />
        <div
          style={{ ...shimmer, width: 36, height: 36, borderRadius: "var(--radius-pill)" }}
          aria-hidden
        />
      </div>
    </div>
  );
}

/* ── Audition / Extraction hero ─────────────────────────────────
 * Largest single panel on the page. Two-column inner layout: hero
 * prompt copy on the left, transport (play button + waveform) on
 * the right. Sized to ~280px so the column doesn't reflow when
 * the live AuditionCard fills in. */
function AuditionPanelSkeleton() {
  return (
    <div
      style={{
        ...panelStyle,
        minHeight: 280,
        gap: "var(--space-20)",
      }}
    >
      {/* Section tag */}
      <div style={{ ...shimmer, width: 90, height: 10 }} aria-hidden />
      {/* Headline prompt */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <div style={{ ...shimmer, width: "84%", height: 22 }} aria-hidden />
        <div style={{ ...shimmer, width: "62%", height: 22 }} aria-hidden />
      </div>
      {/* Transport row: play button + waveform bars */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-18)",
          marginTop: "var(--space-6)",
        }}
      >
        <div
          style={{
            ...shimmer,
            width: 68,
            height: 68,
            borderRadius: "50%",
            flexShrink: 0,
          }}
          aria-hidden
        />
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            height: 40,
          }}
        >
          {Array.from({ length: 48 }, (_, i) => (
            <div
              key={i}
              style={{
                ...shimmer,
                flex: 1,
                height: `${30 + ((i * 17) % 70)}%`,
                minHeight: 6,
                borderRadius: 1,
              }}
              aria-hidden
            />
          ))}
        </div>
      </div>
      {/* Timestamp + regenerate row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: "auto",
        }}
      >
        <div style={{ ...shimmer, width: 72, height: 12 }} aria-hidden />
        <div
          style={{ ...shimmer, width: 124, height: 30, borderRadius: "var(--radius-pill)" }}
          aria-hidden
        />
      </div>
    </div>
  );
}

/* ── Source clip strip ──────────────────────────────────────────
 * Compact panel below the hero — provider chip + duration meta +
 * download button. Only rendered for pocket+ready voices on the
 * live page; included unconditionally in the skeleton because we
 * don't know the provider yet. */
function SourceClipSkeleton() {
  return (
    <div
      style={{
        ...panelStyle,
        flexDirection: "row",
        alignItems: "center",
        gap: "var(--space-14)",
        padding: "14px 18px",
        minHeight: 64,
      }}
    >
      <div
        style={{ ...shimmer, width: 36, height: 36, borderRadius: "var(--radius-md)", flexShrink: 0 }}
        aria-hidden
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        <div style={{ ...shimmer, width: "44%", height: 13 }} aria-hidden />
        <div style={{ ...shimmer, width: "30%", height: 10 }} aria-hidden />
      </div>
      <div
        style={{ ...shimmer, width: 96, height: 28, borderRadius: "var(--radius-pill)" }}
        aria-hidden
      />
    </div>
  );
}

/* ── Preview gallery ───────────────────────────────────────────
 * Tag header + 2-3 horizontal preview rows. Each row is a thumbnail
 * + title + waveform + action button. */
function PreviewGallerySkeleton() {
  return (
    <div style={{ ...panelStyle, minHeight: 260 }}>
      <SectionHeaderSkeleton tagWidth={120} titleWidth={180} />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-14)",
            paddingTop: "var(--space-12)",
            paddingBottom: "var(--space-12)",
            borderTop:
              i === 0
                ? undefined
                : "1px solid var(--ink-soft)",
          }}
        >
          <div
            style={{
              ...shimmer,
              width: 40,
              height: 40,
              borderRadius: "var(--radius-md)",
              flexShrink: 0,
            }}
            aria-hidden
          />
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-6)",
            }}
          >
            <div style={{ ...shimmer, width: "60%", height: 12 }} aria-hidden />
            <div style={{ ...shimmer, width: "38%", height: 10 }} aria-hidden />
          </div>
          <div
            style={{ ...shimmer, width: 28, height: 28, borderRadius: "var(--radius-md)" }}
            aria-hidden
          />
        </div>
      ))}
    </div>
  );
}

/* ── Bindings ──────────────────────────────────────────────────
 * Section header + 3-5 character chips arranged horizontally with
 * an avatar + name. */
function BindingsPanelSkeleton() {
  return (
    <div style={{ ...panelStyle, minHeight: 180 }}>
      <SectionHeaderSkeleton tagWidth={70} titleWidth={150} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-10)" }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-10)",
              padding: "8px 12px 8px 8px",
              borderRadius: "var(--radius-pill)",
              background:
                "color-mix(in srgb, var(--text-primary) 3%, transparent)",
              border:
                "1px solid color-mix(in srgb, var(--text-primary) 5%, transparent)",
            }}
          >
            <div
              style={{
                ...shimmer,
                width: 26,
                height: 26,
                borderRadius: "50%",
                flexShrink: 0,
              }}
              aria-hidden
            />
            <div
              style={{
                ...shimmer,
                width: 60 + ((i * 17) % 40),
                height: 11,
              }}
              aria-hidden
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Extraction journal ────────────────────────────────────────
 * Tag header + a list of timestamped attempt rows. Mirrors the
 * monospace log feel. */
function JournalPanelSkeleton() {
  return (
    <div style={{ ...panelStyle, minHeight: 220 }}>
      <SectionHeaderSkeleton tagWidth={130} titleWidth={170} />
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-14)",
            paddingTop: "var(--space-10)",
            paddingBottom: "var(--space-10)",
            borderTop:
              i === 0
                ? undefined
                : "1px solid color-mix(in srgb, var(--text-primary) 3%, transparent)",
          }}
        >
          <div
            style={{
              ...shimmer,
              width: 8,
              height: 8,
              borderRadius: "50%",
              flexShrink: 0,
            }}
            aria-hidden
          />
          <div style={{ ...shimmer, width: 96, height: 10 }} aria-hidden />
          <div style={{ flex: 1, ...shimmer, height: 10 }} aria-hidden />
          <div style={{ ...shimmer, width: 56, height: 10 }} aria-hidden />
        </div>
      ))}
    </div>
  );
}

/* ── Rail: engine / provider card ───────────────────────────────
 * Two-line label + 4 key/value rows. The engine card lists pocket
 * runtime info on Pocket voices and provider config on hosted. */
function RailEngineSkeleton() {
  return (
    <div style={{ ...panelStyle, minHeight: 220 }}>
      <SectionHeaderSkeleton tagWidth={90} titleWidth={150} />
      {[0, 1, 2, 3].map((i) => (
        <KeyValueRowSkeleton key={i} labelWidth={70 + ((i * 13) % 30)} valueWidth={92 + ((i * 21) % 50)} />
      ))}
    </div>
  );
}

/* ── Rail: curation ────────────────────────────────────────────
 * Tags + language + gender + license + attribution. Tallest aside
 * card — five labelled rows plus tag chips. */
function CurationSkeleton() {
  return (
    <div style={{ ...panelStyle, minHeight: 360 }}>
      <SectionHeaderSkeleton tagWidth={80} titleWidth={120} />
      {/* Tag chips row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)" }}>
        {[58, 74, 46, 62].map((w, i) => (
          <div
            key={i}
            style={{ ...shimmer, width: w, height: 22, borderRadius: "var(--radius-pill)" }}
            aria-hidden
          />
        ))}
      </div>
      {[0, 1, 2, 3].map((i) => (
        <KeyValueRowSkeleton
          key={i}
          labelWidth={64 + ((i * 11) % 24)}
          valueWidth={110 + ((i * 17) % 50)}
        />
      ))}
    </div>
  );
}

/* ── Rail: audit ──────────────────────────────────────────────
 * Created / updated rows + provenance. */
function RailAuditSkeleton() {
  return (
    <div style={{ ...panelStyle, minHeight: 160 }}>
      <SectionHeaderSkeleton tagWidth={60} titleWidth={120} />
      {[0, 1, 2].map((i) => (
        <KeyValueRowSkeleton key={i} labelWidth={64} valueWidth={120 + ((i * 17) % 40)} />
      ))}
    </div>
  );
}

/* ── Rail: danger zone ────────────────────────────────────────
 * Section header + two danger buttons stacked. */
function DangerZoneSkeleton() {
  return (
    <div style={{ ...panelStyle, minHeight: 160 }}>
      <SectionHeaderSkeleton tagWidth={94} titleWidth={140} />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <div
          style={{ ...shimmer, height: 38, borderRadius: "var(--radius-lg)" }}
          aria-hidden
        />
        <div
          style={{ ...shimmer, height: 38, borderRadius: "var(--radius-lg)" }}
          aria-hidden
        />
      </div>
    </div>
  );
}

/* ── Shared shapes ─────────────────────────────────────────────
 * Section tag + section title — the two-line block at the top of
 * every panel. Centralized so the rhythm stays consistent across
 * the dozen panels above. */
function SectionHeaderSkeleton({
  tagWidth,
  titleWidth,
}: {
  tagWidth: number;
  titleWidth: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <div style={{ ...shimmer, width: tagWidth, height: 9 }} aria-hidden />
      <div style={{ ...shimmer, width: titleWidth, height: 15 }} aria-hidden />
    </div>
  );
}

/* Key/value row used in the rail cards (engine, curation, audit).
 * Label on the left in mono caps, value on the right. */
function KeyValueRowSkeleton({
  labelWidth,
  valueWidth,
}: {
  labelWidth: number;
  valueWidth: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-12)",
      }}
    >
      <div style={{ ...shimmer, width: labelWidth, height: 9 }} aria-hidden />
      <div style={{ ...shimmer, width: valueWidth, height: 11 }} aria-hidden />
    </div>
  );
}
