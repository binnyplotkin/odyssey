/**
 * End-to-end smoke test for the live character voice session pipeline.
 *
 * This intentionally runs through the admin HTTP routes instead of calling
 * package internals:
 *   1. create world session
 *   2. ask global orchestrator for the next scene decision
 *   3. stream /api/characters/:slug/voice-stream
 *   4. read persisted session detail from the store and assert telemetry
 *
 * It uses real providers and may incur model/TTS cost.
 *
 * Usage:
 *   npx tsx scripts/smoke-test-voice-session.ts
 *   npx tsx scripts/smoke-test-voice-session.ts --base http://localhost:3001 --character abraham --message "Peace to you."
 *   ODYSSEY_ADMIN_COOKIE='next-auth...' npx tsx scripts/smoke-test-voice-session.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

type SseFrame = {
  event: string;
  data: Record<string, unknown>;
};

const args = process.argv.slice(2);
const BASE_URL = readFlag("--base") ?? "http://localhost:3001";
const CHARACTER = readFlag("--character") ?? "abraham";
const MESSAGE = readFlag("--message") ?? "Peace to you. What do you remember today?";
const COOKIE = readFlag("--cookie") ?? process.env.ODYSSEY_ADMIN_COOKIE ?? "";

async function main() {
  console.log(`Voice smoke · ${BASE_URL} · character=${CHARACTER}`);

  const sessionId = crypto.randomUUID();
  const turnId = crypto.randomUUID();
  const sceneId = `character-sandbox:${CHARACTER}`;

  await postJson("/api/scene-sessions", {
    id: sessionId,
    characterId: null,
    mode: "voice",
    initialScene: initialSceneSnapshot(sceneId, CHARACTER),
    currentScene: initialSceneSnapshot(sceneId, CHARACTER),
    metadata: {
      source: "smoke-test-voice-session",
      characterSlug: CHARACTER,
      sceneId,
    },
  });
  console.log(`1. world session created · ${sessionId}`);

  const orchestration = await postJson(`/api/scene-sessions/${sessionId}/orchestrate`, {
    sceneId,
    recentTurns: [
      { speakerSlug: "user", speakerName: "User", text: MESSAGE },
    ],
    lastUserMessage: MESSAGE,
  });
  const decision = asRecord(orchestration.decision);
  console.log(
    `2. orchestrator · action=${decision?.action ?? "?"} speaker=${decision?.speakerId ?? "n/a"} degraded=${Boolean(orchestration.degraded)}`,
  );

  const voiceFrames = await streamVoice({
    characterSlug: CHARACTER,
    sessionId,
    turnId,
    message: MESSAGE,
    promptChunk: buildPromptChunk(decision),
  });
  const done = voiceFrames.find((frame) => frame.event === "done")?.data;
  if (!done) throw new Error("voice-stream did not emit done.");
  console.log(
    `3. voice done · tokens=${done.totalTokens ?? "?"} firstAudio=${done.firstAudioMs ?? "?"}ms cost=$${Number(done.estimatedCostUsd ?? 0).toFixed(6)}`,
  );

  const detailPayload = await getJson(`/api/scene-sessions/${sessionId}/detail`);
  const detail = asRecord(detailPayload.detail);
  if (!detail) throw new Error("Session detail was not persisted.");

  const session = asRecord(detail.session);
  const events = asArray(detail.events).map(asRecord).filter(Boolean);
  const turns = asArray(detail.turns).map(asRecord).filter(Boolean);
  const contextBuilds = asArray(detail.contextBuilds).map(asRecord).filter(Boolean);

  assert(session?.currentScene, "currentScene persisted");
  assert(events.some((event) => String(event?.type ?? "").startsWith("scene.decision.")), "orchestration event persisted");
  assert(events.some((event) => event?.type === "voice_stream.done"), "voice done event persisted");

  const turn = turns.find((candidate) => candidate?.id === turnId);
  assert(turn, "turn persisted");
  assert(turn?.status === "completed", "turn completed");
  assert(typeof turn?.assistantText === "string" && Boolean(turn.assistantText.trim()), "assistant text persisted");

  const tokenUsage = asRecord(turn?.tokenUsage);
  assert(Number(tokenUsage?.inputTokens ?? 0) > 0, "input tokens persisted");
  assert(Number(tokenUsage?.outputTokens ?? 0) > 0, "output tokens persisted");
  assert(Number(tokenUsage?.estimatedCostUsd ?? 0) > 0, "estimated cost persisted");

  const audioMetrics = asRecord(turn?.audioMetrics);
  const latencySummary = asRecord(turn?.latencySummary);
  assert(Number(audioMetrics?.audioSamples ?? 0) > 0, "audio samples persisted");
  assert(Number(audioMetrics?.durationMs ?? 0) >= 0, "audio duration persisted");
  assert(Number(latencySummary?.firstAudioMs ?? -1) >= 0, "first-audio latency persisted");
  assert(Number(latencySummary?.totalMs ?? 0) >= Number(latencySummary?.firstAudioMs ?? 0), "total latency persisted");
  assert(contextBuilds.some((ctx) => ctx?.turnId === turnId && Boolean(ctx.systemPrompt)), "context build persisted");

  console.log("4. persisted session detail verified");
  console.log(`Open: ${BASE_URL}/sessions/${sessionId}`);

  await fetch(`${BASE_URL}/api/scene-sessions/${sessionId}`, {
    method: "PATCH",
    headers: requestHeaders(),
    body: JSON.stringify({
      status: "ended",
      metadata: {
        source: "smoke-test-voice-session",
        verifiedAt: new Date().toISOString(),
      },
    }),
  });
}

async function streamVoice(input: {
  characterSlug: string;
  sessionId: string;
  turnId: string;
  message: string;
  promptChunk?: string;
  model?: string;
}): Promise<SseFrame[]> {
  const res = await fetch(`${BASE_URL}/api/characters/${input.characterSlug}/voice-stream`, {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify({
      sessionId: input.sessionId,
      turnId: input.turnId,
      message: input.message,
      promptChunk: input.promptChunk,
      model: input.model,
      history: [],
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`voice-stream ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let frameEnd = buffer.indexOf("\n\n");
    while (frameEnd >= 0) {
      const raw = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);
      const event = raw.match(/^event: (.+)$/m)?.[1];
      const dataRaw = raw.match(/^data: (.+)$/m)?.[1];
      if (event && dataRaw) {
        const data = JSON.parse(dataRaw) as Record<string, unknown>;
        frames.push({ event, data });
        if (event === "trace") console.log("   voice trace received");
        if (event === "first-audio") console.log(`   first audio · ${data.latencyMs ?? "?"}ms`);
        if (event === "done") console.log("   voice stream done");
        if (event === "error") throw new Error(`voice-stream error: ${data.message}`);
      }
      frameEnd = buffer.indexOf("\n\n");
    }
  }
  return frames;
}

async function postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${path} ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

async function getJson(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: requestHeaders(false),
  });
  if (!res.ok) {
    throw new Error(`${path} ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

function requestHeaders(json = true): HeadersInit {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(COOKIE ? { Cookie: COOKIE } : {}),
  };
}

function initialSceneSnapshot(sceneId: string, characterSlug: string) {
  return {
    version: 1,
    sceneId,
    sceneState: {
      sceneId,
      beat: "The voice smoke session is open and waiting for the user to begin.",
      presentCharacterSlugs: [characterSlug],
      ambience: null,
      lastSpeakerSlug: null,
      turnIndex: 0,
    },
    sceneMemory: [],
    updatedAt: new Date().toISOString(),
  };
}

function buildPromptChunk(decision: Record<string, unknown> | null): string | undefined {
  if (!decision || decision.action !== "speak") return undefined;
  return [
    typeof decision.beat === "string" ? `Scene direction (orchestrator): ${decision.beat}` : "",
    typeof decision.sceneCue === "string" ? `Scene cue: ${decision.sceneCue}` : "",
    typeof decision.beatLabel === "string" ? `Beat: ${decision.beatLabel}` : "",
  ].filter(Boolean).join("\n");
}

function readFlag(name: string): string | null {
  const idx = args.indexOf(name);
  if (idx < 0) return null;
  return args[idx + 1] ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
  console.log(`   ✓ ${label}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
