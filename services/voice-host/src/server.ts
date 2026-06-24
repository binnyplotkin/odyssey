import cors from "@fastify/cors";
import { warmLocalEmbedder } from "@odyssey/engine";
import {
  runVoiceStream,
  VoiceStreamHttpError,
  type VoiceStreamBody,
  type VoiceStreamEvent,
} from "@odyssey/voice-pipeline";
import Fastify from "fastify";
import { jwtVerify } from "jose";

// Warm, long-running twin of the Vercel voice-stream route. Both call the same
// `@odyssey/voice-pipeline` `runVoiceStream` generator, so the SSE wire contract
// is byte-identical — the only difference is this process stays hot: bge runs
// in-process (~60ms) instead of a cold OpenAI embed, and the context/ack caches
// survive across turns. See the warm-host migration plan.

const PORT = Number(process.env.PORT ?? 8080);
const startedAtMs = Date.now();
let embedderReady = false;

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  // Behind the Railway/edge proxy.
  trustProxy: true,
});

// CORS: in prod, allow only the admin origin(s) via VOICE_HOST_ALLOWED_ORIGINS
// (comma-separated). With none set (local dev) reflect the request origin.
const allowedOrigins = (process.env.VOICE_HOST_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
await app.register(cors, {
  origin: allowedOrigins.length > 0 ? allowedOrigins : true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
});

// Auth: verify the short-lived bearer token minted by /api/voice/host-token
// (HS256, VOICE_HOST_TOKEN_SECRET). With the secret unset (local dev) auth is
// disabled so the SSE smoke runs tokenless — never deploy the host without it.
type VoiceHostTokenClaims = {
  sub?: string;
  characterId?: string;
  sessionId?: string | null;
  role?: string;
};
const tokenSecret = process.env.VOICE_HOST_TOKEN_SECRET;
const tokenKey = tokenSecret ? new TextEncoder().encode(tokenSecret) : null;
if (!tokenKey) {
  app.log.warn(
    "VOICE_HOST_TOKEN_SECRET unset — /voice-stream is UNAUTHENTICATED (dev only)",
  );
}

app.addHook("onRequest", async (req, reply) => {
  // /healthz is public (Railway healthcheck); CORS preflight handled by cors.
  if (req.url === "/healthz" || req.method === "OPTIONS") return;
  if (!tokenKey) return; // dev: auth disabled

  const header = req.headers.authorization;
  const bearer =
    header && header.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : null;
  if (!bearer) {
    return reply.code(401).send({ error: "missing bearer token" });
  }
  try {
    const { payload } = await jwtVerify(bearer, tokenKey, {
      algorithms: ["HS256"],
    });
    (req as { voiceToken?: VoiceHostTokenClaims }).voiceToken =
      payload as VoiceHostTokenClaims;
  } catch {
    return reply.code(401).send({ error: "invalid or expired token" });
  }
});

app.get("/healthz", async () => ({
  ok: true,
  embedderReady,
  uptime: (Date.now() - startedAtMs) / 1000,
}));

app.post("/voice-stream", async (req, reply) => {
  const body = (req.body ?? {}) as Partial<VoiceStreamBody> & {
    characterId?: string;
  };
  const characterId = body.characterId;
  if (!characterId) {
    return reply.code(400).send({ error: "characterId is required" });
  }

  // The token authorizes one character; reject cross-character reuse.
  const claims = (req as { voiceToken?: VoiceHostTokenClaims }).voiceToken;
  if (tokenKey && claims && claims.characterId !== characterId) {
    return reply.code(403).send({ error: "token characterId mismatch" });
  }

  // Barge-in / client disconnect → abort the in-flight turn (TTS fetches too).
  // Listen on the RESPONSE close, not req.raw: an IncomingMessage emits "close"
  // as soon as its body is fully read (which Fastify does up front), which would
  // abort the pipeline before it streams a single frame. reply.raw "close" fires
  // only on a real disconnect or on normal completion (a harmless late abort).
  const ac = new AbortController();
  reply.raw.on("close", () => ac.abort());

  const iterator = runVoiceStream(
    { ...(body as VoiceStreamBody), characterId },
    { signal: ac.signal },
  )[Symbol.asyncIterator]();

  // Same eager-first-frame contract as the Vercel adapter: a pre-stream
  // VoiceStreamHttpError surfaces as a clean JSON 4xx/5xx; once we hold a frame
  // we commit to the event-stream and mid-stream failures arrive as `error`
  // frames (the pipeline emits those itself).
  let first: IteratorResult<VoiceStreamEvent>;
  try {
    first = await iterator.next();
  } catch (err) {
    if (err instanceof VoiceStreamHttpError) {
      return reply.code(err.status).send({ error: err.message });
    }
    return reply
      .code(500)
      .send({ error: err instanceof Error ? err.message : String(err) });
  }

  reply.hijack();
  const res = reply.raw;
  // reply.hijack() bypasses Fastify's reply lifecycle, so @fastify/cors never
  // adds its headers to this streamed response: the preflight passes but the
  // actual SSE response would lack Access-Control-Allow-Origin and the browser
  // blocks reading it ("Failed to fetch"). Re-apply the cors allowlist here by
  // hand on the raw response.
  const reqOrigin = req.headers.origin;
  const corsOrigin =
    allowedOrigins.length === 0
      ? (reqOrigin ?? "*")
      : reqOrigin && allowedOrigins.includes(reqOrigin)
        ? reqOrigin
        : null;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...(corsOrigin
      ? { "Access-Control-Allow-Origin": corsOrigin, Vary: "Origin" }
      : {}),
  });
  const write = (ev: VoiceStreamEvent) => {
    try {
      res.write(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
    } catch {
      // socket may already be closed (client aborted) — swallow.
    }
  };
  try {
    if (!first.done) write(first.value);
    for (let r = await iterator.next(); !r.done; r = await iterator.next()) {
      write(r.value);
    }
  } catch (err) {
    write({
      event: "error",
      data: { message: err instanceof Error ? err.message : String(err) },
    });
  } finally {
    try {
      res.end();
    } catch {
      /* already ended */
    }
  }
});

// Open the port immediately (Railway healthcheck wants it up fast), then warm
// bge concurrently. `embedderReady` flips when the model is resident; a turn
// that races in before then still gets a hot embedder because embedTextLocal
// awaits the same lazy singleton.
await app.listen({ port: PORT, host: "0.0.0.0" });
warmLocalEmbedder()
  .then(() => {
    embedderReady = true;
    app.log.info("bge embedder warm");
  })
  .catch((err) => app.log.error({ err }, "warmLocalEmbedder failed"));
