/**
 * Headless A2 smoke test — proves the voice-agent loop end-to-end without a human.
 *
 * Publishes a spoken WAV into a fresh room as a "mic" track; the registered agent
 * (automatic dispatch) joins, does STT + turn detection, runs runVoiceStream, and
 * publishes the character's voice back. We capture that response audio track and
 * report frames received + first-audio latency.
 *
 * Run the worker first (same env), then this:
 *   npx tsx --env-file=services/voice-agent/.env services/voice-agent/src/agent.ts dev
 *   npx tsx --env-file=services/voice-agent/.env services/voice-agent/scripts/smoke.ts [path.wav]
 */
import { readFileSync } from "node:fs";
import { AccessToken } from "livekit-server-sdk";
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  dispose,
} from "@livekit/rtc-node";

const URL = process.env.LIVEKIT_URL;
const KEY = process.env.LIVEKIT_API_KEY;
const SECRET = process.env.LIVEKIT_API_SECRET;
if (!URL || !KEY || !SECRET) {
  console.error("set LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET (use --env-file)");
  process.exit(2);
}

const WAV = process.argv[2] ?? "/tmp/utterance.wav";
// SMOKE_ROOM lets us target a scene room (scene-<sceneId>-<uuid>) to exercise the
// multi-character orchestrator loop; default is a single-character smoke room.
const ROOM = process.env.SMOKE_ROOM ?? `char-abraham-smoke-${Date.now()}`;

/** Minimal 16-bit PCM WAV reader → { sampleRate, channels, pcm: Int16Array }. */
function readWav(path: string): { sampleRate: number; channels: number; pcm: Int16Array } {
  const b = readFileSync(path);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${path}: not a RIFF/WAVE file`);
  }
  let off = 12;
  let sampleRate = 16000;
  let channels = 1;
  let dataOff = 44;
  let dataLen = b.length - 44;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === "fmt ") {
      channels = b.readUInt16LE(off + 10);
      sampleRate = b.readUInt32LE(off + 12);
    } else if (id === "data") {
      dataOff = off + 8;
      dataLen = size;
      break;
    }
    off += 8 + size + (size % 2);
  }
  const pcm = new Int16Array(dataLen / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = b.readInt16LE(dataOff + i * 2);
  return { sampleRate, channels, pcm };
}

async function main() {
  const at = new AccessToken(KEY!, SECRET!, { identity: "smoke-tester", ttl: 300 });
  at.addGrant({ roomJoin: true, room: ROOM, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();

  const room = new Room();
  const t0 = Date.now();
  const VOICE_THRESHOLD = 500; // Int16 |amp| > ~1.5% of full scale = real audio, not silence
  let firstVoicedMs = 0;
  let voicedFrames = 0;
  let peak = 0;
  let respFrames = 0;
  let respSamples = 0;
  let agentJoined = false;

  room.on(RoomEvent.ParticipantConnected, (p) => {
    agentJoined = true;
    console.log(`[smoke] participant joined: ${p.identity} (← the agent)`);
  });
  room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
    console.log(`[smoke] subscribed ${track.kind} from ${participant.identity}`);
    if (track.kind === TrackKind.KIND_AUDIO) {
      const stream = new AudioStream(track);
      void (async () => {
        for await (const frame of stream) {
          // Energy gate: an idle AgentSession publishes a SILENT output track, so
          // "received frames" ≠ "received speech". Count only frames with real amplitude.
          const data = frame.data;
          let framePeak = 0;
          for (let j = 0; j < data.length; j++) {
            const a = Math.abs(data[j] ?? 0);
            if (a > framePeak) framePeak = a;
          }
          if (framePeak > peak) peak = framePeak;
          respFrames++;
          respSamples += frame.samplesPerChannel;
          if (framePeak > VOICE_THRESHOLD) {
            voicedFrames++;
            if (firstVoicedMs === 0) {
              firstVoicedMs = Date.now() - t0;
              console.log(`[smoke] ◀ FIRST voiced agent audio @ ${firstVoicedMs}ms (peak ${framePeak})`);
            }
          }
        }
      })();
    }
  });

  await room.connect(URL!, token, { autoSubscribe: true, dynacast: false });
  console.log(`[smoke] connected to room ${ROOM}`);

  const { sampleRate, channels, pcm } = readWav(WAV);
  const source = new AudioSource(sampleRate, channels);
  const track = LocalAudioTrack.createAudioTrack("smoke-mic", source);
  await room.localParticipant!.publishTrack(
    track,
    new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
  );
  console.log(
    `[smoke] ▶ publishing "${WAV}" (${sampleRate}Hz ${channels}ch, ${(pcm.length / sampleRate).toFixed(1)}s)`,
  );

  const FRAME = Math.floor(sampleRate / 100); // 10ms frames; captureFrame paces to real-time
  for (let i = 0; i < pcm.length; i += FRAME) {
    const slice = pcm.subarray(i, Math.min(i + FRAME, pcm.length));
    await source.captureFrame(new AudioFrame(slice, sampleRate, channels, slice.length));
  }
  // ~1s trailing silence so the agent's VAD/turn detector sees end-of-speech.
  const sil = new Int16Array(FRAME);
  for (let k = 0; k < 100; k++) {
    await source.captureFrame(new AudioFrame(sil, sampleRate, channels, sil.length));
  }
  console.log("[smoke] utterance sent; waiting up to 30s for the agent to respond…");

  await new Promise((r) => setTimeout(r, 30_000));

  console.log("\n=== SMOKE RESULT ===");
  console.log(`agent joined room : ${agentJoined}`);
  console.log(`audio frames (any): ${respFrames}`);
  console.log(`VOICED frames     : ${voicedFrames} (peak ${peak}/32767)`);
  console.log(`first voiced audio: ${firstVoicedMs ? `${firstVoicedMs}ms` : "— (none — silent track only)"}`);
  // PASS needs real speech energy, not just the session's silent keepalive track.
  const ok = voicedFrames >= 20 && peak > VOICE_THRESHOLD;
  console.log(
    ok
      ? "✅ A2 LOOP WORKS — the agent heard the utterance and spoke a real response."
      : "❌ no real speech from the agent (silent track only) — STT/brain didn't complete; see worker logs.",
  );
  await room.disconnect();
  await dispose();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("[smoke] error:", e);
  process.exit(1);
});
