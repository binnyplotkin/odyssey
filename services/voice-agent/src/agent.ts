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
 * end-of-turn detector. At the real end of each user turn (gated by that detector
 * via onUserTurnCompleted — NOT raw STT finals) we call `runVoiceStream` —
 * the SAME generator voice-host uses, the unchanged knowledge-graph brain — and
 * push its audio onto a dedicated published track we own (NOT session.say, which
 * the AgentSession interrupts while finalizing the user turn). No session
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
  llm,
  voice,
} from "@livekit/agents";
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";
import { BackgroundVoiceCancellation } from "@livekit/noise-cancellation-node";
import { type CharacterRecord, getCharacterStore, getSceneSessionStore } from "@odyssey/db";
import { runVoiceStream } from "@odyssey/voice-pipeline";
import { SceneDriver } from "./scene-driver";

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
// B4: speculative speaker-selection. Orchestrate off the partial transcript during
// the endpoint hold so the multi-character speaker is usually already chosen when
// the turn completes (hiding the ~0.5s orchestrate gap). Kill-switch: =0.
const SPECULATE_ENABLED = process.env.VOICE_AGENT_SPECULATE !== "0";

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

/** Rooms are named `char-<characterId>-<sessionId>` by the browser's token route, so
 *  both the character AND the sandbox's pre-created scene_session are per-ROOM. Pull
 *  out both: the characterId picks who to voice; the sessionId lets the agent persist
 *  turns to the SAME session /sessions shows (so they're gradeable) instead of an
 *  orphan it invents. */
function parseCharacterFromRoom(
  roomName: string | undefined,
): { characterId: string; sessionId: string } | null {
  const match = roomName?.match(
    /^char-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/i,
  );
  return match ? { characterId: match[1]!, sessionId: match[2]! } : null;
}

/** `scene-<sceneId>-<sessionId>` rooms run the multi-character orchestrator loop.
 *  sceneId may be a slug ("abrahams-tent") or a DB UUID; the trailing session UUID
 *  anchors the split. */
function parseSceneFromRoom(
  roomName: string | undefined,
): { sceneId: string; sessionId: string } | null {
  const match = roomName?.match(
    /^scene-(.+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
  return match ? { sceneId: match[1]!, sessionId: match[2]! } : null;
}

/**
 * Agent that replies via a caller-supplied callback at the REAL end of the user's
 * turn. We override `onUserTurnCompleted` (fired after the v1 turn detector
 * confirms the turn is over) instead of reacting to raw STT finals — Deepgram emits
 * a "final" at every pause, so keying off those made Abraham cut in mid-sentence.
 * Then we throw `StopResponse`: the reply is on our own track, so the session must
 * skip its own (LLM-less) `generateReply`.
 */
class BrainAgent extends voice.Agent {
  readonly #respond: (text: string) => void;

  constructor(respond: (text: string) => void) {
    super({ instructions: "" });
    this.#respond = respond;
  }

  override async onUserTurnCompleted(
    _chatCtx: llm.ChatContext,
    newMessage: llm.ChatMessage,
  ): Promise<void> {
    const text = newMessage.textContent?.trim();
    if (text) this.#respond(text);
    throw new voice.StopResponse();
  }
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
    await ctx.connect();

    // The unit of voice is a SCENE. A `scene-<sceneId>-<sessionId>` room runs the
    // multi-character orchestrator loop (SceneDriver picks who speaks each turn); a
    // `char-<characterId>-<sessionId>` room is the degenerate one-character case.
    // VOICE_AGENT_CHARACTER_ID is only a fallback for rooms that encode neither
    // (e.g. the LiveKit Playground / direct tests).
    const sceneRef = parseSceneFromRoom(ctx.room.name);
    const charRef = sceneRef ? null : parseCharacterFromRoom(ctx.room.name);
    let sceneDriver: SceneDriver | null = null;
    let character: CharacterRecord | null = null;
    if (sceneRef) {
      sceneDriver = await SceneDriver.load(sceneRef.sceneId);
      if (!sceneDriver) {
        throw new Error(`scene "${sceneRef.sceneId}" (room "${ctx.room.name}") did not resolve`);
      }
    } else {
      const characterRef = charRef?.characterId ?? CHARACTER_ID;
      if (!characterRef) {
        throw new Error(
          `no character: room "${ctx.room.name}" didn't encode one and VOICE_AGENT_CHARACTER_ID is unset`,
        );
      }
      character =
        (await getCharacterStore().getById(characterRef)) ??
        (await getCharacterStore().getBySlug(characterRef));
      if (!character) {
        throw new Error(`character "${characterRef}" (from room "${ctx.room.name}") did not resolve`);
      }
    }

    // Persist to the sandbox's OWN scene_session — the one in the room name, already
    // created by the browser before connecting. Reusing it means the agent's turns
    // land in the SAME session /sessions shows, so they're gradeable in the Eval tab
    // (instead of an orphan session the agent invents). runVoiceStream needs the row
    // to FK-resolve, which the sandbox guarantees. Only create one when the room
    // carries none or it doesn't resolve (e.g. the LiveKit Playground / direct tests).
    const sessionStore = getSceneSessionStore();
    const roomSessionId = sceneRef?.sessionId ?? charRef?.sessionId ?? null;
    const existingSession = roomSessionId
      ? await sessionStore.getSession(roomSessionId).catch(() => null)
      : null;
    const sceneSession =
      existingSession ??
      (await sessionStore.createSession({ characterId: character?.id ?? null, mode: "voice" }));
    const sessionId = sceneSession.id;
    console.log(
      `[voice-agent] session ${sessionId} (${existingSession ? "reused sandbox session — gradeable" : "created"})`,
    );
    console.log(
      `[voice-agent] connected to room "${ctx.room.name}" — ${
        sceneDriver
          ? `scene=${sceneDriver.scene.id} (${sceneDriver.scene.characters.length} characters)`
          : `character=${character!.slug ?? character!.id}`
      } session=${sessionId} stt=${STT_MODEL}`,
    );

    // User side handled by LiveKit: STT (inference model string) + auto silero VAD
    // + the bundled v1-mini end-of-turn detector. No llm/tts — the brain generates.
    const session = new voice.AgentSession({
      stt: STT_MODEL,
      turnDetection: new inference.TurnDetector({ version: "v1-mini" }),
      // Raise the endpointing floor above the 300ms default so a brief mid-sentence
      // pause (e.g. "…different than [pause] the rest of the days?") doesn't end the
      // turn early when the detector over-eagerly calls it complete. maxDelay
      // (2500ms) for clearly-incomplete turns stays the default.
      turnHandling: { endpointing: { minDelay: 700 } },
    });

    // Own the agent's audio OUTPUT directly: a dedicated published track fed from
    // runVoiceStream. We deliberately do NOT use session.say — the AgentSession
    // interrupts its own speech while finalizing the user turn ("speech
    // interrupted, new user turn detected"), which truncated say()-driven replies
    // to ~12ms. A separate track sidesteps that machinery; barge-in is an explicit
    // audioSource.clearQueue() on the next user turn.
    const OUTPUT_SAMPLE_RATE = 24000; // runVoiceStream/ElevenLabs emit 24 kHz mono
    const audioSource = new AudioSource(OUTPUT_SAMPLE_RATE, 1);
    const outTrack = LocalAudioTrack.createAudioTrack("agent-voice", audioSource);

    let turn: AbortController | null = null;

    // Publish turn transcripts over a data channel so the sandbox can render them —
    // the user's FULL turn (grouped, not raw per-pause STT segments) and the
    // character's streaming reply text. Topic-scoped; the client filters by it.
    const transcriptEncoder = new TextEncoder();
    const publishTurn = (msg: {
      role: "user" | "agent";
      id: string;
      text: string;
      final: boolean;
      // Multi-character scenes: which character voiced this agent turn so the
      // client can label it (single-character rooms omit it — the UI knows who).
      speaker?: { slug: string; name: string };
    }): void => {
      void ctx.room.localParticipant?.publishData(
        transcriptEncoder.encode(JSON.stringify(msg)),
        { reliable: true, topic: "odyssey.transcript" },
      );
    };

    // Voice one character's turn: run the brain for input.characterId, push its audio
    // onto our output track, stream its text as a transcript, and resolve to the full
    // reply (fed back into the scene's running transcript). captureFrame paces to
    // real-time, so the loop naturally tracks playback.
    const speak = async (
      input: {
        characterId: string;
        message: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
        promptChunk?: string;
        speaker?: { slug: string; name: string };
      },
      signal: AbortSignal,
      replyId: string,
    ): Promise<string> => {
      const { speaker, ...streamInput } = input;
      // runVoiceStream only persists the turn (context build + record the workbench
      // renders) when given BOTH sessionId AND turnId — pass one per turn so live
      // voice turns are debuggable in /sessions, not just the SSE sandbox.
      const turnId = crypto.randomUUID();
      let replyText = "";
      try {
        for await (const ev of runVoiceStream({ ...streamInput, sessionId, turnId }, { signal })) {
          if (signal.aborted) break;
          if (ev.event === "audio") {
            const d = ev.data as { pcm: string; sampleRate: number };
            await audioSource.captureFrame(toAudioFrame(d.pcm, d.sampleRate));
          } else if (ev.event === "token") {
            const delta = (ev.data as { delta: string }).delta;
            if (delta) {
              replyText += delta;
              publishTurn({ role: "agent", id: replyId, text: replyText, final: false, speaker });
            }
          } else if (ev.event === "first-audio") {
            console.log(`[voice-agent] first audio ${(ev.data as { latencyMs: number }).latencyMs}ms`);
          } else if (ev.event === "error") {
            console.error("[voice-agent] pipeline error", ev.data);
          }
        }
        if (replyText && !signal.aborted) {
          publishTurn({ role: "agent", id: replyId, text: replyText, final: true, speaker });
        }
      } catch (err) {
        if (!signal.aborted) console.error("[voice-agent] turn failed", err);
      }
      return replyText;
    };

    // B4: accumulate the user's finalized STT segments so we can orchestrate off the
    // running transcript while the turn is still being held open. Reset each turn.
    let userSegments: string[] = [];

    // Reply at the REAL end of the user's turn (gated by the v1 detector), superseding
    // whatever's in flight. SCENE rooms route through the orchestrator (who speaks);
    // single-character rooms run that one character directly.
    const respond = (text: string) => {
      turn?.abort();
      audioSource.clearQueue();
      turn = new AbortController();
      const signal = turn.signal;
      console.log(`[voice-agent] user: ${text}`);
      publishTurn({ role: "user", id: `u${Date.now()}`, text, final: true });
      if (sceneDriver) {
        void sceneDriver.drive(text, (input, replyId) => speak(input, signal, replyId));
      } else {
        void speak({ characterId: character!.id, message: text }, signal, `a${Date.now()}`);
      }
      userSegments = []; // next turn starts a fresh speculation accumulation
    };
    const agent = new BrainAgent(respond);

    // B4: speculative speaker-selection. Each finalized STT segment (Deepgram emits
    // one per pause) extends the running transcript; orchestrate off it NOW so the
    // speaker is usually decided before the turn formally completes. Read-only — we
    // never SPEAK here (that's onUserTurnCompleted), so there's no mid-sentence cut-in.
    if (sceneDriver && SPECULATE_ENABLED) {
      session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
        if (!ev.isFinal) return;
        const seg = ev.transcript.trim();
        if (!seg) return;
        userSegments.push(seg);
        sceneDriver!.speculate(userSegments.join(" "));
      });
    }

    // Responsive barge-in: the instant the user starts speaking, cancel the
    // in-flight brain turn and drop buffered audio so Abraham stops mid-word
    // (don't wait for the transcript to finalize). The mic track is AEC'd by the
    // browser, so this fires on real user speech — not Abraham's own audio echoing
    // back — and the session suppresses it during AEC warmup.
    session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
      if (ev.newState === "speaking") {
        turn?.abort();
        audioSource.clearQueue();
      }
    });

    await session.start({
      agent,
      room: ctx.room,
      // Krisp background-voice + noise cancellation on the USER's audio, applied
      // before STT / VAD / turn-detection — so room noise and other voices don't
      // trigger turns or interrupt the agent.
      inputOptions: { noiseCancellation: BackgroundVoiceCancellation() },
    });
    // Publish our output track now that the room is connected.
    await ctx.room.localParticipant!.publishTrack(
      outTrack,
      new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
    );
    console.log("[voice-agent] session started — listening (own output track)");

    // DIAGNOSTIC (gated): on join, drive ONE turn from a canned user message so the
    // smoke client can verify the loop WITHOUT STT — a scene room exercises the full
    // orchestrate→speaker→brain path; a single-character room just runs the brain.
    // Set VOICE_AGENT_GREET=1.
    if (process.env.VOICE_AGENT_GREET === "1") {
      turn = new AbortController();
      const greetSignal = turn.signal;
      if (sceneDriver) {
        console.log("[voice-agent] greet-test: driving one scene turn on join");
        void sceneDriver.drive("Hello? Who's here?", (input, replyId) =>
          speak(input, greetSignal, replyId),
        );
      } else if (character) {
        console.log("[voice-agent] greet-test: running a canned brain turn on join");
        void speak(
          { characterId: character.id, message: "Greet me warmly in one short sentence." },
          greetSignal,
          `greet${Date.now()}`,
        );
      }
    }
  },
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
