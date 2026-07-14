# @odyssey/voice-agent

The LiveKit twin of `services/voice-host`. A long-running `@livekit/agents` worker that
registers with LiveKit, is dispatched into a room, and (from A2 on) runs the Odyssey voice
pipeline server-side over a WebRTC track — gaining real-time transport, AEC, and barge-in
that the SSE path can't do. The knowledge-graph brain (`runVoiceStream`) is reused unchanged.

## Status — A1 (skeleton)

This is the **A1** cut: the worker **registers + connects + warms bge + proves transport**
(logs the room, participants, and subscribed tracks). It does **not** produce audio yet.

Sequenced next:
- **A2** — replace the `entry` body with an `AgentSession` whose end-of-turn calls
  `runVoiceStream` (the same generator voice-host uses) and publishes audio to the room.
- **A3** — STT plugin (hosted, or audio-rt behind the agent).
- **A4** — Silero VAD + LiveKit **v1-mini** turn detector (replaces Smart Turn).

## Run (the A1 gate)

1. **Install** (from repo root). `@livekit/agents` is intentionally NOT in `package.json` — its
   version isn't pinned yet, so add it explicitly to lock the real one:
   ```
   npm install                                             # reconciles the new workspace into the lockfile
   npm install @livekit/agents@latest -w @odyssey/voice-agent   # adds the framework, pins the real version
   # A3/A4: npm install @livekit/agents-plugin-silero@latest @livekit/agents-plugin-livekit@latest -w @odyssey/voice-agent  (+ an STT plugin)
   ```
   Then `npx tsc --noEmit -p services/voice-agent` to confirm `src/agent.ts`'s imports match the
   installed SDK — the worker/session API is version-sensitive (see the note in `src/agent.ts`).
2. **Credentials.** Create a LiveKit Cloud project; copy `.env.example` → `.env` and fill
   `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`.
3. **Run the worker** (from repo root):
   ```
   npm run agent:voice -- dev
   ```
4. **Trigger the gate.** Join a room the worker is dispatched to (e.g. the LiveKit Cloud
   Agents Playground, or any client publishing a mic track). Expected logs:
   ```
   [voice-agent] healthz on :8080
   [voice-agent] bge warm — embedder ready
   [voice-agent] connected to room "<name>"
   [voice-agent] participant joined: <identity>
   [voice-agent] track audio from <identity>
   ```
   `GET /healthz` → `{ "ok": true, "service": "voice-agent" }` (process liveness only —
   prewarm runs in forked job subprocesses, so the health process can't see bge state).

That round-trip (worker registers → joins a room → sees the user's audio track) is the A1
exit criterion: transport is proven before any brain wiring.

## Deploy (Railway)

Dockerfile mirrors voice-host: build context = repo root, Dockerfile path
`services/voice-agent/Dockerfile`, `npm ci` + bge pre-bake, healthcheck `/healthz`. Set the
`LIVEKIT_*` env in Railway; leave `EMBEDDING_PROVIDER` unset (warm in-process bge).

> Branch: `feat/voice-agent` (off `origin/main`). Built in the `/tmp/odyssey-voice-agent`
> worktree to keep the main checkout's WIP untouched.
