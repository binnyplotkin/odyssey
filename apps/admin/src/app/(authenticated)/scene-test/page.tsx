"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSceneRunner } from "@/lib/scene-runner";
import { useSceneMicCapture } from "@/lib/scene-mic";
import { getScene } from "@odyssey/orchestration/client";

const ABRAHAMS_TENT = requireScene("abrahams-tent");

function requireScene(sceneId: string) {
  const scene = getScene(sceneId);
  if (!scene) throw new Error(`Missing scene: ${sceneId}`);
  return scene;
}

export default function SceneTestPage() {
  // Stable session id for the duration of the page. The orchestrate route
  // accepts arbitrary ids — persistence is best-effort.
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const [userInput, setUserInput] = useState("");

  const runner = useSceneRunner({ scene: ABRAHAMS_TENT, sessionId });

  // Mic capture feeds completed utterances directly to the runner. The
  // hook handles word accumulation + VAD-driven utterance segmentation;
  // each commit triggers a barge-in if a character was speaking.
  const handleUtterance = useCallback(
    (text: string) => {
      void runner.sendUserMessage(text);
    },
    [runner],
  );
  const mic = useSceneMicCapture({ onUtterance: handleUtterance });

  // Stop the mic when the scene ends.
  useEffect(() => {
    if (runner.phase === "idle" && mic.status !== "idle") {
      mic.stop();
    }
  }, [runner.phase, mic]);

  const handleStartScene = async () => {
    await runner.start();
    // Start mic in parallel — the user can speak the moment the scene
    // begins, even before the orchestrator's first decision lands.
    if (mic.status === "idle") {
      await mic.start();
    }
  };

  const handleStopScene = () => {
    runner.stop();
    mic.stop();
  };

  const handleSend = async () => {
    const text = userInput.trim();
    if (!text) return;
    setUserInput("");
    await runner.sendUserMessage(text);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 text-sm">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{ABRAHAMS_TENT.title}</h1>
        <p className="text-muted-foreground">{ABRAHAMS_TENT.description}</p>
      </header>

      <section className="rounded-md border bg-card p-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <div><span className="text-muted-foreground">phase: </span>{runner.phase}</div>
          <div><span className="text-muted-foreground">speaker: </span>{runner.currentSpeakerSlug ?? "—"}</div>
          <div className="col-span-2"><span className="text-muted-foreground">beat: </span>{runner.sceneState.beat}</div>
          <div><span className="text-muted-foreground">ambience: </span>{runner.sceneState.ambience ?? "—"}</div>
          <div><span className="text-muted-foreground">turn: </span>{runner.sceneState.turnIndex}</div>
          <div><span className="text-muted-foreground">mic: </span>{mic.status}</div>
          <div>
            <span className="text-muted-foreground">level: </span>
            <span className="inline-block h-2 w-24 overflow-hidden rounded-full bg-muted align-middle">
              <span
                className="block h-full bg-accent transition-all"
                style={{ width: `${Math.min(100, Math.round(mic.micLevel * 200))}%` }}
              />
            </span>
          </div>
        </div>
        {(runner.error || mic.error) && (
          <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 p-2 text-red-400">
            {runner.error ?? mic.error}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleStartScene}
            disabled={runner.phase !== "idle"}
            className="rounded-md border bg-accent px-3 py-1.5 text-accent-foreground disabled:opacity-50"
          >
            Start scene
          </button>
          <button
            type="button"
            onClick={handleStopScene}
            disabled={runner.phase === "idle"}
            className="rounded-md border px-3 py-1.5 disabled:opacity-50"
          >
            Stop
          </button>
          <button
            type="button"
            onClick={() => (mic.status === "idle" ? mic.start() : mic.stop())}
            className="rounded-md border px-3 py-1.5"
          >
            {mic.status === "idle" ? "Mic on" : "Mic off"}
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Transcript</h2>
        <div className="max-h-[400px] space-y-2 overflow-y-auto rounded-md border bg-card p-3">
          {runner.turns.length === 0 && (
            <div className="text-muted-foreground">No turns yet. Press Start scene.</div>
          )}
          {runner.turns.map((turn, idx) => (
            <div key={idx} className="flex gap-2">
              <span className="min-w-[80px] text-muted-foreground">
                {turn.speakerName ?? turn.speakerSlug}:
              </span>
              <span className="flex-1">{turn.text}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="rounded-md border bg-card px-3 py-2 text-muted-foreground">
          {mic.partialTranscript || (
            <span className="italic">
              {mic.status === "listening"
                ? "Listening — speak to interrupt or respond."
                : mic.status === "connecting"
                  ? "Connecting to mic..."
                  : "Mic off."}
            </span>
          )}
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Text input (fallback)</summary>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSend();
              }}
              placeholder="Type if mic isn't available..."
              className="flex-1 rounded-md border bg-card px-3 py-1.5"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={runner.phase === "idle" || !userInput.trim()}
              className="rounded-md border px-3 py-1.5 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </details>
        <p className="text-xs text-muted-foreground">
          Voice-first: the mic is on while the scene runs. Each completed
          utterance (pause-detected) interrupts whoever is speaking and
          flows into the orchestrator. Use headphones — TTS audio leaking
          into the mic can cause the scene to talk to itself.
        </p>
      </section>
    </div>
  );
}
