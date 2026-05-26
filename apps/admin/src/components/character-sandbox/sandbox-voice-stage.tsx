"use client";

import type { SandboxCharacter } from "@/app/(authenticated)/characters/[slug]/sandbox/page";

/**
 * SandboxVoiceStage — center stage when the sandbox is in voice mode.
 * Renders the state pill, big Inter character title with sub-eyebrow,
 * a wavefield placeholder (procedural SVG bars), the captured-utterance
 * caption, and the bottom mic dock.
 *
 * The wavefield is procedural for now; once we wire real STT amplitude
 * data, swap the static bars for a live AudioContext analyzer.
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
            }}
          >
            {subEyebrow}
          </span>
        )}
      </div>

      <Wavefield state={state} />

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
          {micOn ? "tap to mute" : "tap to unmute"} · space to push-to-talk
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
      aria-label={on ? "Mute mic" : "Unmute mic"}
      style={{
        width: 72,
        height: 72,
        borderRadius: "50%",
        border: on
          ? "1px solid var(--accent-glow)"
          : "1px solid var(--border)",
        background: on
          ? "color-mix(in srgb, var(--accent-strong) 12%, transparent)"
          : "transparent",
        color: on ? ACCENT : "var(--text-tertiary)",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: on
          ? "0 0 24px var(--accent-border)"
          : "none",
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

function Wavefield({ state }: { state: VoiceState }) {
  // Procedural amplitudes. When state is idle/speaking we render a flatter
  // shape; listening/thinking get a more energetic profile. Replace with a
  // live FFT analyser when real audio capture is wired.
  const samples = buildWaveSamples(state);
  return (
    <div
      style={{
        width: 720,
        height: 240,
        border:
          "1px solid color-mix(in srgb, var(--accent-strong) 25%, transparent)",
        background: "color-mix(in srgb, var(--accent-strong) 4%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <svg
        width="640"
        height="180"
        viewBox="0 0 640 180"
        fill="none"
        aria-hidden
      >
        <g stroke={ACCENT} strokeWidth={2} strokeLinecap="round" opacity={0.85}>
          {samples.map((amp, i) => {
            const x = 20 + i * 16;
            const cy = 90;
            const half = amp * 80;
            return (
              <line
                key={i}
                x1={x}
                y1={cy - half}
                x2={x}
                y2={cy + half}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function buildWaveSamples(state: VoiceState): number[] {
  const count = 38;
  const energy =
    state === "listening" ? 1 : state === "thinking" ? 0.6 : state === "speaking" ? 0.85 : 0.15;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    // Mix a couple of sines for an organic shape.
    const base =
      Math.sin(i * 0.42) * 0.5 + Math.sin(i * 1.1 + 0.4) * 0.35 + 0.5;
    const jitter = Math.sin(i * 3.1) * 0.18;
    out.push(Math.max(0.05, Math.min(1, (base + jitter) * energy)));
  }
  return out;
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
    character.identity?.traits?.map((t) => t.name.toLowerCase()).filter(Boolean) ??
    [];
  if (traits.length > 0) return traits.slice(0, 3).join(" · ");
  return character.summary ?? "";
}

const ANIM_CSS = `@keyframes sandbox-pulse{0%,100%{opacity:1}50%{opacity:.4}}`;
