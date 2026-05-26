"use client";

import { useMemo, useState } from "react";
import {
  compileDirectiveXml,
  compileIdentityXml,
  compileVoiceXml,
} from "@/lib/character-prompt-builders";
import { estimateTokens } from "@odyssey/wiki-curator";
import type { HarnessCharacter, LayerDef } from "./harness-types";
import { L01Identity } from "./editors/l01-identity";
import { L02Directive } from "./editors/l02-directive";
import { L03VoiceStyle } from "./editors/l03-voice-style";
import { L04BrainModel } from "./editors/l04-brain-model";
import { LayerPlaceholder } from "./editors/layer-placeholder";

/**
 * Editor pane body for a single layer. The HarnessShell provides the outer
 * scrolling <main>; this component just renders the layer header + body
 * inside it.
 *
 * Pre-refactor this also rendered the eval surface (test-regression case)
 * — now those have their own routes (/harness/runs, /harness/sweeps, etc.)
 * and don't go through this pane at all.
 */

const T = {
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

type Props = {
  character: HarnessCharacter;
  layer: LayerDef;
};

export function HarnessEditorPane({ character, layer }: Props) {
  const [activeTab, setActiveTab] = useState<string>(layer.tabs[0]);

  // Live token estimate per layer. We compile the same XML the system-
  // prompt builder will compile and run it through the chars/4 estimator
  // the wiki curator uses. Layers we haven't wired yet keep the static
  // `layer.tokens` placeholder so the header doesn't show a missing or
  // mid-build number. Add new cases as each L0n editor is audited.
  const liveTokens = useMemo<string | null>(() => {
    if (layer.key === "l01") {
      const xml = compileIdentityXml(character.title, character.identity);
      // Empty identity → the structured-prompt builder falls back to a
      // short hardcoded line. Measure that line so the header doesn't
      // jump from 42 → 0 when L01 is cleared.
      const measured = xml
        ? xml
        : `<identity>\n  You are ${character.title}. You speak in first person, never narrate or stage-direct. You do not break character.\n</identity>`;
      return String(estimateTokens(measured));
    }
    if (layer.key === "l02") {
      // Directive can be null (legacy characters). Compiler returns ""
      // in that case and the system-prompt builder falls back to the
      // single-paragraph legacy template — measure 0 here so the header
      // honestly reflects "no directive XML in the envelope right now."
      const xml = compileDirectiveXml(character.directive);
      return String(estimateTokens(xml));
    }
    if (layer.key === "l03") {
      // Voice style: only the LLM-facing axes (tone / decision / brevity
      // / register) compile into <voice>. Audio-channel fields are
      // intentionally excluded from the measure since they don't reach
      // the model — the compiler already handles that filter.
      const xml = compileVoiceXml(character.voiceStyle);
      return String(estimateTokens(xml));
    }
    return null;
  }, [layer.key, character.identity, character.title, character.directive, character.voiceStyle]);

  return (
    <>
      <LayerHeader
        layer={layer}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        liveTokens={liveTokens}
      />
      {renderBody(character, layer, activeTab)}
    </>
  );
}

// Every layer with multiple tabs now receives `activeTab`. Children that
// haven't split into per-tab surfaces yet (L02, L03) accept the prop and
// default the unknown tabs to a "not yet wired" placeholder so the
// header's tab strip stops lying. L01 + L04 fully dispatch on activeTab.
function renderBody(character: HarnessCharacter, layer: LayerDef, activeTab: string) {
  switch (layer.key) {
    case "l01":
      return <L01Identity character={character} activeTab={activeTab} />;
    case "l02":
      return <L02Directive character={character} activeTab={activeTab} />;
    case "l03":
      return <L03VoiceStyle character={character} activeTab={activeTab} />;
    case "l04":
      return <L04BrainModel character={character} activeTab={activeTab} />;
    default:
      return <LayerPlaceholder layer={layer} />;
  }
}

function LayerHeader({
  layer,
  activeTab,
  onTabChange,
  liveTokens,
}: {
  layer: LayerDef;
  activeTab: string;
  onTabChange: (t: string) => void;
  /**
   * Live char-based token estimate for this layer's compiled output.
   * When provided, replaces the static `layer.tokens` placeholder and
   * picks up a "live" badge so authors see the number is real, not the
   * canned fiction it used to be.
   */
  liveTokens: string | null;
}) {
  return (
    <header
      style={{
        padding: "24px 32px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-16)",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)", flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.16em",
              color: "var(--accent-strong)",
              textTransform: "uppercase",
            }}
          >
            {layer.eyebrow}
          </span>
          {(liveTokens ?? layer.tokens) && (
            <>
              <span style={{ color: "var(--text-quaternary)" }}>/</span>
              <span
                style={{
                  fontFamily: T.fontMono,
                  fontSize: "var(--font-size-xs)",
                  color: "var(--text-tertiary)",
                }}
              >
                {liveTokens ?? layer.tokens} {layer.tier === "t1" ? "tokens · cached envelope" : ""}
              </span>
              {liveTokens && (
                <span
                  style={{
                    fontFamily: T.fontMono,
                    fontSize: "var(--font-size-2xs)",
                    padding: "1px 6px",
                    borderRadius: "var(--radius-xs)",
                    background: "rgba(140,231,210,0.08)",
                    color: "var(--accent-strong)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                  // The chars/4 estimator is within ~10-15% of Anthropic's
                  // BPE tokenizer for English prose — surface the
                  // approximation so authors don't read this as exact.
                  title="Chars/4 approximation. ±10-15% vs Anthropic's tokenizer for English prose."
                >
                  live · ~
                </span>
              )}
            </>
          )}
        </div>
        <h1
          style={{
            margin: 0,
            fontFamily: T.fontHeading,
            fontSize: 28,
            fontWeight: 600,
            color: "var(--foreground)",
            lineHeight: 1.1,
          }}
        >
          {layer.label}
        </h1>
        <p
          style={{
            margin: 0,
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-md)",
            color: "var(--text-tertiary)",
            maxWidth: 600,
          }}
        >
          {layer.description}
        </p>
      </div>

      {layer.tabs.length > 1 && (
        <nav
          style={{
            display: "flex",
            gap: "var(--space-4)",
            padding: "var(--space-3)",
            background: "var(--card)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--card-border)",
            flexShrink: 0,
          }}
        >
          {layer.tabs.map((tab) => {
            const active = tab === activeTab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => onTabChange(tab)}
                style={{
                  padding: "7px 14px",
                  fontFamily: T.fontMono,
                  fontSize: "var(--font-size-xs)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: active ? "var(--foreground)" : "var(--text-tertiary)",
                  background: active ? "rgba(140,231,210,0.10)" : "transparent",
                  border: active ? "1px solid rgba(140,231,210,0.25)" : "1px solid transparent",
                  borderRadius: "var(--radius-xs)",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                {tab}
              </button>
            );
          })}
        </nav>
      )}
    </header>
  );
}
