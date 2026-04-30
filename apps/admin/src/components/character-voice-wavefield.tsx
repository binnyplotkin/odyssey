"use client";

import { useMemo, useRef, useState } from "react";
import type { EraConfig } from "@odyssey/db";
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

type Props = {
  character: {
    id: string;
    slug: string;
    title: string;
    image: string | null;
    eras: EraConfig[];
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

  const defaultMoment = useMemo<Moment | null>(() => {
    const sorted = [...character.eras].sort((a, b) => b.order - a.order);
    if (sorted.length === 0) return null;
    return { era: sorted[0].key, index: 99 };
  }, [character.eras]);

  const dockGlow = !voiceState.active
    ? "rgba(255,255,255,0.14)"
    : voiceState.phase === "listening"
      ? "rgba(239,68,68,0.58)"
      : voiceState.phase === "speaking"
        ? "rgba(74,222,128,0.56)"
        : voiceState.phase === "thinking" || voiceState.phase === "warming"
          ? "rgba(140,231,210,0.56)"
          : "rgba(248,113,113,0.56)";
  const dockMicBackground = !voiceState.active
    ? "rgba(8,14,22,0.7)"
    : voiceState.phase === "listening"
      ? "rgba(239,68,68,0.16)"
      : voiceState.phase === "speaking"
        ? "rgba(74,222,128,0.16)"
        : "rgba(140,231,210,0.15)";

  return (
    <>
      <WavefieldStage audioData={waveAudioRef.current} atmosphere={1} />

      <div
        style={{
          position: "fixed",
          inset: 0,
          left: "var(--sidebar-width, 240px)",
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
            height: "calc(100vh - 40px)",
            borderRadius: 18,
            border: "1px solid rgba(140,231,210,0.28)",
            background: "rgba(8, 14, 22, 0.68)",
            backdropFilter: "blur(14px)",
            boxShadow: "0 18px 56px rgba(0,0,0,0.45)",
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
              borderBottom: "1px solid rgba(140,231,210,0.2)",
              background: "rgba(8,16,28,0.66)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "rgba(191,245,239,0.85)",
                }}
              >
                Voice Session
              </span>
              <span
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: 16,
                  fontWeight: 600,
                  color: "rgba(236,248,255,0.96)",
                }}
              >
                Speak To {character.title}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={() => setVoiceUiHidden(true)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 7,
                  border: "1px solid rgba(140,231,210,0.28)",
                  background: "rgba(8,14,22,0.35)",
                  color: "rgba(191,245,239,0.88)",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                Hide
              </button>
              <a
                href={`/characters/${character.slug}`}
                style={{
                  textDecoration: "none",
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12,
                  color: "rgba(191,245,239,0.9)",
                }}
              >
                Back
              </a>
            </div>
          </div>

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
            model="claude-sonnet-4-5"
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
        </div>
      </div>

      {voiceUiHidden ? (
        <div
          style={{
            position: "fixed",
            left: "var(--sidebar-width, 240px)",
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
              gap: 8,
              padding: "8px 10px",
              borderRadius: 999,
              border: "1px solid rgba(140,231,210,0.28)",
              background: "rgba(8,14,22,0.72)",
              backdropFilter: "blur(10px)",
              boxShadow: "0 14px 34px rgba(0,0,0,0.4)",
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
                color: "rgba(236,248,255,0.97)",
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
                borderRadius: 999,
                border: "1px solid rgba(140,231,210,0.32)",
                background: "rgba(8,16,28,0.52)",
                color: "rgba(191,245,239,0.94)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
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
    </>
  );
}
