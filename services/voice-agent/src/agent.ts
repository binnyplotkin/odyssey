/**
 * Odyssey voice-agent — A2 (runVoiceStream behind a LiveKit AgentSession).
 *
 * The LiveKit twin of `services/voice-host`. voice-host is a Fastify SSE server
 * the browser POSTs to; this is a long-running `@livekit/agents` WORKER that
 * registers with LiveKit, is dispatched into a room, and runs the pipeline
 * server-side over a WebRTC track (transport + AEC + barge-in come from the room).
 *
 * SHAPE: LiveKit owns the USER side — mic track → STT (LiveKit Inference model
 * string, billed via LiveKit, no separate key) → silero VAD (auto) → v1-mini
 * end-of-turn detector. On each finalized user turn we call `runVoiceStream` —
 * the SAME generator voice-host uses, the unchanged knowledge-graph brain — and
 * stream its audio into the room via `session.say('', { audio })`. No session
 * llm/tts: runVoiceStream does its own retrieve→curate→LLM→TTS.
 *
 * Wire: runVoiceStream yields `{ event: "audio", data: { pcm: base64<Float32>,
 * samples, sampleRate } }`; we convert Float32→Int16 AudioFrames.
 *
 * Run (repo root):  npx tsx --env-file=services/voice-agent/.env services/voice-agent/src/agent.ts dev
 * Requires LIVEKIT_URL / _API_KEY / _API_SECRET + VOICE_AGENT_CHARACTER_ID
 * (which character this worker voices) + the brain's env (DATABASE_URL,
 * CEREBRAS_API_KEY, ELEVENLABS_*, …) — see .env.example.
 *
 * Still A-series: A4 = tune the v1 detector; A5 = browser LiveKit client + token
 * mint; A6 = deploy + A/B. Multi-character/world is Arc 2.
 */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { warmLocalEmbedder } from "@odyssey/engine";
import {
  type JobContext,
  WorkerOptions,
  cli,
  defineAgent,
  inference,
  voice,
} from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import { getCharacterStore, getSceneSessionStore } from "@odyssey/db";
import { runVoiceStream } from "@odyssey/voice-pipeline";

// --- Railway healthcheck: the agents worker doesn't serve HTTP itself, so expose
// a tiny /healthz on its own port. embedderReady flips when bge is resident.
//
// IMPORTANT: @livekit/agents forks job + inference SUBPROCESSES that re-import
// this module (worker.js / job_proc_executor use child_process.fork). A forked
// child has an IPC channel (process.send is defined); the main worker process
// does not. Bind /healthz ONLY in the main process — otherwise the subprocess
// double-binds the port → EADDRINUSE → "process exited before initializing" →
// the dispatched job dies before the session ever starts. ---
let embedderReady = false;
const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? process.env.PORT ?? 8080);
if (!process.send) {
  const healthServer = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "voice-agent", embedderReady }));
      return;
    }
    res.writeHead(404).end();
  });
  // Defensive: a stray bind error must never crash the worker (see above).
  healthServer.on("error", (err) =>
    console.error(`[voice-agent] healthz server error: ${(err as Error).message}`),
  );
  healthServer.listen(HEALTH_PORT, "0.0.0.0", () =>
    console.log(`[voice-agent] healthz on :${HEALTH_PORT}`),
  );
}

// Which character this worker voices, and which LiveKit Inference STT model.
// (Single-character for A2; the world-agent will pick the character per turn.)
const CHARACTER_ID = process.env.VOICE_AGENT_CHARACTER_ID;
const STT_MODEL = process.env.VOICE_AGENT_STT ?? "deepgram/nova-3";

/** base64 Float32 LE PCM (one TTS chunk) → an Int16 mono AudioFrame for the room. */
function toAudioFrame(pcmBase64: string, sampleRate: number): AudioFrame {
  const buf = Buffer.from(pcmBase64, "base64");
  // Copy into a fresh, 4-byte-aligned ArrayBuffer — Buffer pooling can hand back
  // an unaligned byteOffset, which would make the Float32Array view throw.
  const aligned = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const f32 = new Float32Array(aligned);
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i] ?? 0));
    i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new AudioFrame(i16, sampleRate, 1, i16.length);
}

export default defineAgent({
  // prewarm runs once per worker process before any job — warm bge so the first
  // real turn is hot, matching voice-host's warm-bge boot.
  prewarm: async () => {
    await warmLocalEmbedder();
    embedderReady = true;
    console.log("[voice-agent] bge warm — embedder ready");
  },

  entry: async (ctx: JobContext) => {
    if (!CHARACTER_ID) {
      throw new Error("VOICE_AGENT_CHARACTER_ID is required (the character this worker voices)");
    }
    await ctx.connect();

    // Resolve the character (id or slug) and open a REAL scene_session for this
    // room. runVoiceStream persists per-turn context + telemetry against the
    // sessionId, so it must FK-resolve in scene_sessions — otherwise the
    // done-event insert violates scene_session_events_session_id_fkey and the
    // turn throws right after the audio (which is what swallowed the first reply).
    const character =
      (await getCharacterStore().getById(CHARACTER_ID)) ??
      (await getCharacterStore().getBySlug(CHARACTER_ID));
    if (!character) {
      throw new Error(`VOICE_AGENT_CHARACTER_ID "${CHARACTER_ID}" did not resolve to a character`);
    }
    const sceneSession = await getSceneSessionStore().createSession({
      characterId: character.id,
      mode: "voice",
    });
    const characterId = character.id;
    const sessionId = sceneSession.id;
    console.log(
      `[voice-agent] connected to room "${ctx.room.name}" — character=${character.slug ?? characterId} session=${sessionId} stt=${STT_MODEL}`,
    );

    // User side handled by LiveKit: STT (inference model string) + auto silero VAD
    // + the bundled v1-mini end-of-turn detector. No llm/tts — the brain generates.
    const session = new voice.AgentSession({
      stt: STT_MODEL,
      turnDetection: new inference.TurnDetector({ version: "v1-mini" }),
    });

    // The persona lives entirely in the knowledge-graph brain (runVoiceStream),
    // so the Agent's instructions are intentionally empty.
    const agent = new voice.Agent({ instructions: "" });

    let turn: AbortController | null = null;

    // One finalized user turn → run the brain, stream its audio into the room.
    const speak = (transcript: string, signal: AbortSignal) => {
      const audio = new ReadableStream<AudioFrame>({
        async start(controller) {
          try {
            for await (const ev of runVoiceStream(
              { characterId, message: transcript, sessionId },
              { signal },
            )) {
              if (signal.aborted) break;
              if (ev.event === "audio") {
                const d = ev.data as { pcm: string; sampleRate: number };
                controller.enqueue(toAudioFrame(d.pcm, d.sampleRate));
              } else if (ev.event === "first-audio") {
                console.log(`[voice-agent] first audio ${(ev.data as { latencyMs: number }).latencyMs}ms`);
              } else if (ev.event === "error") {
                console.error("[voice-agent] pipeline error", ev.data);
              }
            }
          } catch (err) {
            if (!signal.aborted) console.error("[voice-agent] turn failed", err);
          } finally {
            controller.close();
          }
        },
      });
      // Empty text + custom audio stream = publish our PCM as the agent's speech,
      // bypassing the session's (absent) TTS.
      session.say("", { audio, allowInterruptions: true });
    };

    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (!ev.isFinal) return;
      const text = ev.transcript.trim();
      if (!text) return;
      // A new finalized user turn supersedes whatever's in flight: cancel the
      // prior brain turn AND interrupt any audio still playing, then start fresh.
      // (Without the interrupt, rapid back-to-back utterances pile up speech
      // handles and the real reply never reaches the room — exactly what we hit.)
      turn?.abort();
      session.interrupt();
      turn = new AbortController();
      console.log(`[voice-agent] user: ${text}`);
      speak(text, turn.signal);
    });

    await session.start({ agent, room: ctx.room });
    console.log("[voice-agent] session started — listening");

    // DIAGNOSTIC (gated): on join, run ONE brain turn from a canned prompt so the
    // smoke client can verify the FULL brain→output path + scene_session
    // persistence WITHOUT needing STT (which is flaky under local CPU contention).
    // Doubles as a greeting. Set VOICE_AGENT_GREET=1.
    if (process.env.VOICE_AGENT_GREET === "1") {
      turn = new AbortController();
      console.log("[voice-agent] greet-test: running a canned brain turn on join");
      speak("Greet me warmly in one short sentence.", turn.signal);
    }
  },
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
