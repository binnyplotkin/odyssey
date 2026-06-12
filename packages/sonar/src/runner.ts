/**
 * Sonar runner — voice-to-voice only. Each turn:
 *
 *   1. ensure a spoken-audio fixture for the scripted user line (synth via
 *      OpenAI TTS on first use, then cached),
 *   2. stream it into the audio-rt STT WebSocket at real-time pace and read
 *      back the transcript + endpointing/STT timing,
 *   3. (scene mode) ask /orchestrate for the next decision,
 *   4. POST the transcript to /voice-stream and time the agent's audio,
 *   5. record `voice-to-voice` = user-speech-end → first agent audio.
 *
 * Turns START FROM AUDIO — there is no text-initiated path. Sessions run
 * sequentially: audio-rt serializes STT and TTS behind global locks, so
 * concurrency would measure contention, not the pipeline. Uses real
 * providers (STT, LLM, TTS, and TTS for input synthesis) and incurs cost.
 */

import { ensureFixture } from "./audio/synth";
import { streamUtterance } from "./audio/stt-client";
import { loadUtterance24k } from "./audio/wav";
import { SONAR_VERSION } from "./version";
import { aggregate } from "./stats";
import { extractVoiceStreamSpans } from "./spans";
import { readTimedSseFrames } from "./sse";
import {
  SONAR_SPANS,
  type SonarAggregate,
  type SonarGitInfo,
  type SonarRunRecord,
  type SonarSpanName,
  type SonarSuite,
  type SonarTurnRecord,
  type TimedSseFrame,
  type TraceContract,
} from "./types";

export type RunSonarSuiteOptions = {
  suite: SonarSuite;
  baseUrl: string;
  cookie: string;
  repoRoot: string;
  /** Override the suite's character slug. */
  character?: string;
  /** Override the character's default voice model. */
  model?: string;
  /** Route TTS through this voices-table slug instead of the character's binding (A/B). */
  ttsVoice?: string;
  /**
   * Model the sandbox's post-STT commit hold (STREAMING_COMMIT_HOLD_MS): wait
   * this long after the transcript finalizes before firing the turn, so
   * voice-to-voice reflects TRUE felt latency. 0 (default) = pipeline-intrinsic.
   */
  commitHoldMs?: number;
  /**
   * Warm the session context cache at session open (POST /voice-context),
   * exactly as the real client does, so turn-1 skips the curator/retrieval
   * pass. Measures the product's true "enter a world" latency.
   */
  prewarm?: boolean;
  /** Override the suite's session count. */
  sessions?: number;
  /** Stream STT frames as fast as possible — non-representative endpointing. */
  turbo?: boolean;
  /** audio-rt STT WebSocket URL override. */
  audioRtWsUrl?: string;
  label?: string;
  git?: SonarGitInfo | null;
  log?: (line: string) => void;
};

type SceneTurn = { speakerSlug: string; speakerName: string; text: string };

export async function runSonarSuite(opts: RunSonarSuiteOptions): Promise<SonarRunRecord> {
  const { suite } = opts;
  const log = opts.log ?? (() => {});
  const character = opts.character ?? suite.character;
  const sessions = opts.sessions ?? suite.sessions;
  const commitHoldMs = Math.max(0, opts.commitHoldMs ?? 0);
  const settleMs = suite.settleMs ?? 250;
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  const http = makeHttp(opts.baseUrl, opts.cookie);

  log(
    `sonar v${SONAR_VERSION} · suite=${suite.name}@${suite.version} · character=${character} · ` +
      `${sessions} session(s) × ${suite.turns.length} turn(s) · voice-to-voice` +
      (opts.ttsVoice ? ` · tts→${opts.ttsVoice}` : "") +
      (commitHoldMs > 0 ? ` · commit-hold=${commitHoldMs}ms (felt)` : "") +
      (opts.prewarm ? " · prewarm" : "") +
      (opts.turbo ? " · TURBO (endpointing not representative)" : ""),
  );

  // Synthesize/load every fixture up front so the first session isn't
  // skewed by synthesis time mid-run.
  log("preparing spoken-input fixtures…");
  const fixtures: Array<{ samples: Float32Array; synthesized: boolean }> = [];
  for (let i = 0; i < suite.turns.length; i += 1) {
    const { wav, synthesized } = await ensureFixture({
      repoRoot: opts.repoRoot,
      suite: suite.name,
      turnIndex: i,
      text: suite.turns[i],
      opts: { voice: suite.userVoice },
      log,
    });
    fixtures.push({ samples: loadUtterance24k(wav), synthesized });
  }

  const turns: SonarTurnRecord[] = [];

  for (let sessionIndex = 0; sessionIndex < sessions; sessionIndex++) {
    const sessionId = crypto.randomUUID();
    const sceneId = `character-sandbox:${character}`;
    await http.postJson("/api/scene-sessions", {
      id: sessionId,
      characterId: null,
      mode: "voice",
      initialScene: initialSceneSnapshot(sceneId, character),
      currentScene: initialSceneSnapshot(sceneId, character),
      metadata: { source: "sonar", sonarVersion: SONAR_VERSION, runId, characterSlug: character, sceneId },
    });

    // Warm the session context cache at open, like the real client does, so
    // turn-1 skips the curator/retrieval pass. Token budget matches what the
    // voice-stream route uses for its cache lookup (2500).
    if (opts.prewarm) {
      const w0 = performance.now();
      await http
        .postJson(`/api/characters/${character}/voice-context`, { sessionId, tokenBudget: 2500 })
        .then(() => log(`session ${sessionIndex + 1}/${sessions} · ${sessionId} · prewarmed in ${Math.round(performance.now() - w0)}ms`))
        .catch((err: unknown) => log(`  (prewarm failed: ${String(err)})`));
    } else {
      log(`session ${sessionIndex + 1}/${sessions} · ${sessionId}`);
    }

    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const sceneTurns: SceneTurn[] = [];

    for (let turnIndex = 0; turnIndex < suite.turns.length; turnIndex++) {
      const scripted = suite.turns[turnIndex];
      const fixture = fixtures[turnIndex];

      // 1+2. Spoken input → STT.
      const stt = await streamUtterance({
        samples: fixture.samples,
        wsUrl: opts.audioRtWsUrl,
        turbo: opts.turbo,
      });
      const transcript = stt.transcript || scripted; // fall back so the turn still exercises the LLM/TTS legs
      sceneTurns.push({ speakerSlug: "user", speakerName: "User", text: transcript });

      // Model the client's post-STT commit hold: dead time after the user is
      // deemed done, before the turn fires. Sits inside the voice-to-voice
      // window (speechEnd → first agent audio), so the sleep is captured.
      if (commitHoldMs > 0) await sleep(commitHoldMs);

      // 3. Scene mode: orchestrator decision.
      let orchestrate: { totalMs: number; trace: TraceContract | null } | null = null;
      let promptChunk: string | undefined;
      if (suite.mode === "scene") {
        const o0 = performance.now();
        const payload = await http.postJson(`/api/scene-sessions/${sessionId}/orchestrate`, {
          sceneId,
          recentTurns: sceneTurns.slice(-6),
          lastUserMessage: transcript,
        });
        orchestrate = {
          totalMs: performance.now() - o0,
          trace: (payload.trace as TraceContract | undefined) ?? null,
        };
        promptChunk = promptChunkFromDecision(payload.decision);
      }

      // 4. Transcript → voice-stream.
      const turnId = crypto.randomUUID();
      const vs0 = performance.now();
      const res = await http.post(`/api/characters/${character}/voice-stream`, {
        sessionId,
        turnId,
        message: transcript,
        history: [...history],
        promptChunk,
        model: opts.model,
        ttsVoiceSlug: opts.ttsVoice,
      });
      let frames: TimedSseFrame[] = [];
      let transportError: string | null = null;
      let firstAudioPerf: number | null = null;
      if (!res.ok || !res.body) {
        transportError = `voice-stream ${res.status}: ${await res.text().catch(() => "")}`;
      } else {
        frames = await readTimedSseFrames(res, vs0, (frame) => {
          if (frame.event === "audio" && firstAudioPerf === null) firstAudioPerf = performance.now();
        });
      }

      // 5. Assemble spans. voice-to-voice spans the whole path from the
      // moment the user stopped speaking to the first agent audio.
      const extracted = extractVoiceStreamSpans({ frames, orchestrate });
      const voiceToVoice =
        firstAudioPerf !== null && !stt.error
          ? Math.round((firstAudioPerf - stt.speechEndPerf) * 10) / 10
          : null;

      const spans: Partial<Record<SonarSpanName, number | null>> = {
        ...extracted.spans,
        "voice-to-voice": voiceToVoice,
        "stt.handshake": stt.marks.wsHandshakeMs,
        "stt.endpoint-to-word": stt.marks.endpointToWordMs,
        "stt.word-span": stt.marks.wordSpanMs,
        "commit.hold": commitHoldMs > 0 ? commitHoldMs : null,
      };

      const turn: SonarTurnRecord = {
        sessionIndex,
        turnIndex,
        message: scripted,
        stt: {
          transcript: stt.transcript,
          scripted,
          wordCount: stt.words.length,
          fixtureSynthesized: fixture.synthesized,
        },
        spans,
        flags: {
          ...extracted.flags,
          sttEmpty: stt.error === "stt-empty",
          error: transportError ?? extracted.flags.error ?? sttHardError(stt.error),
        },
        usage: extracted.usage,
        serverTrace: extracted.serverTrace,
        orchestrateTrace: orchestrate?.trace ?? null,
      };
      turns.push(turn);

      const assistantText = frames
        .filter((f) => f.event === "token")
        .map((f) => String(f.data.delta ?? ""))
        .join("");
      history.push({ role: "user", content: transcript });
      if (assistantText) {
        history.push({ role: "assistant", content: assistantText });
        sceneTurns.push({ speakerSlug: character, speakerName: character, text: assistantText });
      }

      log(
        `  turn ${turnIndex + 1}/${suite.turns.length} · ` +
          (turn.flags.error && turn.flags.error !== "stt-empty"
            ? `ERROR ${turn.flags.error}`
            : `v2v=${fmt(voiceToVoice)} stt=${fmt(stt.marks.endpointToWordMs)} ` +
              `vs.ttfa=${fmt(spans["vs.ttfa"])} llm=${fmt(spans["server.llm.ttft"])}` +
              (orchestrate ? ` orch=${fmt(spans["orchestrate.total"])}` : "") +
              (turn.flags.contextCacheHit ? " [ctx-cache]" : "") +
              ` · "${truncate(stt.transcript || "(empty)")}"`),
      );

      if (settleMs > 0) await sleep(settleMs);
    }

    await http
      .patch(`/api/scene-sessions/${sessionId}`, {
        status: "ended",
        metadata: { source: "sonar", runId, endedBy: "sonar-runner" },
      })
      .catch((err: unknown) => log(`  (session end failed: ${String(err)})`));
  }

  const aggregates: Partial<Record<SonarSpanName, SonarAggregate>> = {};
  for (const span of SONAR_SPANS) {
    const values = turns.map((t) => t.spans[span]).filter((v): v is number => typeof v === "number");
    const agg = aggregate(values);
    if (agg) aggregates[span] = agg;
  }

  return {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    sonarVersion: SONAR_VERSION,
    suite: { name: suite.name, version: suite.version, mode: suite.mode },
    git: opts.git ?? null,
    baseUrl: opts.baseUrl,
    label: opts.label ?? null,
    config: {
      character,
      model: opts.model ?? null,
      ttsVoice: opts.ttsVoice ?? null,
      commitHoldMs,
      prewarm: Boolean(opts.prewarm),
      sessions,
      turnsPerSession: suite.turns.length,
    },
    observed: {
      providers: unique(turns.map((t) => t.usage.provider)),
      models: unique(turns.map((t) => t.usage.model)),
      ttsProviders: unique(turns.map((t) => t.usage.ttsProvider)),
      ttsVoices: unique(turns.map((t) => t.usage.ttsVoice)),
    },
    turns,
    aggregates,
    errors: turns.filter((t) => t.flags.error && t.flags.error !== "stt-empty").length,
    totalCostUsd: round6(turns.reduce((acc, t) => acc + (t.usage.estimatedCostUsd ?? 0), 0)),
  };
}

/** stt-empty is a soft signal (we fell back); other STT errors are hard. */
function sttHardError(error: string | null): string | null {
  return error && error !== "stt-empty" ? `stt: ${error}` : null;
}

function makeHttp(baseUrl: string, cookie: string) {
  const headers = (json = true): Record<string, string> => ({
    ...(json ? { "Content-Type": "application/json" } : {}),
    Cookie: cookie,
  });
  const post = (path: string, body: unknown): Promise<Response> =>
    fetch(`${baseUrl}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  return {
    post,
    postJson: async (path: string, body: unknown): Promise<Record<string, unknown>> => {
      const res = await post(path, body);
      if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text().catch(() => "")}`);
      return (await res.json()) as Record<string, unknown>;
    },
    patch: async (path: string, body: unknown): Promise<void> => {
      await fetch(`${baseUrl}${path}`, { method: "PATCH", headers: headers(), body: JSON.stringify(body) });
    },
  };
}

function initialSceneSnapshot(sceneId: string, characterSlug: string) {
  return {
    version: 1,
    sceneId,
    sceneState: {
      sceneId,
      beat: "A Sonar benchmark session is open and waiting for the user to begin.",
      presentCharacterSlugs: [characterSlug],
      ambience: null,
      lastSpeakerSlug: null,
      turnIndex: 0,
    },
    sceneMemory: [],
    updatedAt: new Date().toISOString(),
  };
}

function promptChunkFromDecision(decision: unknown): string | undefined {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) return undefined;
  const d = decision as Record<string, unknown>;
  if (d.action !== "speak") return undefined;
  return (
    [
      typeof d.beat === "string" ? `Scene direction (orchestrator): ${d.beat}` : "",
      typeof d.sceneCue === "string" ? `Scene cue: ${d.sceneCue}` : "",
      typeof d.beatLabel === "string" ? `Beat: ${d.beatLabel}` : "",
    ]
      .filter(Boolean)
      .join("\n") || undefined
  );
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

function fmt(value: number | null | undefined): string {
  return typeof value === "number" ? `${Math.round(value)}ms` : "–";
}

function truncate(text: string, max = 40): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
