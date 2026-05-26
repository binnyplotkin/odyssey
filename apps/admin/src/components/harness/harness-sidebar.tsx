"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { HarnessCharacter, LayerDef, LayerStatus, LayerTier } from "./harness-types";
import { LAYERS } from "./harness-types";

/* ── Tokens ─────────────────────────────────────────────────── */

const T = {
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

/** Tier color — matches the Paper design.
 * T1 = phosphor (existing app uses #8FD1CB as accent-strong, very close to
 * the design's #8DFCCB). T2 = amber. SM = violet. Test = neutral. */
function tierColor(tier: LayerTier): string {
  switch (tier) {
    case "t1": return "rgba(140,231,210,0.85)";
    case "t2": return "rgba(255,184,112,0.80)";
    case "sm": return "rgba(179,136,255,0.80)";
    case "test": return "rgba(255,255,255,0.45)";
  }
}

function statusDot(status: LayerStatus): { glyph: string; color: string } {
  switch (status) {
    case "configured": return { glyph: "●", color: "var(--accent-strong)" };
    case "partial":    return { glyph: "◐", color: "rgba(255,184,112,0.85)" };
    case "empty":      return { glyph: "○", color: "rgba(255,255,255,0.20)" };
    case "n/a":        return { glyph: "▸", color: "rgba(255,255,255,0.40)" };
  }
}

type SectionHeading = { tier: LayerTier; label: string; suffix?: string };
const SECTIONS: SectionHeading[] = [
  { tier: "t1", label: "T1 · system", suffix: "cached" },
  { tier: "t2", label: "T2 · per-turn", suffix: "live" },
  { tier: "sm", label: "stage manager", suffix: "world" },
  { tier: "test", label: "test & eval" },
];

type Props = {
  character: HarnessCharacter;
  /** Aggregate stats shown in the character header card. Backend-derived later;
   * for now caller passes whatever it has. */
  stats?: {
    configuredCount?: number;
    totalLayers?: number;
    totalTokens?: string;
  };
};

/**
 * Maps the current pathname to the active layer.href. A row is "active"
 * when the pathname's `/harness/` suffix exactly equals (or starts with)
 * the row's href — which matches both `/harness/layers/l01` for the layer
 * editors and `/harness/suites/abc/edit` for deeper test-eval routes.
 */
function activeHref(pathname: string): string | null {
  // Strip everything up to and including /harness/.
  const ix = pathname.indexOf("/harness/");
  if (ix < 0) return null;
  const suffix = pathname.slice(ix + "/harness/".length);
  // Pick the LONGEST matching href so `/suites/abc/edit` wins over `/suites`.
  let best: string | null = null;
  for (const l of LAYERS) {
    if (suffix === l.href || suffix.startsWith(l.href + "/")) {
      if (!best || l.href.length > best.length) best = l.href;
    }
  }
  return best;
}

export function HarnessSidebar({ character, stats }: Props) {
  const pathname = usePathname();
  const active = useMemo(() => activeHref(pathname ?? ""), [pathname]);

  const byTier = useMemo(() => {
    const map: Record<LayerTier, LayerDef[]> = { t1: [], t2: [], sm: [], test: [] };
    for (const l of LAYERS) map[l.tier].push(l);
    return map;
  }, []);

  const initial = character.title.charAt(0).toUpperCase();
  const harnessRoot = `/characters/${character.slug}/harness`;

  return (
    <aside
      style={{
        // Owns its own dimensions — the shell clips via an outer wrapper
        // when collapsed, but doesn't dictate sizing.
        width: 280,
        height: "100%",
        flexShrink: 0,
        background: "var(--sidebar-glass)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
    >
      {/* Character header */}
      <div
        style={{
          padding: "24px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-14)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "var(--radius-sm)",
              background: "linear-gradient(135deg, #2A1810 0%, #5A3020 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: T.fontHeading,
              fontSize: "var(--font-size-xl)",
              fontWeight: 600,
              color: "rgba(255,184,112,0.9)",
              flexShrink: 0,
            }}
          >
            {initial}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: T.fontHeading,
                fontSize: 15,
                fontWeight: 600,
                color: "var(--foreground)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {character.title}
            </div>
            <div style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)" }}>
              {character.slug}
            </div>
          </div>
        </div>

        {stats && (
          <div
            style={{
              display: "flex",
              gap: "var(--space-12)",
              paddingTop: "var(--space-6)",
              borderTop: "1px solid var(--divider)",
            }}
          >
            <SidebarStat
              label="layers"
              value={
                stats.configuredCount != null && stats.totalLayers != null
                  ? `${stats.configuredCount} / ${stats.totalLayers}`
                  : "—"
              }
              tone="accent"
            />
            <SidebarStat
              label="tokens"
              value={stats.totalTokens ?? "—"}
              tone="muted"
            />
          </div>
        )}
      </div>

      {/* Sections */}
      {SECTIONS.map((sec) => (
        <SidebarSection
          key={sec.tier}
          heading={sec}
          layers={byTier[sec.tier]}
          activeHref={active}
          harnessRoot={harnessRoot}
        />
      ))}
    </aside>
  );
}

function SidebarSection({
  heading,
  layers,
  activeHref,
  harnessRoot,
}: {
  heading: SectionHeading;
  layers: LayerDef[];
  activeHref: string | null;
  harnessRoot: string;
}) {
  const headingColor = tierColor(heading.tier);
  return (
    <div style={{ padding: "18px 12px 6px", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px 8px",
        }}
      >
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: 9.5,
            letterSpacing: "0.16em",
            color: headingColor,
            textTransform: "uppercase",
          }}
        >
          {heading.label}
        </span>
        {heading.suffix && (
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-2xs)",
              letterSpacing: "0.08em",
              color: "var(--text-quaternary)",
              textTransform: "uppercase",
            }}
          >
            {heading.suffix}
          </span>
        )}
      </div>

      {layers.map((layer) => (
        <LayerRow
          key={layer.key}
          layer={layer}
          active={layer.href === activeHref}
          harnessRoot={harnessRoot}
        />
      ))}
    </div>
  );
}

function LayerRow({
  layer,
  active,
  harnessRoot,
}: {
  layer: LayerDef;
  active: boolean;
  harnessRoot: string;
}) {
  const dot = statusDot(layer.status);
  const href = `${harnessRoot}/${layer.href}`;

  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-10)",
        padding: active ? "8px 12px 8px 10px" : "8px 12px",
        borderRadius: "var(--radius-xs)",
        background: active ? "rgba(140,231,210,0.08)" : "transparent",
        // All four sides explicit — no `border` shorthand. The shorthand
        // would conflict with `borderLeft` on re-render (React warns) and
        // can produce styling bugs when the active state toggles.
        borderTop: "none",
        borderRight: "none",
        borderBottom: "none",
        borderLeft: active ? "2px solid var(--accent-strong)" : "2px solid transparent",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        color: "inherit",
        fontFamily: "inherit",
        textDecoration: "none",
      }}
    >
      <span style={{ color: dot.color, fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", width: 10 }}>
        {dot.glyph}
      </span>
      {layer.badge && (
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            color: active ? tierColor(layer.tier) : "var(--text-tertiary)",
            width: 24,
          }}
        >
          {layer.badge}
        </span>
      )}
      <span
        style={{
          fontFamily: T.fontBody,
          fontSize: "var(--font-size-md)",
          color: active ? "var(--foreground)" : "var(--text-secondary)",
          fontWeight: active ? 500 : 400,
          flex: 1,
          paddingLeft: layer.badge ? 0 : 34,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {layer.label}
      </span>
      {layer.tokens != null && (
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: 9.5,
            color: active ? tierColor(layer.tier) : "var(--text-quaternary)",
            flexShrink: 0,
          }}
        >
          {layer.tokens}
        </span>
      )}
    </Link>
  );
}

function SidebarStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "accent" | "muted";
}) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-2xs)",
          letterSpacing: "0.12em",
          color: "var(--text-quaternary)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-md)",
          color: tone === "accent" ? "var(--accent-strong)" : "var(--text-secondary)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
