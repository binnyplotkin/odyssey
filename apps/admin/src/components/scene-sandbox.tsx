"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Scene } from "@odyssey/types";
import {
  useScenePlayer,
  type SceneTurn,
  type ScenePhase,
  type SceneRunnerTrace,
} from "@odyssey/scene-player";
import { captureMic } from "@/lib/sandbox-streams";
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

type EndedSceneSandboxSession = {
  id: string;
  endedAt: number;
  durationMs: number;
  turnCount: number;
  userTurnCount: number;
  characterTurnCount: number;
  traceCount: number;
  status: "ending" | "ended";
  error?: string | null;
};

type SceneSandboxAudioInput = {
  blob: Blob;
  mimeType: string;
  durationMs: number | null;
};

type SceneSandboxReadinessStatus = "ready" | "warning" | "blocked";

type SceneSandboxReadinessReport = {
  sceneId: string;
  timestamp: string;
  overallStatus: SceneSandboxReadinessStatus;
  checks: Array<{
    id: string;
    label: string;
    group: string;
    status: SceneSandboxReadinessStatus;
    summary: string;
    detail?: string;
  }>;
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
        <SceneSandboxRunner sceneId={sceneId} scene={scene} sessionId={sessionId} />
      )}
    </div>
  );
}

function SceneSandboxRunner({
  sceneId,
  scene,
  sessionId,
}: {
  sceneId: string;
  scene: Scene;
  sessionId: string;
}) {
  const runner = useScenePlayer({ scene, sessionId });
  const [composer, setComposer] = useState("");
  const [sessionClosed, setSessionClosed] = useState(false);
  const [endedSession, setEndedSession] = useState<EndedSceneSandboxSession | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [readiness, setReadiness] = useState<SceneSandboxReadinessReport | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const sessionEndedRef = useRef(false);
  const sceneStartedRef = useRef(false);
  const startedAtRef = useRef(Date.now());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderMimeRef = useRef("");
  const recorderStartedAtRef = useRef<number | null>(null);

  // Mic capture feeds completed utterances straight to the runner (VAD-driven
  // segmentation, barge-in on commit). Same hook the /scene-test page uses.
  const mic = useSceneMicCapture({
    onUtterance: (text) => void sendSceneUtterance(text),
  });

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [runner.turns.length]);

  useEffect(() => {
    let cancelled = false;
    setReadinessLoading(true);
    setReadinessError(null);
    fetch(`/api/scenes/${encodeURIComponent(sceneId)}/sandbox/readiness`)
      .then(async (res) => {
        if (!res.ok) {
          const detail = await res.text().catch(() => `${res.status}`);
          throw new Error(`readiness failed: ${detail.slice(0, 200)}`);
        }
        return res.json() as Promise<{ report?: SceneSandboxReadinessReport }>;
      })
      .then((payload) => {
        if (cancelled) return;
        setReadiness(payload.report ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setReadinessError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setReadinessLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sceneId]);

  async function endSessionOnce(status: "ended" | "stopped" = "ended") {
    if (sessionEndedRef.current) return;
    sessionEndedRef.current = true;
    setSessionClosed(true);
    mic.stop();
    stopInputRecorder();
    const durationMs = Math.max(0, Date.now() - startedAtRef.current);
    const summary: EndedSceneSandboxSession = {
      id: sessionId,
      endedAt: Date.now(),
      durationMs,
      turnCount: runner.turns.length,
      userTurnCount: runner.turns.filter((turn) => turn.speakerSlug === "user").length,
      characterTurnCount: runner.turns.filter(
        (turn) => turn.speakerSlug !== "user" && turn.speakerSlug !== "narrator",
      ).length,
      traceCount: runner.traces.length,
      status: "ending",
      error: null,
    };
    setEndedSession(summary);
    await endSceneSandboxSession(sessionId, {
      status,
      turnCount: runner.turns.length,
      traceCount: runner.traces.length,
      durationMs,
      sceneId: scene.id,
    })
      .then(() => {
        setEndedSession((current) =>
          current?.id === sessionId ? { ...current, status: "ended", error: null } : current,
        );
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setEndedSession((current) =>
          current?.id === sessionId ? { ...current, status: "ended", error: message } : current,
        );
        console.warn("[scene-sandbox] session end failed", err);
      });
  }

  // Stop the mic and close the persisted session when the scene ends.
  useEffect(() => {
    if (runner.phase !== "idle") return;
    if (mic.status !== "idle") mic.stop();
    stopInputRecorder();
    if (sceneStartedRef.current) {
      void endSessionOnce("ended");
    }
  }, [runner.phase, mic]);

  useEffect(() => {
    return () => {
      mic.stop();
      stopInputRecorder();
      void endSessionOnce(sceneStartedRef.current ? "stopped" : "ended");
    };
  }, []);

  const speakerName = (slug: string) => {
    if (slug === "user") return "You";
    if (slug === "narrator") return "Narrator";
    return scene.characters.find((c) => c.characterSlug === slug)?.displayName ?? slug;
  };

  const busy = runner.phase === "deciding" || runner.phase === "speaking" || runner.phase === "narrating";
  const readinessBlocked = readiness?.overallStatus === "blocked";

  function send() {
    const text = composer.trim();
    if (!text) return;
    setComposer("");
    void runner.sendUserMessage(text);
  }

  async function sendSceneUtterance(text: string) {
    const turnId = crypto.randomUUID();
    const audioInput = await takeRecordedAudioInput();
    if (audioInput?.blob.size) {
      void uploadSceneAudioArtifact({
        sessionId,
        turnId,
        direction: "input",
        blob: audioInput.blob,
        filename: `input-${turnId}.${extensionForMime(audioInput.mimeType)}`,
        durationMs: audioInput.durationMs,
      });
    }
    await runner.sendUserMessage(text, { turnId });
  }

  async function startScene() {
    if (sessionEndedRef.current) return;
    if (readinessBlocked || readinessLoading) return;
    startedAtRef.current = Date.now();
    sceneStartedRef.current = true;
    await runner.start();
    if (mic.status === "idle") {
      await mic.start();
      await startInputRecorder();
    }
  }

  function stopScene() {
    runner.stop();
    mic.stop();
    stopInputRecorder();
    void endSessionOnce("stopped");
  }

  async function toggleMic() {
    if (mic.status === "idle") {
      await mic.start();
      await startInputRecorder();
    } else {
      mic.stop();
      stopInputRecorder();
    }
  }

  async function startInputRecorder(): Promise<void> {
    if (recorderRef.current) return;
    try {
      const { recorder, stream, mimeType } = await captureMic();
      recorderRef.current = recorder;
      recorderStreamRef.current = stream;
      recorderMimeRef.current = mimeType || "audio/webm";
      recorderChunksRef.current = [];
      recorderStartedAtRef.current = performance.now();
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          recorderChunksRef.current.push(event.data);
        }
      });
      recorder.start(250);
    } catch (err) {
      console.warn("[scene-sandbox] input audio recorder unavailable", err);
      stopInputRecorder();
    }
  }

  function stopInputRecorder() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    recorderStreamRef.current = null;
    recorderChunksRef.current = [];
    recorderStartedAtRef.current = null;
  }

  async function takeRecordedAudioInput(): Promise<SceneSandboxAudioInput | undefined> {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.requestData();
        await new Promise((resolve) => window.setTimeout(resolve, 60));
      } catch {
        /* requestData can throw while the recorder is stopping. */
      }
    }

    const chunks = recorderChunksRef.current;
    if (chunks.length === 0) {
      recorderStartedAtRef.current = performance.now();
      return undefined;
    }

    recorderChunksRef.current = [];
    const mimeType = recorderMimeRef.current || chunks[0]?.type || "audio/webm";
    const capturedAt = performance.now();
    const durationMs =
      recorderStartedAtRef.current === null
        ? null
        : Math.max(0, Math.round(capturedAt - recorderStartedAtRef.current));
    recorderStartedAtRef.current = capturedAt;

    return {
      blob: new Blob(chunks, { type: mimeType }),
      mimeType,
      durationMs,
    };
  }

  return (
    <>
      {!sceneStartedRef.current && !sessionClosed && (
        <AdminPanel style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
          <AdminKicker>Pre-session</AdminKicker>
          <span style={{ color: adminTokens.text, lineHeight: 1.5 }}>
            {readinessBlocked
              ? "Resolve blocked readiness checks before starting this scene."
              : "Start the scene to open the orchestration loop, enable mic capture, and persist the run for review."}
          </span>
          <SceneReadinessList
            loading={readinessLoading}
            error={readinessError}
            report={readiness}
          />
        </AdminPanel>
      )}

      {sessionClosed && endedSession && (
        <ScenePostSessionReview
          sceneId={scene.id}
          summary={endedSession}
          turns={runner.turns}
          traces={runner.traces}
          sceneState={runner.sceneState}
        />
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-12)",
        }}
      >
        <AdminStatusPill tone={PHASE_TONE[runner.phase]} dot>
          {sessionClosed ? "post-session" : PHASE_LABEL[runner.phase]}
          {runner.currentSpeakerSlug ? ` · ${speakerName(runner.currentSpeakerSlug)}` : ""}
        </AdminStatusPill>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          <AdminButton variant="secondary" onClick={() => setDiagnosticsOpen((open) => !open)}>
            {diagnosticsOpen ? "Hide diagnostics" : "Diagnostics"}
          </AdminButton>
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
            <AdminButton
              variant="primary"
              onClick={() => void startScene()}
              disabled={sessionClosed || readinessLoading || readinessBlocked}
            >
              {sessionClosed ? "Session ended" : "Start scene"}
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
            sessionClosed
              ? "Session ended."
              : runner.phase === "idle"
                ? "Start the scene first…"
                : "Say something to the scene…"
          }
          disabled={runner.phase === "idle" || sessionClosed}
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
          disabled={runner.phase === "idle" || sessionClosed || busy || !composer.trim()}
        >
          Send
        </AdminButton>
      </div>

      {diagnosticsOpen && (
        <SceneDiagnosticsPanel
          sessionId={sessionId}
          phase={sessionClosed ? "post-session" : PHASE_LABEL[runner.phase]}
          sceneState={runner.sceneState}
          traces={runner.traces}
          latestTrace={runner.latestTrace}
          onClose={() => setDiagnosticsOpen(false)}
        />
      )}
    </>
  );
}

function ScenePostSessionReview({
  sceneId,
  summary,
  turns,
  traces,
  sceneState,
}: {
  sceneId: string;
  summary: EndedSceneSandboxSession;
  turns: SceneTurn[];
  traces: SceneRunnerTrace[];
  sceneState: Record<string, unknown>;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [copyError, setCopyError] = useState<string | null>(null);

  async function copyDebugTrace() {
    setCopyStatus("copying");
    setCopyError(null);
    try {
      const res = await fetch(`/api/scene-sessions/${encodeURIComponent(summary.id)}/detail`, {
        cache: "no-store",
      });
      const persisted = res.ok
        ? await res.json()
        : { error: `session detail fetch failed (${res.status})`, body: await res.text() };
      const payload = {
        copiedAt: new Date().toISOString(),
        url: typeof window !== "undefined" ? window.location.href : null,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        sceneId,
        summary,
        sceneState,
        liveTurns: turns,
        liveTraces: traces,
        persisted,
      };
      await copyTextToClipboard(JSON.stringify(payload, null, 2));
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 2400);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCopyError(message);
      setCopyStatus("error");
    }
  }

  return (
    <AdminPanel style={{ display: "flex", flexDirection: "column", gap: "var(--space-14)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-12)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <AdminKicker>Post-session</AdminKicker>
          <strong style={{ fontSize: "var(--font-size-xl)" }}>Run captured</strong>
        </div>
        <AdminStatusPill tone={summary.error ? "danger" : "success"} dot>
          {summary.error ? "saved with warning" : summary.status}
        </AdminStatusPill>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: "var(--space-8)",
        }}
      >
        <ReviewStat label="duration" value={formatDuration(summary.durationMs)} />
        <ReviewStat label="turns" value={`${summary.turnCount}`} />
        <ReviewStat label="character" value={`${summary.characterTurnCount}`} />
        <ReviewStat label="traces" value={`${summary.traceCount}`} />
      </div>
      {summary.error && (
        <span style={{ color: adminTokens.danger, fontSize: "var(--font-size-sm)" }}>
          {summary.error}
        </span>
      )}
      <div style={{ display: "flex", gap: "var(--space-8)", flexWrap: "wrap" }}>
        <AdminButton
          variant="primary"
          onClick={() => void copyDebugTrace()}
          disabled={copyStatus === "copying"}
        >
          {copyStatus === "copying"
            ? "Copying..."
            : copyStatus === "copied"
              ? "Copied debug trace"
              : "Copy debug trace"}
        </AdminButton>
        <Link href={`/scenes/${sceneId}`} style={{ textDecoration: "none" }}>
          <AdminButton variant="secondary">Back to scene</AdminButton>
        </Link>
        <Link href={`/sessions/${summary.id}`} style={{ textDecoration: "none" }}>
          <AdminButton variant="primary">Open session</AdminButton>
        </Link>
      </div>
      {copyError && (
        <span style={{ color: adminTokens.danger, fontSize: "var(--font-size-sm)" }}>
          Copy failed: {copyError}
        </span>
      )}
      {traces.length === 0 && (
        <span style={{ color: adminTokens.muted, fontSize: "var(--font-size-sm)" }}>
          No runtime traces were emitted before the session ended.
        </span>
      )}
    </AdminPanel>
  );
}

function SceneReadinessList({
  loading,
  error,
  report,
}: {
  loading: boolean;
  error: string | null;
  report: SceneSandboxReadinessReport | null;
}) {
  if (loading) {
    return (
      <span style={{ color: adminTokens.muted, fontSize: "var(--font-size-sm)" }}>
        Checking scene readiness...
      </span>
    );
  }

  if (error) {
    return (
      <span style={{ color: adminTokens.warning, fontSize: "var(--font-size-sm)" }}>
        Readiness check unavailable: {error}
      </span>
    );
  }

  if (!report) return null;

  const toneForStatus: Record<SceneSandboxReadinessStatus, AdminTone> = {
    ready: "success",
    warning: "warning",
    blocked: "danger",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
        <AdminStatusPill tone={toneForStatus[report.overallStatus]} dot>
          {report.overallStatus}
        </AdminStatusPill>
        <span style={{ color: adminTokens.muted, fontSize: "var(--font-size-sm)" }}>
          {report.checks.length} checks
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "var(--space-8)",
        }}
      >
        {report.checks.map((check) => (
          <div
            key={check.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
              padding: "10px 12px",
              background: adminTokens.panel,
              border: `1px solid ${adminTokens.border}`,
              borderRadius: "var(--radius-md)",
              minWidth: 0,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-8)" }}>
              <strong style={{ color: adminTokens.fg, fontSize: "var(--font-size-sm)" }}>
                {check.label}
              </strong>
              <span
                style={{
                  color:
                    check.status === "ready"
                      ? adminTokens.success
                      : check.status === "warning"
                        ? adminTokens.warning
                        : adminTokens.danger,
                  fontFamily: adminTokens.fontMono,
                  fontSize: "var(--font-size-xs)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  flexShrink: 0,
                }}
              >
                {check.status}
              </span>
            </div>
            <span style={{ color: adminTokens.muted, fontSize: "var(--font-size-sm)" }}>
              {check.summary}
            </span>
            {check.detail && (
              <span
                style={{
                  color: adminTokens.muted,
                  fontFamily: adminTokens.fontMono,
                  fontSize: "var(--font-size-xs)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={check.detail}
              >
                {check.detail}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SceneDiagnosticsPanel({
  sessionId,
  phase,
  sceneState,
  traces,
  latestTrace,
  onClose,
}: {
  sessionId: string;
  phase: string;
  sceneState: Record<string, unknown>;
  traces: SceneRunnerTrace[];
  latestTrace: SceneRunnerTrace | null;
  onClose: () => void;
}) {
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(
    latestTrace?.id ?? null,
  );
  useEffect(() => {
    if (!selectedTraceId && latestTrace) setSelectedTraceId(latestTrace.id);
  }, [latestTrace, selectedTraceId]);
  const selectedTrace =
    traces.find((trace) => trace.id === selectedTraceId) ?? latestTrace;
  const events = Array.isArray(selectedTrace?.trace.events)
    ? (selectedTrace?.trace.events as Array<Record<string, unknown>>)
    : [];
  const recentTraces = traces.slice(-8).reverse();
  return (
    <AdminPanel style={{ display: "flex", flexDirection: "column", gap: "var(--space-14)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <AdminKicker>Diagnostics</AdminKicker>
          <span style={{ color: adminTokens.muted, fontSize: "var(--font-size-sm)" }}>
            {sessionId} · {phase}
          </span>
        </div>
        <AdminButton variant="ghost" onClick={onClose}>
          Close
        </AdminButton>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: "var(--space-8)",
        }}
      >
        <ReviewStat label="trace records" value={`${traces.length}`} />
        <ReviewStat label="turn index" value={String(sceneState.turnIndex ?? 0)} />
        <ReviewStat label="beat" value={String(sceneState.beat ?? "unknown")} />
      </div>
      {selectedTrace ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <span
            style={{
              color: adminTokens.muted,
              fontFamily: adminTokens.fontMono,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            selected {selectedTrace.kind} · {selectedTrace.meta.provider ?? "provider n/a"} ·{" "}
            {selectedTrace.meta.model ?? "model n/a"}
          </span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "var(--space-10)",
            }}
          >
            <div
              style={{
                maxHeight: 220,
                overflow: "auto",
                border: `1px solid ${adminTokens.border}`,
                borderRadius: "var(--radius-md)",
              }}
            >
              {recentTraces.map((trace) => {
                const selected = trace.id === selectedTrace.id;
                return (
                  <button
                    key={trace.id}
                    type="button"
                    onClick={() => setSelectedTraceId(trace.id)}
                    style={{
                      width: "100%",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: 2,
                      padding: "9px 10px",
                      border: "none",
                      borderTop:
                        trace.id === recentTraces[0]?.id
                          ? "none"
                          : `1px solid ${adminTokens.border}`,
                      background: selected ? adminTokens.accentSoft : "transparent",
                      color: selected ? adminTokens.accent : adminTokens.text,
                      cursor: "pointer",
                      fontFamily: adminTokens.fontBody,
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: adminTokens.fontMono,
                        fontSize: "var(--font-size-xs)",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      {trace.kind} · {trace.meta.action ?? "event"}
                    </span>
                    <span style={{ color: adminTokens.muted, fontSize: "var(--font-size-sm)" }}>
                      {trace.meta.speakerSlug ?? trace.meta.reason ?? trace.at}
                    </span>
                  </button>
                );
              })}
            </div>
            <pre
              style={{
                minHeight: 120,
                maxHeight: 220,
                margin: 0,
                overflow: "auto",
                padding: "10px 12px",
                background: adminTokens.inputBg,
                border: `1px solid ${adminTokens.border}`,
                borderRadius: "var(--radius-md)",
                color: adminTokens.text,
                fontFamily: adminTokens.fontMono,
                fontSize: "var(--font-size-xs)",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
              }}
            >
              {JSON.stringify(selectedTrace.meta, null, 2)}
            </pre>
          </div>
          <div
            style={{
              maxHeight: 180,
              overflow: "auto",
              border: `1px solid ${adminTokens.border}`,
              borderRadius: "var(--radius-md)",
            }}
          >
            {events.length === 0 ? (
              <p style={{ margin: 0, padding: 12, color: adminTokens.muted }}>
                Trace has no event rows.
              </p>
            ) : (
              events.slice(-12).map((event, index) => (
                <div
                  key={index}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "80px minmax(0, 1fr)",
                    gap: "var(--space-8)",
                    padding: "7px 10px",
                    borderTop: index === 0 ? "none" : `1px solid ${adminTokens.border}`,
                    color: adminTokens.text,
                    fontFamily: adminTokens.fontMono,
                    fontSize: "var(--font-size-xs)",
                  }}
                >
                  <span style={{ color: adminTokens.muted }}>
                    {String(event.elapsedMs ?? event.at ?? "")}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {String(event.name ?? event.type ?? "trace.event")}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <span style={{ color: adminTokens.muted, fontSize: "var(--font-size-sm)" }}>
          No traces captured yet.
        </span>
      )}
    </AdminPanel>
  );
}

function ReviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "10px 12px",
        background: adminTokens.panel,
        border: `1px solid ${adminTokens.border}`,
        borderRadius: "var(--radius-md)",
        minWidth: 0,
      }}
    >
      <span
        style={{
          color: adminTokens.muted,
          fontFamily: adminTokens.fontMono,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <strong
        style={{
          color: adminTokens.fg,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const mins = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (mins === 0) return `${rest}s`;
  return `${mins}m ${rest}s`;
}

async function endSceneSandboxSession(
  sessionId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const status = typeof metadata.status === "string" ? metadata.status : "ended";
  const res = await fetch(`/api/scene-sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status,
      metadata: {
        source: "scene-sandbox",
        ...metadata,
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => `${res.status}`);
    throw new Error(`scene-session end failed: ${detail.slice(0, 200)}`);
  }
}

async function uploadSceneAudioArtifact(input: {
  sessionId: string;
  turnId: string;
  direction: "input" | "output";
  blob: Blob;
  filename: string;
  durationMs: number | null;
  sampleRate?: number | null;
}): Promise<void> {
  if (!input.blob.size) return;
  const form = new FormData();
  form.set("file", input.blob, input.filename);
  form.set("direction", input.direction);
  form.set("turnId", input.turnId);
  form.set("source", "admin-scene-sandbox");
  if (input.durationMs !== null) form.set("durationMs", String(input.durationMs));
  if (input.sampleRate) form.set("sampleRate", String(input.sampleRate));
  await fetch(`/api/scene-sessions/${input.sessionId}/audio`, {
    method: "POST",
    body: form,
  }).catch((err) => {
    console.warn(`[scene-sandbox] ${input.direction} audio artifact upload failed`, err);
  });
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  return "bin";
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) throw new Error("clipboard copy was blocked");
}
