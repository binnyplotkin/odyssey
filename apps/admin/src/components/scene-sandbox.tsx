"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Scene } from "@odyssey/types";
import { useScenePlayer, type ScenePhase } from "@odyssey/scene-player";
import { useSceneMicCapture } from "@/lib/scene-mic";
import {
  AdminButton,
  AdminKicker,
  AdminPanel,
  AdminStatusPill,
  adminTokens,
  type AdminTone,
} from "@/components/admin-ui";

const PHASE_LABEL: Record<ScenePhase, string> = {
  idle: "idle",
  deciding: "deciding",
  speaking: "speaking",
  narrating: "narrating",
  "waiting-for-user": "your turn",
  error: "error",
};

const PHASE_TONE: Record<ScenePhase, AdminTone> = {
  idle: "muted",
  deciding: "processing",
  speaking: "accent",
  narrating: "processing",
  "waiting-for-user": "success",
  error: "danger",
};

export function SceneSandbox({
  sceneId,
  sceneTitle,
  scene,
}: {
  sceneId: string;
  sceneTitle: string;
  scene: Scene;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const createdRef = useRef(false);

  useEffect(() => {
    if (createdRef.current) return;
    createdRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/scene-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sceneId,
            mode: "mixed",
            metadata: { source: "scene-sandbox", sceneId },
          }),
        });
        if (!res.ok) throw new Error(`session create failed (${res.status})`);
        const payload = (await res.json()) as { session?: { id?: string } };
        if (cancelled) return;
        if (!payload.session?.id) throw new Error("no session id returned");
        setSessionId(payload.session.id);
      } catch (err) {
        if (!cancelled) {
          setSessionError(err instanceof Error ? err.message : "Failed to start session.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sceneId]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-20)",
        padding: "var(--space-32) 40px 96px",
        maxWidth: 860,
        background: adminTokens.bg,
        color: adminTokens.fg,
        fontFamily: adminTokens.fontBody,
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
          <AdminKicker>Rehearsal</AdminKicker>
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
      </div>

      {sessionError ? (
        <AdminPanel>
          <span style={{ color: adminTokens.danger }}>{sessionError}</span>
        </AdminPanel>
      ) : !sessionId ? (
        <AdminPanel>
          <span style={{ color: adminTokens.muted }}>Preparing session…</span>
        </AdminPanel>
      ) : (
        <SceneSandboxRunner scene={scene} sessionId={sessionId} />
      )}
    </div>
  );
}

function SceneSandboxRunner({ scene, sessionId }: { scene: Scene; sessionId: string }) {
  const runner = useScenePlayer({ scene, sessionId });
  const [composer, setComposer] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);

  // Mic capture feeds completed utterances straight to the runner (VAD-driven
  // segmentation, barge-in on commit). Same hook the /scene-test page uses.
  const mic = useSceneMicCapture({
    onUtterance: (text) => void runner.sendUserMessage(text),
  });

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [runner.turns.length]);

  // Stop the mic when the scene ends.
  useEffect(() => {
    if (runner.phase === "idle" && mic.status !== "idle") mic.stop();
  }, [runner.phase, mic]);

  const speakerName = (slug: string) => {
    if (slug === "user") return "You";
    if (slug === "narrator") return "Narrator";
    return scene.characters.find((c) => c.characterSlug === slug)?.displayName ?? slug;
  };

  const busy = runner.phase === "deciding" || runner.phase === "speaking" || runner.phase === "narrating";

  function send() {
    const text = composer.trim();
    if (!text) return;
    setComposer("");
    void runner.sendUserMessage(text);
  }

  async function startScene() {
    await runner.start();
    if (mic.status === "idle") await mic.start();
  }

  function stopScene() {
    runner.stop();
    mic.stop();
  }

  function toggleMic() {
    if (mic.status === "idle") void mic.start();
    else mic.stop();
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-12)",
        }}
      >
        <AdminStatusPill tone={PHASE_TONE[runner.phase]} dot>
          {PHASE_LABEL[runner.phase]}
          {runner.currentSpeakerSlug ? ` · ${speakerName(runner.currentSpeakerSlug)}` : ""}
        </AdminStatusPill>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          {runner.phase !== "idle" && (
            <button
              type="button"
              onClick={toggleMic}
              title={mic.status === "idle" ? "Start mic" : "Stop mic"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-6)",
                minHeight: 32,
                padding: "0 12px",
                borderRadius: "var(--radius-md)",
                border: `1px solid ${mic.status === "listening" ? adminTokens.accent : adminTokens.border}`,
                background:
                  mic.status === "listening" ? adminTokens.accentSoft : "transparent",
                color: mic.status === "listening" ? adminTokens.accent : adminTokens.text,
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
                  background:
                    mic.status === "listening"
                      ? adminTokens.accent
                      : mic.status === "connecting"
                        ? adminTokens.warning
                        : adminTokens.faded,
                  transform: `scale(${mic.status === "listening" ? 1 + Math.min(1, mic.micLevel * 3) : 1})`,
                  transition: "transform 80ms linear",
                }}
              />
              {mic.status === "idle"
                ? "Mic"
                : mic.status === "connecting"
                  ? "Connecting…"
                  : mic.status === "error"
                    ? "Mic error"
                    : "Listening"}
            </button>
          )}
          {runner.phase === "idle" ? (
            <AdminButton variant="primary" onClick={() => void startScene()}>
              Start scene
            </AdminButton>
          ) : (
            <AdminButton variant="ghost" tone="danger" onClick={stopScene}>
              Stop
            </AdminButton>
          )}
        </div>
      </div>

      {mic.error && (
        <AdminPanel>
          <span style={{ color: adminTokens.danger, fontSize: "var(--font-size-sm)" }}>
            Mic: {mic.error}
          </span>
        </AdminPanel>
      )}

      {runner.error && (
        <AdminPanel>
          <span style={{ color: adminTokens.danger, fontSize: "var(--font-size-sm)" }}>
            {runner.error}
          </span>
        </AdminPanel>
      )}

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
        {runner.turns.length === 0 ? (
          <span style={{ color: adminTokens.muted, fontSize: "var(--font-size-sm)" }}>
            Press “Start scene” to let the orchestrator open, then reply to drive it.
          </span>
        ) : (
          runner.turns.map((turn, i) => {
            const isUser = turn.speakerSlug === "user";
            const isNarrator = turn.speakerSlug === "narrator";
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  alignItems: isUser ? "flex-end" : "flex-start",
                }}
              >
                <span
                  style={{
                    color: isNarrator ? adminTokens.info : isUser ? adminTokens.accent : adminTokens.muted,
                    fontFamily: adminTokens.fontMono,
                    fontSize: "var(--font-size-xs)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  {speakerName(turn.speakerSlug)}
                </span>
                <span
                  style={{
                    maxWidth: "80%",
                    padding: "8px 12px",
                    background: isUser ? adminTokens.accentSoft : adminTokens.panel,
                    border: `1px solid ${adminTokens.border}`,
                    borderRadius: "var(--radius-md)",
                    fontStyle: isNarrator ? "italic" : "normal",
                    fontSize: "var(--font-size-base)",
                    lineHeight: 1.5,
                  }}
                >
                  {turn.text}
                </span>
              </div>
            );
          })
        )}
      </div>

      {mic.partialTranscript && (
        <span
          style={{
            color: adminTokens.muted,
            fontStyle: "italic",
            fontSize: "var(--font-size-sm)",
          }}
        >
          🎙 {mic.partialTranscript}…
        </span>
      )}

      <div style={{ display: "flex", gap: "var(--space-8)" }}>
        <input
          value={composer}
          placeholder={
            runner.phase === "idle" ? "Start the scene first…" : "Say something to the scene…"
          }
          disabled={runner.phase === "idle"}
          onChange={(e) => setComposer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          style={{
            flex: 1,
            height: 40,
            padding: "0 14px",
            background: adminTokens.inputBg,
            border: `1px solid ${adminTokens.inputBorder}`,
            borderRadius: "var(--radius-md)",
            color: adminTokens.fg,
            fontFamily: adminTokens.fontBody,
            fontSize: "var(--font-size-base)",
            outline: "none",
            opacity: runner.phase === "idle" ? 0.5 : 1,
          }}
        />
        <AdminButton
          variant="primary"
          onClick={send}
          disabled={runner.phase === "idle" || busy || !composer.trim()}
        >
          Send
        </AdminButton>
      </div>
    </>
  );
}
