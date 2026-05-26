"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { HarnessSidebar } from "./harness-sidebar";
import { HarnessPreviewRail } from "./harness-preview-rail";
import { HarnessEvalRail } from "./harness-eval-rail";
import { useHeaderContent } from "@/components/header-context";
import { useHarnessLayout } from "./harness-layout-context";
import { LAYERS } from "./harness-types";
import type { HarnessCharacter } from "./harness-types";

/* Widths kept as constants so the toggle transitions hit the same numbers
 * the sidebars actually render at. Tweak in one place. */
const LEFT_SIDEBAR_WIDTH = 280;
const RIGHT_RAIL_WIDTH = 480;
const COLLAPSE_TRANSITION = "width 180ms ease, opacity 140ms ease";

/**
 * The harness chrome — three-pane shell that wraps every nested route under
 * `/characters/:slug/harness/...`.
 *
 *   sidebar (constant)  ·  children (route page)  ·  right rail (route-aware)
 *
 * Each route file is responsible for rendering its own main-pane content; the
 * shell just lays the chrome around it. The right rail switches between the
 * generic "what the model sees" preview (default for layer editors) and the
 * test-eval rail (for the runs/sweeps/suites pages) based on pathname.
 *
 * Pre-refactor this file mounted the editor pane itself and switched on a
 * `?layer=…` query param. The new structure is more Next-native: layouts +
 * pages + URL hierarchy do the routing, this shell is just chrome.
 */

type Props = {
  character: HarnessCharacter;
  children: React.ReactNode;
};

export function HarnessShell({ character, children }: Props) {
  const pathname = usePathname() ?? "";
  const { leftCollapsed, rightCollapsed, toggleLeft, toggleRight } =
    useHarnessLayout();

  // Plant the global header content — breadcrumb on the left, sidebar
  // toggles on the right. Re-runs when toggle state changes so the buttons
  // reflect the current collapsed/expanded look.
  //
  // Also flips the AdminShell into flush mode so the three panes can
  // reach edge-to-edge (the default 2rem main padding would otherwise inset
  // the sidebar and right rail and force horizontal scroll).
  const { setContent, setFlush } = useHeaderContent();
  useEffect(() => {
    setContent(
      <div
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.14em",
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
            }}
          >
            / characters / {character.slug} / harness
          </span>
        </div>
        <div style={{ flex: 1 }} />
        {/* Segmented control — one bordered container, overflow:hidden so
            the inner buttons (which lose their own borders) get the parent's
            rounded corners. A 1px divider sits between them via `borderRight`
            on the left button. Reads as one cohesive control. */}
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            overflow: "hidden",
            background: "var(--background)",
          }}
        >
          <PanelToggle
            side="left"
            collapsed={leftCollapsed}
            onToggle={toggleLeft}
            segmented
            withDivider
          />
          <PanelToggle
            side="right"
            collapsed={rightCollapsed}
            onToggle={toggleRight}
            segmented
          />
        </div>
      </div>,
    );
    setFlush(true);
    return () => {
      setContent(null);
      setFlush(false);
    };
  }, [
    setContent,
    setFlush,
    character.slug,
    leftCollapsed,
    rightCollapsed,
    toggleLeft,
    toggleRight,
  ]);

  // Aggregate stats for the sidebar character card. Real numbers wire in
  // Phase 1.x once each layer's schema lands; for now derive from the
  // registry.
  const totalLayers = LAYERS.filter(
    (l) => l.tier === "t1" || l.tier === "t2",
  ).length;
  const configuredCount = LAYERS.filter(
    (l) => (l.tier === "t1" || l.tier === "t2") && l.status === "configured",
  ).length;

  // Which right rail variant? The test-eval surface gets the "launch + live
  // activity" rail; everything else gets the generic prompt preview + sandbox.
  const onTestEvalRoute = isTestEvalRoute(pathname);

  return (
    <div
      style={{
        display: "flex",
        // The global app shell already takes some height. Fill the rest.
        height: "calc(100vh - 48px)",
        background: "var(--background)",
        overflow: "hidden",
      }}
    >
      {/* Left sidebar — wrapped in a collapsing container so the sidebar
          itself stays at its natural width while the wrapper animates.
          The wrapper owns ONLY the collapse animation; sizing + chrome
          live inside the sidebar component (it sets its own width/height).
          `overflow:hidden` + `width:0` is how we hide it without breaking
          the inner layout calc. `pointer-events:none` while collapsed
          prevents click-throughs during the close animation. */}
      <div
        style={{
          width: leftCollapsed ? 0 : LEFT_SIDEBAR_WIDTH,
          flexShrink: 0,
          overflow: "hidden",
          transition: COLLAPSE_TRANSITION,
          opacity: leftCollapsed ? 0 : 1,
          pointerEvents: leftCollapsed ? "none" : "auto",
        }}
      >
        <HarnessSidebar
          character={character}
          stats={{
            configuredCount,
            totalLayers,
            totalTokens: "—",
          }}
        />
      </div>

      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--background)",
          overflow: "auto",
        }}
      >
        {children}
      </main>

      {/* Right rail — same collapsing wrapper pattern. */}
      <div
        style={{
          width: rightCollapsed ? 0 : RIGHT_RAIL_WIDTH,
          flexShrink: 0,
          overflow: "hidden",
          transition: COLLAPSE_TRANSITION,
          opacity: rightCollapsed ? 0 : 1,
          pointerEvents: rightCollapsed ? "none" : "auto",
        }}
      >
        {onTestEvalRoute ? (
          <HarnessEvalRail character={character} />
        ) : (
          <HarnessPreviewRail character={character} />
        )}
      </div>
    </div>
  );
}

/**
 * A 28×28 icon button. Two visual variants:
 *
 *   default   — stands alone (own border + rounded corners). Used as a
 *               solo icon button in headers/toolbars.
 *   segmented — drops its own border/radius so a parent container with
 *               `overflow:hidden` can provide them. Optional `withDivider`
 *               renders a 1px right-edge divider, used between siblings
 *               inside a segmented-control group.
 *
 * Glyph orientation flips by `side`, and the panel-segment fill flips by
 * `collapsed` so it visually reads "the panel I control is on / off".
 */
function PanelToggle({
  side,
  collapsed,
  onToggle,
  segmented,
  withDivider,
}: {
  side: "left" | "right";
  collapsed: boolean;
  onToggle: () => void;
  segmented?: boolean;
  withDivider?: boolean;
}) {
  const labelAction = collapsed ? "Show" : "Hide";
  const labelSide = side === "left" ? "left sidebar" : "right rail";
  const label = `${labelAction} ${labelSide}`;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        // Segmented variant: no own radius/border (parent provides), plus an
        // optional right-edge divider when there's a sibling button.
        borderRadius: segmented ? 0 : "var(--radius-md)",
        borderTop: "none",
        borderLeft: "none",
        borderBottom: "none",
        borderRight:
          segmented && withDivider ? "1px solid var(--border)" : "none",
        outline: segmented ? "none" : "1px solid var(--border)",
        outlineOffset: -1,
        // Subtle active tint when the panel is visible so the user can read
        // "left: on, right: off" at a glance.
        background: collapsed ? "transparent" : "rgba(140,231,210,0.06)",
        color: collapsed ? "var(--text-tertiary)" : "var(--foreground)",
        cursor: "pointer",
        flexShrink: 0,
        padding: 0,
      }}
    >
      {/* "Panel" icon: a rounded rectangle with a vertical divider on the
          chosen side. The divided segment is filled when the panel is
          visible (collapsed=false) and hollow when collapsed. */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        {side === "left" ? (
          <>
            <line x1="9" y1="4" x2="9" y2="20" />
            {!collapsed ? (
              <rect
                x="3"
                y="4"
                width="6"
                height="16"
                fill="currentColor"
                opacity="0.35"
                stroke="none"
              />
            ) : null}
          </>
        ) : (
          <>
            <line x1="15" y1="4" x2="15" y2="20" />
            {!collapsed ? (
              <rect
                x="15"
                y="4"
                width="6"
                height="16"
                fill="currentColor"
                opacity="0.35"
                stroke="none"
              />
            ) : null}
          </>
        )}
      </svg>
    </button>
  );
}

/**
 * The test-eval routes own a different right rail (launch + live activity)
 * because their main pane has nothing to do with "what the model sees" for a
 * single turn. Match by route prefix so deep paths like /suites/abc/edit
 * still get the eval rail.
 */
function isTestEvalRoute(pathname: string): boolean {
  const ix = pathname.indexOf("/harness/");
  if (ix < 0) return false;
  const suffix = pathname.slice(ix + "/harness/".length);
  return (
    suffix.startsWith("runs") ||
    suffix.startsWith("sweeps") ||
    suffix.startsWith("suites") ||
    suffix.startsWith("history")
  );
}
