"use client";

import { useMemo, useRef } from "react";
import type { EraConfig } from "@odyssey/db";
import { CharacterVoicePanel } from "@/components/character-voice-panel";
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

  const defaultMoment = useMemo<Moment | null>(() => {
    const sorted = [...character.eras].sort((a, b) => b.order - a.order);
    if (sorted.length === 0) return null;
    return { era: sorted[0].key, index: 99 };
  }, [character.eras]);

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
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
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

          <CharacterVoicePanel
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
    </>
  );
}
