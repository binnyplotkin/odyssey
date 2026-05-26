"use client";

import type { LayerDef } from "../harness-types";

/**
 * Fallback editor for any layer whose schema + editor haven't landed yet.
 * Shows the layer's intent + a "what this layer will hold" preview so the
 * shell can be navigated end-to-end before every layer is built out.
 */

const T = {
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

export function LayerPlaceholder({ layer }: { layer: LayerDef }) {
  return (
    <div
      style={{
        padding: "var(--space-32)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-18)",
        maxWidth: 760,
      }}
    >
      <div
        style={{
          padding: "var(--space-24)",
          background: "var(--card)",
          border: "1px dashed var(--card-border)",
          borderRadius: "var(--radius-md)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-12)",
        }}
      >
        <div
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            color: "var(--text-tertiary)",
            textTransform: "uppercase",
          }}
        >
          editor · not built yet
        </div>
        <div
          style={{
            fontFamily: T.fontHeading,
            fontSize: "var(--font-size-2xl)",
            fontWeight: 600,
            color: "var(--foreground)",
          }}
        >
          {layer.label}
        </div>
        <div
          style={{
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-md)",
            lineHeight: 1.55,
            color: "var(--text-secondary)",
          }}
        >
          {layer.description}
        </div>
        <div
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: "var(--text-tertiary)",
            padding: "10px 12px",
            background: "var(--input-bg)",
            border: "1px solid var(--input-border)",
            borderRadius: "var(--radius-xs)",
          }}
        >
          The shell, sidebar nav, and live preview rail on the right work today.
          This layer&apos;s schema + editor land in its own pass — see the Paper
          deck for the design.
        </div>
      </div>
    </div>
  );
}
