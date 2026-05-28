"use client";

import type { SandboxCharacter } from "@/app/(authenticated)/characters/[slug]/sandbox/page";

/**
 * SandboxVoiceStage — center stage when the sandbox is in voice mode.
 * Renders the state pill, big Inter character title with sub-eyebrow,
 * the captured-utterance caption, and the bottom mic dock over the global
 * Three.js wavefield mounted by CharacterSandbox.
 */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

export function SandboxVoiceStage({
  character,
  state,
  micOn,
  onMicToggle,
  lastUserUtterance,
}: {
  character: SandboxCharacter;
  state: VoiceState;
  micOn: boolean;
  onMicToggle: () => void;
  lastUserUtterance: string | null;
}) {
  const stateLabel: Record<VoiceState, string> = {
    idle: "ready",
    listening: "listening",
    thinking: "thinking",
    speaking: "speaking",
  };
  const subEyebrow = composeSubEyebrow(character);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-32)",
        padding: 60,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-12)",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-sm)",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: ACCENT,
          textShadow:
            "0 0 18px color-mix(in srgb, var(--background) 78%, transparent)",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: ACCENT,
            boxShadow: `0 0 12px ${ACCENT}`,
            animation:
              state === "listening" || state === "thinking"
                ? "sandbox-pulse 1.2s ease-in-out infinite"
                : undefined,
          }}
        />
        {stateLabel[state]}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-8)",
        }}
      >
        <span
          style={{
            fontFamily: FONT_HEAD,
            fontSize: 72,
            fontWeight: 600,
            color: "var(--text-primary)",
            letterSpacing: "-0.03em",
            lineHeight: 1,
            textShadow:
              "0 10px 40px color-mix(in srgb, var(--background) 72%, transparent)",
          }}
        >
          {character.title}
        </span>
        {subEyebrow && (
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
              textShadow:
                "0 8px 28px color-mix(in srgb, var(--background) 76%, transparent)",
            }}
          >
            {subEyebrow}
          </span>
        )}
      </div>

      {lastUserUtterance && (
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-base)",
            color: "var(--text-secondary)",
            letterSpacing: "0.04em",
            maxWidth: 640,
            textAlign: "center",
            lineHeight: 1.6,
            padding: "12px 16px",
            background:
              "color-mix(in srgb, var(--background) 52%, transparent)",
            backdropFilter: "blur(8px)",
            border:
              "1px solid color-mix(in srgb, var(--accent-strong) 18%, transparent)",
          }}
        >
          &ldquo;{lastUserUtterance}&rdquo; · captured · ready to respond
        </div>
      )}

      <style>{ANIM_CSS}</style>

      <div
        style={{
          position: "absolute",
          bottom: 40,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-14)",
        }}
      >
        <MicButton on={micOn} onClick={onMicToggle} />
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          voice input {micOn ? "on" : "off"} · chat replies speak
        </span>
      </div>
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────────────── */

function MicButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={on ? "Turn voice input off" : "Turn voice input on"}
      style={{
        width: 72,
        height: 72,
        borderRadius: "50%",
        border: on ? "1px solid var(--accent-glow)" : "1px solid var(--border)",
        background: on
          ? "color-mix(in srgb, var(--accent-strong) 12%, transparent)"
          : "transparent",
        color: on ? ACCENT : "var(--text-tertiary)",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: on ? "0 0 24px var(--accent-border)" : "none",
        transition: "box-shadow 120ms, background 120ms, border-color 120ms",
      }}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
        <g
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          {!on && <line x1="3" y1="3" x2="21" y2="21" />}
        </g>
      </svg>
    </button>
  );
}

function composeSubEyebrow(character: SandboxCharacter): string {
  const essence = character.identity?.essence?.trim();
  if (essence) {
    // Pull a short tagline — first comma fragment or first 60 chars.
    const firstClause = essence.split(",")[0]?.trim() ?? essence;
    return firstClause.length > 80
      ? firstClause.slice(0, 78).trim() + "…"
      : firstClause;
  }
  const traits =
    character.identity?.traits
      ?.map((t) => t.name.toLowerCase())
      .filter(Boolean) ?? [];
  if (traits.length > 0) return traits.slice(0, 3).join(" · ");
  return character.summary ?? "";
}

const ANIM_CSS = `@keyframes sandbox-pulse{0%,100%{opacity:1}50%{opacity:.4}}`;
