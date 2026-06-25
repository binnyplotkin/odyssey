"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Scene } from "@odyssey/types";
import {
  LiveKitVoiceSession,
  type LiveKitVoiceState,
} from "@/lib/livekit-voice-session";
import {
  AdminButton,
  AdminKicker,
  AdminPanel,
  AdminStatusPill,
  adminTokens,
  type AdminTone,
} from "@/components/admin-ui";
import {
  WavefieldStage,
  createEmptyAudioData,
  type AudioData,
} from "@/components/wavefield-stage";

type Status = "idle" | "connecting" | "live" | "ended";

type VoiceTurn = {
  id: string;
  speakerLabel: string;
  isUser: boolean;
  text: string;
  inFlight: boolean;
};

const STATE_LABEL: Record<LiveKitVoiceState, string> = {
  idle: "idle",
  listening: "your turn",
  thinking: "thinking",
  speaking: "speaking",
};

const STATE_TONE: Record<LiveKitVoiceState, AdminTone> = {
  idle: "muted",
  listening: "success",
  thinking: "processing",
  speaking: "accent",
};

/**
 * Drives a multi-character SCENE over a LiveKit room (the voice-agent's
 * SceneDriver). The browser publishes its mic; the worker runs STT + turn
 * detection, asks the orchestrator who speaks next, voices that character, and
 * publishes the audio + a speaker-labeled transcript back. This is the world's
 * front door — the LiveKit twin of the SSE-driven SceneSandbox, mounted when
 * NEXT_PUBLIC_VOICE_AGENT is on.
 */
export function SceneVoiceSandbox({
  sceneId,
  sceneTitle,
  scene,
}: {
  sceneId: string;
  sceneTitle: string;
  scene: Scene;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [voiceState, setVoiceState] = useState<LiveKitVoiceState>("idle");
  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(false);

  const sessionRef = useRef<LiveKitVoiceSession | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const waveAudioRef = useRef<AudioData>(createEmptyAudioData());
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length]);

  // Always tear the room down on unmount.
  useEffect(() => {
    return () => {
      void sessionRef.current?.disconnect();
      sessionRef.current = null;
    };
  }, []);

  async function enter() {
    if (status === "connecting" || status === "live") return;
    setStatus("connecting");
    setError(null);
    setTurns([]);
    startedAtRef.current = Date.now();
    sessionIdRef.current ??= crypto.randomUUID();

    const session = new LiveKitVoiceSession({
      onStateChange: (next) => {
        setVoiceState(next);
      },
      onAudioMetrics: (metrics) => {
        const wave = waveAudioRef.current;
        wave.energy = metrics.energy;
        wave.bass = metrics.bass;
        wave.mid = metrics.mid;
        wave.high = metrics.high;
        wave.peak = metrics.peak;
        wave.active = metrics.active;
      },
      onTranscript: (segment) => {
        const turnId = `lk-${segment.id}`;
        const isUser = segment.role === "user";
        const speakerLabel = isUser ? "You" : segment.speaker?.name ?? sceneTitle;
        if (!isUser) setCurrentSpeaker(speakerLabel);
        setTurns((prev) => {
          const idx = prev.findIndex((turn) => turn.id === turnId);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = {
              ...next[idx],
              text: segment.text,
              speakerLabel,
              inFlight: !segment.final,
            };
            return next;
          }
          return [
            ...prev,
            { id: turnId, speakerLabel, isUser, text: segment.text, inFlight: !segment.final },
          ];
        });
      },
      onError: (message) => setError(message),
    });
    sessionRef.current = session;

    try {
      await session.connect({ sceneId, sessionId: sessionIdRef.current });
      setMicOn(true);
      setStatus("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("idle");
      sessionRef.current = null;
    }
  }

  async function leave() {
    await sessionRef.current?.disconnect();
    sessionRef.current = null;
    setMicOn(false);
    setVoiceState("idle");
    setCurrentSpeaker(null);
    setStatus("ended");
  }

  async function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    await sessionRef.current?.setMicEnabled(next);
  }

  const live = status === "live";
  const cast = scene.characters.map((c) => c.displayName).join(", ");

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        background: adminTokens.bg,
        color: adminTokens.fg,
        fontFamily: adminTokens.fontBody,
        minHeight: "calc(100vh - 48px)",
      }}
    >
      <WavefieldStage audioData={waveAudioRef.current} idleMotion="static" />
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          pointerEvents: "none",
          background:
            "linear-gradient(90deg, color-mix(in srgb, var(--background) 92%, transparent) 0%, color-mix(in srgb, var(--background) 76%, transparent) 48%, color-mix(in srgb, var(--background) 44%, transparent) 100%)",
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-20)",
          padding: "var(--space-32) 40px 96px",
          maxWidth: 860,
          minHeight: "calc(100vh - 48px)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <Link
            href={`/scenes/${sceneId}`}
            style={{
              color: adminTokens.muted,
              fontFamily: adminTokens.fontMono,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              textDecoration: "none",
            }}
          >
            ← {sceneTitle}
          </Link>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-10)" }}>
            <AdminKicker>Live scene</AdminKicker>
            <h1
              style={{
                margin: 0,
                fontFamily: adminTokens.fontDisplay,
                fontSize: "var(--font-size-2xl)",
                fontWeight: 600,
              }}
            >
              {sceneTitle}
            </h1>
          </div>
          {cast && (
            <span style={{ color: adminTokens.muted, fontSize: "var(--font-size-sm)" }}>
              Cast: {cast}
            </span>
          )}
        </div>

        {error && (
          <AdminPanel>
            <span style={{ color: adminTokens.danger, fontSize: "var(--font-size-sm)" }}>{error}</span>
          </AdminPanel>
        )}

        {status === "idle" && (
          <AdminPanel style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
            <AdminKicker>Enter the scene</AdminKicker>
            <span style={{ color: adminTokens.text, lineHeight: 1.5 }}>
              Join the room and speak. The orchestrator picks who answers each turn and
              voices them live — no typing required.
            </span>
          </AdminPanel>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-12)",
          }}
        >
          <AdminStatusPill tone={live ? STATE_TONE[voiceState] : "muted"} dot>
            {status === "connecting"
              ? "connecting"
              : status === "ended"
                ? "left scene"
                : live
                  ? STATE_LABEL[voiceState]
                  : "idle"}
            {live && voiceState === "speaking" && currentSpeaker ? ` · ${currentSpeaker}` : ""}
          </AdminStatusPill>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
            {live && (
              <button
                type="button"
                onClick={toggleMic}
                title={micOn ? "Mute mic" : "Unmute mic"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-6)",
                  minHeight: 32,
                  padding: "0 12px",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${micOn ? adminTokens.accent : adminTokens.border}`,
                  background: micOn ? adminTokens.accentSoft : "transparent",
                  color: micOn ? adminTokens.accent : adminTokens.text,
                  cursor: "pointer",
                  fontFamily: adminTokens.fontBody,
                  fontSize: "var(--font-size-base)",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "var(--radius-pill)",
                    background: micOn ? adminTokens.accent : adminTokens.faded,
                  }}
                />
                {micOn ? "Mic on" : "Muted"}
              </button>
            )}
            {live ? (
              <AdminButton variant="ghost" tone="danger" onClick={() => void leave()}>
                Leave
              </AdminButton>
            ) : (
              <AdminButton
                variant="primary"
                onClick={() => void enter()}
                disabled={status === "connecting"}
              >
                {status === "connecting"
                  ? "Connecting…"
                  : status === "ended"
                    ? "Re-enter scene"
                    : "Enter scene"}
              </AdminButton>
            )}
          </div>
        </div>

        <div
          ref={logRef}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-12)",
            height: 420,
            overflowY: "auto",
            background: adminTokens.card,
            border: `1px solid ${adminTokens.border}`,
            borderRadius: "var(--radius-md)",
            padding: "var(--space-18)",
          }}
        >
          {turns.length === 0 ? (
            <span style={{ color: adminTokens.muted, fontSize: "var(--font-size-sm)" }}>
              {live
                ? "Say something to the scene…"
                : "Enter the scene, then speak to drive it."}
            </span>
          ) : (
            turns.map((turn) => (
              <div
                key={turn.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  alignItems: turn.isUser ? "flex-end" : "flex-start",
                }}
              >
                <span
                  style={{
                    color: turn.isUser ? adminTokens.accent : adminTokens.muted,
                    fontFamily: adminTokens.fontMono,
                    fontSize: "var(--font-size-xs)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  {turn.speakerLabel}
                </span>
                <span
                  style={{
                    maxWidth: "80%",
                    padding: "8px 12px",
                    background: turn.isUser ? adminTokens.accentSoft : adminTokens.panel,
                    border: `1px solid ${adminTokens.border}`,
                    borderRadius: "var(--radius-md)",
                    fontSize: "var(--font-size-base)",
                    lineHeight: 1.5,
                    opacity: turn.inFlight ? 0.7 : 1,
                  }}
                >
                  {turn.text}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
