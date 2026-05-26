"use client";

import { useEffect, type CSSProperties } from "react";
import { Skeleton } from "@odyssey/ui";
import { useHeaderContent } from "@/components/header-context";

// Mirrors the live CharacterConfig workbench:
//   • Canvas painted with --node-canvas (raised stage above the page)
//   • CharacterNodeCard: 440w, padded 18, gap 14, radius 14, sitting on
//     --background so the canvas grid doesn't bleed through (matches the
//     live node's explicit backgroundColor: var(--background) trick)
//   • Selected-state halo (3px mint at 12% alpha) so the silhouette
//     hands off to the loaded "selected" card without a chrome jump
//   • Identity bar: mint dot + CHARACTER label + trailing slug
//   • Portrait row: 64×64 portrait + title + dot-only trait tags
//   • Slot strip: brain / wikis / voice with internal dividers
// Right side: sticky 480 ConfigSidebar shell — header, tabs, sections,
// footer — unchanged from before.

const MINT = "#8FD1CB";

function NodeIdentityBarSkeleton() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-12)",
      }}
    >
      <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-10)" }}>
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: "var(--radius-pill)",
            background: MINT,
            boxShadow: `0 0 8px ${MINT}`,
            flexShrink: 0,
          }}
        />
        <Skeleton width={84} height={10} />
      </div>
      <Skeleton width={96} height={10} />
    </div>
  );
}

function NodePortraitRowSkeleton() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)" }}>
      <div
        style={{
          width: 64,
          height: 64,
          flexShrink: 0,
          borderRadius: "var(--radius-2xl)",
          background: "var(--card-hover)",
          border: `1px solid color-mix(in srgb, ${MINT} 18%, transparent)`,
          overflow: "hidden",
        }}
      >
        <Skeleton width="100%" height="100%" radius={0} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-8)",
          flex: 1,
          minWidth: 0,
        }}
      >
        <Skeleton width="62%" height={22} />
        {/* Trait tags — dot + label pairs, no chrome (matches the new
            stripped TraitTag). Two visible to mirror the live cap. */}
        <div style={{ display: "flex", gap: "var(--space-14)" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-8)" }}>
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: "var(--radius-pill)",
                background: MINT,
                boxShadow: `0 0 8px ${MINT}`,
              }}
            />
            <Skeleton width={62} height={11} />
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-8)" }}>
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: "var(--radius-pill)",
                background: MINT,
                boxShadow: `0 0 8px ${MINT}`,
              }}
            />
            <Skeleton width={48} height={11} />
          </div>
        </div>
      </div>
    </div>
  );
}

function NodeEssenceSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <Skeleton width="100%" height={13} />
      <Skeleton width="78%" height={13} />
    </div>
  );
}

function SlotCellSkeleton({ first, last }: { first?: boolean; last?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-8)",
        flex: 1,
        minWidth: 0,
        paddingLeft: first ? 0 : 14,
        paddingRight: last ? 0 : 14,
        borderRight: last
          ? "none"
          : "1px solid color-mix(in srgb, var(--text-primary) 5%, transparent)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            flexShrink: 0,
            borderRadius: "var(--radius-md)",
            background: `color-mix(in srgb, ${MINT} 10%, transparent)`,
            border: `1px solid color-mix(in srgb, ${MINT} 28%, transparent)`,
          }}
        />
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            flexShrink: 0,
            borderRadius: "var(--radius-pill)",
            background: MINT,
            boxShadow: `0 0 6px ${MINT}`,
          }}
        />
      </div>
      <Skeleton width={42} height={9} />
      <Skeleton width="86%" height={12} />
    </div>
  );
}

function CharacterNodeSkeleton() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 440,
        maxWidth: "100%",
        padding: "var(--space-18)",
        gap: "var(--space-14)",
        borderRadius: "var(--radius-2xl)",
        position: "relative",
        zIndex: 1,
        isolation: "isolate",
        // Same trick as the live node — paint with --background so the
        // canvas's grid pattern doesn't bleed through. Separation from
        // canvas comes from the border + selected-state halo, not tone.
        backgroundColor: "var(--background)",
        backgroundImage: "none",
        // Skeleton renders the "selected" state the live card starts in
        // (page mount auto-selects the character node).
        border: `1.5px solid color-mix(in srgb, ${MINT} 55%, transparent)`,
        boxShadow: `0 0 0 3px color-mix(in srgb, ${MINT} 12%, transparent), 0 14px 36px color-mix(in srgb, ${MINT} 8%, transparent)`,
        boxSizing: "border-box",
      }}
    >
      <NodeIdentityBarSkeleton />
      <NodePortraitRowSkeleton />
      <NodeEssenceSkeleton />

      {/* Slot strip — brain / wikis / voice */}
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          padding: "var(--space-14)",
          background: "var(--ink-wash)",
          border: "1px solid var(--ink-soft)",
          borderRadius: "var(--radius-lg)",
        }}
      >
        <SlotCellSkeleton first />
        <SlotCellSkeleton />
        <SlotCellSkeleton last />
      </div>
    </div>
  );
}

/* ── Sidebar skeleton (unchanged shape) ──────────────────────────── */

const PANEL_LAYERED: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
};

function ConfigSidebarSkeleton() {
  return (
    <aside
      style={{
        width: 480,
        flexShrink: 0,
        background: "rgba(255,255,255,0.02)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        // Sticky-but-only-visually: the loading shell can't be sticky
        // because there's no scrollable parent yet. Fixed min height
        // so the column reads as a tall surface.
        minHeight: "calc(100vh - 48px)",
      }}
    >
      {/* Header — avatar (48), title + auto-saved, kebab */}
      <div
        style={{
          padding: "20px 24px 0",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-12)",
            minWidth: 0,
          }}
        >
          <Skeleton width={48} height={48} radius={0} />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
              minWidth: 0,
            }}
          >
            <Skeleton width={140} height={16} />
            <Skeleton width={110} height={10} />
          </div>
        </div>
        <Skeleton width={28} height={26} radius={0} static />
      </div>

      {/* Tabs */}
      <div
        style={{
          padding: "16px 24px 0",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          gap: "var(--space-4)",
          flexWrap: "wrap",
        }}
      >
        {[74, 58, 92, 56, 58].map((w, i) => (
          <Skeleton
            key={i}
            width={w}
            height={30}
            radius={0}
            static
            style={{ marginBottom: -1 }}
          />
        ))}
      </div>

      {/* Tab content — sections (header + 2-3 cards each) */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: "20px 24px 140px",
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {[0, 1].map((s) => (
          <section
            key={s}
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "var(--space-8)",
              }}
            >
              <Skeleton width={120} height={18} />
              <Skeleton width={48} height={9} />
            </div>
            <Skeleton width={110} height={10} />
            <div
              style={{
                ...PANEL_LAYERED,
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-8)",
              }}
            >
              <Skeleton width="60%" height={13} />
              <Skeleton width="90%" height={11} />
              <Skeleton width="72%" height={11} />
            </div>
            <div
              style={{
                ...PANEL_LAYERED,
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-8)",
              }}
            >
              <Skeleton width="55%" height={13} />
              <Skeleton width="85%" height={11} />
            </div>
          </section>
        ))}
      </div>

      {/* Footer — token bar */}
      <div
        style={{
          padding: "14px 24px 18px",
          background: "color-mix(in srgb, var(--background) 92%, transparent)",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-12)",
        }}
      >
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-6)" }}
        >
          <Skeleton width={170} height={10} />
          <Skeleton width="100%" height={3} radius={999} />
        </div>
        <Skeleton width={32} height={32} radius={0} static />
      </div>
    </aside>
  );
}

export default function CharacterDetailLoading() {
  const { setFlush } = useHeaderContent();

  useEffect(() => {
    setFlush(true);
    return () => setFlush(false);
  }, [setFlush]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: 0,
        minHeight: "calc(100vh - 48px)",
        background: "var(--background)",
      }}
    >
      {/* Canvas area — painted with --node-canvas to match the live
          CanvasArea surface (raised stage above the page). Grid pattern
          drawn at 28px to mimic the React Flow Background lines variant. */}
      <div
        style={{
          flex: "1 1 0",
          minWidth: 0,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--node-canvas)",
          backgroundImage:
            "linear-gradient(var(--grid-color) 1px, transparent 1px), linear-gradient(90deg, var(--grid-color) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      >
        <CharacterNodeSkeleton />
      </div>

      {/* Sticky config sidebar */}
      <ConfigSidebarSkeleton />
    </div>
  );
}
