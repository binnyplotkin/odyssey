"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CharacterBrainModel, EraConfig } from "@odyssey/db";
import {
  CharacterVoicePanel,
  type CharacterVoicePanelHandle,
  type CharacterVoicePanelVoiceState,
} from "@/components/character-voice-panel";
import {
  WavefieldStage,
  createEmptyAudioData,
  type AudioData,
} from "@/components/wavefield-stage";
import { Menu, type MenuItem } from "@/components/menu";
import {
  DEFAULT_VOICE_MODEL,
  modelMetaFor,
  modelsFor,
  providerFor,
} from "@/lib/model-registry";

/* ── Theme awareness ─────────────────────────────────────────────
 * Fully theme-adaptive. The wavefield 3D scene itself is hardcoded dark
 * (`backgroundColor: "#03060D"` in WavefieldStage), but the voice panel
 * sitting on top tracks the global theme — light glass card on light
 * theme, dark glass card on dark theme. Mapping:
 *
 *   - Panel surface bgs   → `var(--background)` mixed via color-mix()
 *   - Accent borders/bgs  → `var(--accent-strong)` mixed
 *   - Text + icons        → `var(--foreground)` mixed (flips light/dark)
 *   - Status colors       → hardcoded (listening red, speaking green,
 *                           warming yellow, error pink — semantic,
 *                           theme-agnostic by design)
 */

type Props = {
  character: {
    id: string;
    slug: string;
    title: string;
    image: string | null;
    eras: EraConfig[];
    /**
     * The character's L04 Brain/Model config — optional because the chat
     * view that mounts this component may not have loaded it. When
     * present, the voice picker initializes to:
     *   brainModel.voice.model      (explicit voice override)
     *   ?? brainModel.model          (chat model, if voice-capable)
     *   ?? DEFAULT_VOICE_MODEL      (hardcoded fallback)
     *
     * The user can still change the picker live before pressing "go" —
     * the saved preference is the default, not a lock.
     */
    brainModel?: CharacterBrainModel | null;
  };
};

type Moment = { era: string; index: number };

export function CharacterVoiceWavefield(props: Props) {
  const { character } = props;
  const waveAudioRef = useRef<AudioData>(createEmptyAudioData());
  const voicePanelRef = useRef<CharacterVoicePanelHandle | null>(null);
  const [voiceUiHidden, setVoiceUiHidden] = useState(false);
  const [voiceState, setVoiceState] = useState<CharacterVoicePanelVoiceState>({
    active: false,
    phase: "idle",
  });
  // Resolve the initial picker value from the character's L04 config.
  // Priority: explicit voice override → chat model (if voice-capable) →
  // hardcoded DEFAULT_VOICE_MODEL. Memoized so the picker doesn't snap
  // back to the default if the user toggles other state.
  const initialModel = useMemo(() => {
    const mm = character.brainModel;
    const voicePick = mm?.voice?.model;
    if (voicePick && modelsFor("voice").some((m) => m.id === voicePick)) {
      return voicePick;
    }
    const chatPick = mm?.model;
    if (chatPick && modelsFor("voice").some((m) => m.id === chatPick)) {
      return chatPick;
    }
    return DEFAULT_VOICE_MODEL;
  }, [character.brainModel]);
  const [model, setModel] = useState<string>(initialModel);
  // Lazy-mount the voice panel only after the user opts in. Mirrors how the
  // test chat mounts the panel on entering voice mode — keeps STT WS handshake
  // out of the page's initial-load critical path.
  const [started, setStarted] = useState(false);
  const [warmStartedAt] = useState<number>(() =>
    typeof performance !== "undefined" ? performance.now() : Date.now(),
  );
  const [warmElapsedMs, setWarmElapsedMs] = useState(0);
  // Railway audio-rt is always-on (Pocket TTS + faster-whisper warmed at
  // service startup), so there's no prewarm step to gate the UI on. Keep
  // warmStatus as state in case future changes want to surface real health.
  const [warmStatus] = useState<"warming" | "ready" | "error">("ready");

  // Tick a clock while the user is on the pre-flight screen. We use the
  // elapsed time to surface a "still warming" hint if the user is fast and
  // arrives before the containers are responsive.
  useEffect(() => {
    if (started) return;
    const id = window.setInterval(() => {
      setWarmElapsedMs(
        (typeof performance !== "undefined" ? performance.now() : Date.now()) -
          warmStartedAt,
      );
    }, 500);
    return () => window.clearInterval(id);
  }, [started, warmStartedAt]);

  const availableModels = useMemo(() => modelsFor("voice"), []);
  // Voice surface only supports Anthropic + Cerebras today (OpenAI's realtime
  // API is a different shape we haven't integrated). The registry returns the
  // wider ProviderId union; narrow at the boundary with a fallback to
  // "cerebras" if somehow an unsupported provider slips through the picker.
  const rawProvider = providerFor(model);
  const provider: "anthropic" | "cerebras" =
    rawProvider === "anthropic" ? "anthropic" : "cerebras";
  const modelMeta = modelMetaFor(model);
  // Locked once the panel has mounted — model can't change mid-session.
  const modelLocked = started;

  const defaultMoment = useMemo<Moment | null>(() => {
    const sorted = [...character.eras].sort((a, b) => b.order - a.order);
    if (sorted.length === 0) return null;
    return { era: sorted[0].key, index: 99 };
  }, [character.eras]);

  const dockGlow = !voiceState.active
    ? "color-mix(in srgb, var(--foreground) 14%, transparent)"
    : voiceState.phase === "listening"
      ? "rgba(239,68,68,0.58)"
      : voiceState.phase === "speaking"
        ? "rgba(74,222,128,0.56)"
        : voiceState.phase === "thinking" || voiceState.phase === "warming"
          ? "color-mix(in srgb, var(--accent-strong) 56%, transparent)"
          : "rgba(248,113,113,0.56)";
  const dockMicBackground = !voiceState.active
    ? "color-mix(in srgb, var(--background) 70%, transparent)"
    : voiceState.phase === "listening"
      ? "rgba(239,68,68,0.16)"
      : voiceState.phase === "speaking"
        ? "rgba(74,222,128,0.16)"
        : "color-mix(in srgb, var(--accent-strong) 15%, transparent)";

  return (
    // Self-contained wrapper. All inner positioned children use `absolute`
    // and resolve against this. Works whether the parent is a dedicated full
    // page (e.g. /voice) or an embedded tab inside the chat workspace.
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <WavefieldStage
        audioData={waveAudioRef.current}
        atmosphere={voiceState.phase === "speaking" ? 1 : 0}
        idleMotion="static"
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 20,
          pointerEvents: "none",
          display: "flex",
          justifyContent: "flex-end",
          padding: "20px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: "min(520px, 42vw)",
            minWidth: 420,
            // Fill the parent flex container's content box (wavefield wrapper
            // minus the parent's 20px padding). Using `height: 100%` instead of
            // `calc(100vh - 40px)` so the card stays inside the workspace when
            // embedded under a header (chat tab) — the dedicated /voice route
            // works the same since its parent is the full main element.
            height: "100%",
            borderRadius: "var(--radius-3xl)",
            border: "1px solid color-mix(in srgb, var(--accent-strong) 28%, transparent)",
            background: "color-mix(in srgb, var(--background) 68%, transparent)",
            backdropFilter: "blur(14px)",
            boxShadow: "var(--elevation-panel)",
            overflow: "hidden",
            pointerEvents: voiceUiHidden ? "none" : "auto",
            display: "flex",
            flexDirection: "column",
            opacity: voiceUiHidden ? 0 : 1,
            transform: voiceUiHidden ? "translateX(calc(100% + 40px))" : "translateX(0)",
            transition: "opacity 180ms ease, transform 220ms ease",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              borderBottom: "1px solid color-mix(in srgb, var(--accent-strong) 20%, transparent)",
              background: "color-mix(in srgb, var(--background) 66%, transparent)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "var(--font-size-xs)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "color-mix(in srgb, var(--foreground) 85%, transparent)",
                }}
              >
                Voice Session
              </span>
              <span
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: "var(--font-size-xl)",
                  fontWeight: 600,
                  color: "color-mix(in srgb, var(--foreground) 96%, transparent)",
                }}
              >
                Voice Pipeline
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
              <button
                type="button"
                aria-label="Hide voice session panel"
                onClick={() => setVoiceUiHidden(true)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  border: "1px solid color-mix(in srgb, var(--accent-strong) 28%, transparent)",
                  background: "color-mix(in srgb, var(--background) 35%, transparent)",
                  color: "color-mix(in srgb, var(--foreground) 88%, transparent)",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Pre-flight stage: pick the model BEFORE the panel mounts. Locked
              while a session is active so it's clear which model is running. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-10)",
              padding: "10px 14px",
              borderBottom: "1px solid color-mix(in srgb, var(--accent-strong) 18%, transparent)",
              background: "color-mix(in srgb, var(--background) 55%, transparent)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", minWidth: 0 }}>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 9.5,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "color-mix(in srgb, var(--foreground) 72%, transparent)",
                }}
              >
                {modelLocked ? "Running" : "Model"}
              </span>
              {modelLocked && (
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background:
                      voiceState.phase === "listening"
                        ? "#ef4444"
                        : voiceState.phase === "speaking"
                          ? "#4ade80"
                          : "var(--accent-strong)",
                    boxShadow: "0 0 6px currentColor",
                  }}
                />
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
              {modelLocked ? (
                <span
                  style={{
                    padding: "4px 10px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid color-mix(in srgb, var(--accent-strong) 32%, transparent)",
                    background: "color-mix(in srgb, var(--accent-strong) 10%, transparent)",
                    color: "color-mix(in srgb, var(--foreground) 94%, transparent)",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "var(--font-size-xs)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                  title="Stop the session to change models"
                >
                  {modelMeta?.label ?? model}
                  <span
                    style={{
                      marginLeft: "var(--space-6)",
                      opacity: 0.55,
                      fontWeight: 500,
                    }}
                  >
                    {modelMeta?.provider}
                  </span>
                </span>
              ) : (
                <Menu
                  value={model}
                  onChange={setModel}
	                  ariaLabel="Voice model"
	                  disabled={modelLocked}
	                  align="right"
	                  minWidth={304}
	                  items={availableModels.map((m): MenuItem<string> => ({
	                    value: m.id,
	                    label: m.label,
                    meta: m.provider,
                  }))}
                  triggerStyle={{
                    padding: "4px 10px",
                    border: "1px solid color-mix(in srgb, var(--accent-strong) 32%, transparent)",
                    background: "color-mix(in srgb, var(--background) 45%, transparent)",
                    color: "color-mix(in srgb, var(--foreground) 94%, transparent)",
                    fontFamily: "'JetBrains Mono', monospace",
	                    fontSize: "var(--font-size-xs)",
	                    letterSpacing: "0.06em",
	                    textTransform: "uppercase",
	                    whiteSpace: "nowrap",
	                  }}
	                />
              )}
            </div>
          </div>

          {started ? (
            <CharacterVoicePanel
              ref={voicePanelRef}
              character={{
                id: character.id,
                slug: character.slug,
                title: character.title,
                image: character.image,
              }}
              moment={defaultMoment}
              scene={{ activeEntities: [], location: null }}
              provider={provider}
              model={model}
              tokenBudget={1500}
              waveformSource="tts-only"
              onVoiceStateChange={setVoiceState}
              onWaveformAudio={(audio) => {
                waveAudioRef.current.energy = audio.energy;
                waveAudioRef.current.bass = audio.bass;
                waveAudioRef.current.mid = audio.mid;
                waveAudioRef.current.high = audio.high;
                waveAudioRef.current.peak = audio.peak;
                waveAudioRef.current.active = audio.active;
              }}
            />
          ) : (
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "var(--space-18)",
                padding: "32px",
                textAlign: "center",
              }}
            >
              <span
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: "var(--font-size-md)",
                  lineHeight: "20px",
                  color: "color-mix(in srgb, var(--foreground) 78%, transparent)",
                  maxWidth: 320,
                }}
              >
                Pick the model you want to test, then tap{" "}
                <strong style={{ color: "var(--foreground)" }}>Start session</strong> to
                wake the voice pipeline.
              </span>
              <button
                type="button"
                onClick={() => setStarted(true)}
                style={{
                  padding: "10px 22px",
                  borderRadius: "var(--radius-pill)",
                  border: "1px solid color-mix(in srgb, var(--accent-strong) 42%, transparent)",
                  background: "var(--accent-fill)",
                  color: "var(--foreground)",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "var(--font-size-sm)",
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  boxShadow: "var(--elevation-card)",
                }}
              >
                Start session
              </button>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 9.5,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "color-mix(in srgb, var(--foreground) 46%, transparent)",
                }}
              >
                {modelMeta?.label ?? model} · {modelMeta?.provider ?? provider}
              </span>
              {/* Server health indicator. Hidden during the first ~1.5s
                  ('ready' may resolve faster than that and we don't want a
                  flash). After that, dot color tracks status and the message
                  escalates with elapsed time only while still warming. */}
              {warmElapsedMs > 1500 && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-8)",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: "var(--font-size-sm)",
                    color: "color-mix(in srgb, var(--foreground) 62%, transparent)",
                    marginTop: "var(--space-4)",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background:
                        warmStatus === "ready"
                          ? "#4ade80"
                          : warmStatus === "error"
                            ? "#f87171"
                            : "#FACC15",
                      boxShadow:
                        warmStatus === "ready"
                          ? "0 0 6px rgba(74,222,128,0.55)"
                          : warmStatus === "error"
                            ? "0 0 6px rgba(248,113,113,0.6)"
                            : "0 0 6px rgba(250,204,21,0.55)",
                      animation:
                        warmStatus === "warming"
                          ? "voice-warm-pulse 1.4s ease-in-out infinite"
                          : "none",
                    }}
                  />
                  {warmStatus === "ready"
                    ? "Voice servers ready"
                    : warmStatus === "error"
                      ? "Couldn't reach voice servers — try anyway?"
                      : warmElapsedMs > 25000
                        ? "Voice servers are still cold-starting — first start can take ~60s."
                        : "Warming voice servers in the background…"}
                </span>
              )}
              <style>{`
                @keyframes voice-warm-pulse {
                  0%, 100% { opacity: 1; }
                  50% { opacity: 0.45; }
                }
              `}</style>
            </div>
          )}
        </div>
      </div>

      {voiceUiHidden ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 20,
            zIndex: 24,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-8)",
              padding: "8px 10px",
              borderRadius: "var(--radius-pill)",
              border: "1px solid color-mix(in srgb, var(--accent-strong) 28%, transparent)",
              background: "color-mix(in srgb, var(--background) 72%, transparent)",
              backdropFilter: "blur(10px)",
              boxShadow: "var(--elevation-card)",
              pointerEvents: "auto",
            }}
          >
            <button
              type="button"
              onClick={() => voicePanelRef.current?.toggleVoiceMode()}
              aria-label={voiceState.active ? "Stop voice mode" : "Start voice mode"}
              style={{
                width: 46,
                height: 46,
                borderRadius: "50%",
                border: `2px solid ${dockGlow}`,
                background: dockMicBackground,
                color: "color-mix(in srgb, var(--foreground) 97%, transparent)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.15s ease",
              }}
            >
              {!voiceState.active ? (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              )}
            </button>

            <button
              type="button"
              onClick={() => setVoiceUiHidden(false)}
              style={{
                padding: "8px 12px",
                borderRadius: "var(--radius-pill)",
                border: "1px solid color-mix(in srgb, var(--accent-strong) 32%, transparent)",
                background: "color-mix(in srgb, var(--background) 52%, transparent)",
                color: "color-mix(in srgb, var(--foreground) 94%, transparent)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              Open Voice UI
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
