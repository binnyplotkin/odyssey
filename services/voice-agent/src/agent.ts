/**
 * Odyssey voice-agent — A1 skeleton (LiveKit Node worker).
 *
 * The LiveKit twin of `services/voice-host`. Where voice-host is a Fastify SSE
 * server the browser POSTs to, this is a long-running `@livekit/agents` WORKER
 * that registers with LiveKit, is dispatched into a room, and runs the pipeline
 * server-side over a WebRTC track (transport + AEC + barge-in come from the room).
 *
 * A1 SCOPE (this file): register + connect + warm bge + prove transport (logs).
 * The brain, STT, and turn detector are deliberately NOT here yet:
 *   - A2 — replace the entry body with an AgentSession whose end-of-turn calls
 *          `runVoiceStream` (the SAME generator voice-host uses) and publishes the
 *          audio to the room. The knowledge-graph brain is reused unchanged.
 *   - A3 — STT plugin (hosted, or audio-rt behind the agent).
 *   - A4 — Silero VAD + LiveKit v1-mini turn detector (replaces Smart Turn).
 *
 * Run (from repo root):  npm run agent:voice -- dev
 * Requires LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET (see .env.example).
 *
 * ⚠ VERSION-SENSITIVE: the @livekit/agents worker/session API changes across
 * minor versions. After `npm install`, run `tsc --noEmit -p services/voice-agent`
 * and `npm run agent:voice -- dev` to lock these imports to the installed SDK
 * before building A2 on top. The `^1.4.7` pin is per research — confirm with
 * `npm install @livekit/agents@latest`.
 */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { warmLocalEmbedder } from "@odyssey/engine";
import { type JobContext, WorkerOptions, cli, defineAgent } from "@livekit/agents";

// --- Railway healthcheck: the agents worker doesn't serve HTTP itself, so expose
// a tiny /healthz on its own port. embedderReady flips when bge is resident. ---
let embedderReady = false;
const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? process.env.PORT ?? 8080);
createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "voice-agent", embedderReady }));
    return;
  }
  res.writeHead(404).end();
}).listen(HEALTH_PORT, "0.0.0.0", () => console.log(`[voice-agent] healthz on :${HEALTH_PORT}`));

export default defineAgent({
  // prewarm runs once per worker process before any job is handled — warm bge here
  // so the first real turn (A2) is hot, matching voice-host's warm-bge boot.
  prewarm: async () => {
    await warmLocalEmbedder();
    embedderReady = true;
    console.log("[voice-agent] bge warm — embedder ready");
  },

  entry: async (ctx: JobContext) => {
    await ctx.connect();
    // A1 gate: prove transport. The worker is dispatched into a room and connects;
    // we log the room + participants + subscribed tracks. No audio is produced yet.
    console.log(`[voice-agent] connected to room "${ctx.room.name}"`);
    ctx.room.on("participantConnected", (p) => console.log(`[voice-agent] participant joined: ${p.identity}`));
    ctx.room.on("trackSubscribed", (_track, pub, p) => console.log(`[voice-agent] track ${pub.kind} from ${p.identity}`));
    // A2: const session = new AgentSession({ vad, stt, turnDetection, /* llm/tts via runVoiceStream */ });
    //     await session.start({ room: ctx.room, agent });
  },
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
