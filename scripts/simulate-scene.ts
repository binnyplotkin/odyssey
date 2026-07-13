/**
 * Scene simulator — run full scene sessions headlessly, text-only, through
 * the REAL orchestration stack: SceneDriver (director decisions, dramaturg
 * reflections, arc landing, sfx cues) + runVoiceStream in textOnly mode
 * (retrieve → curate → LLM, identical persistence, zero TTS).
 *
 * Usage (repo root):
 *   npm run simulate -- --scene <id|slug> --turns turns.txt
 *   npm run simulate -- --scene <id|slug> --user "a skeptical traveler" --max-turns 6
 *   npm run simulate -- --character abraham --interactive
 *
 * Flags:
 *   --scene <id|slug>        multi-character scene (SceneDriver.load)
 *   --character <slug|id>    solo sandbox (SceneDriver.fromCharacter)
 *   --turns <file>           scripted user turns (one per line; blank lines skipped)
 *   --interactive            type the user's turns on stdin
 *   --user "<persona/goal>"  an LLM plays the user
 *   --user-model <id>        model for the simulated user (default claude-haiku-4-5-20251001)
 *   --max-turns <n>          turn cap for --user mode (default 8)
 *   --delay <ms>             pause between turns (default 0) — real sessions
 *                            pace naturally; back-to-back scripted turns can
 *                            trip orchestrator-provider TPM limits (Groq free
 *                            tier ≈ 2 orchestrates/min → use ~25000)
 *   --persist                create a scene_session; turns + context builds +
 *                            state snapshots persist (gradeable in /sessions)
 *   --json <path>            dump the structured run transcript
 *
 * Env: DATABASE_URL, CEREBRAS_API_KEY (director), ANTHROPIC_API_KEY
 * (dramaturg + simulated user), plus the character brains' provider keys.
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { getCharacterStore, getSceneSessionStore } from "@odyssey/db";
import { getChatProviderForModel } from "@odyssey/engine";
import { runVoiceStream } from "@odyssey/voice-pipeline";
import type { SceneSessionSnapshot } from "@odyssey/orchestration";
import { SceneDriver, type SceneSpeakInput } from "../services/voice-agent/src/scene-driver";

/* ── Flags ────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const has = (name: string) => args.includes(name);

const sceneId = flag("--scene");
const characterRef = flag("--character");
const turnsFile = flag("--turns");
const interactive = has("--interactive");
const userPersona = flag("--user");
const userModel = flag("--user-model") ?? "claude-haiku-4-5-20251001";
const maxTurns = Number(flag("--max-turns") ?? 8);
const turnDelayMs = Number(flag("--delay") ?? 0);
const persist = has("--persist");
const jsonPath = flag("--json");

/* ── Output helpers ───────────────────────────────────────────── */

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

type TurnRecord = {
  turnIndex: number;
  userText: string;
  speaker: string | null;
  direction: string | null;
  reply: string | null;
  sfx: Array<{ id: string; at: string }>;
  driveMs: number;
  directorNote: string | null;
  arcLanded: string[];
  beat: string;
  ambience: string | null;
};

/* ── Main ─────────────────────────────────────────────────────── */

async function main() {
  if (!sceneId && !characterRef) {
    console.error("usage: --scene <id|slug> OR --character <slug|id> (see header for modes)");
    process.exit(1);
  }
  if (!turnsFile && !interactive && !userPersona) {
    console.error("pick a user-turn source: --turns <file> | --interactive | --user \"<persona>\"");
    process.exit(1);
  }

  // ── Load the scene through the same paths the voice agent uses.
  let driver: SceneDriver;
  if (sceneId) {
    const loaded = await SceneDriver.load(sceneId);
    if (!loaded) throw new Error(`scene "${sceneId}" did not resolve`);
    driver = loaded;
  } else {
    const store = getCharacterStore();
    const character =
      (await store.getBySlug(characterRef!)) ?? (await store.getById(characterRef!));
    if (!character) throw new Error(`character "${characterRef}" did not resolve`);
    driver = SceneDriver.fromCharacter(character);
  }
  const scene = driver.scene;

  console.log(bold(`\n▶ ${scene.title}`));
  console.log(dim(`  cast: ${scene.characters.map((c) => c.displayName).join(", ")}`));
  if (scene.objective) console.log(dim(`  objective: ${scene.objective}`));
  if (scene.arc?.length) {
    console.log(dim(`  arc: ${scene.arc.map((b) => b.label).join(" → ")}`));
  }
  if (scene.sounds?.length) {
    console.log(
      dim(`  sounds: ${scene.sounds.map((s) => `${s.slug}(${s.role})`).join(", ")}`),
    );
  }

  // ── Optional persistence: same rows the voice agent writes, so the run
  // is gradeable in /sessions (Eval tab) with the dramaturg notebook.
  const sessionStore = getSceneSessionStore();
  let sessionId: string | undefined;
  if (persist) {
    const session = await sessionStore.createSession({
      sceneId: scene.id,
      characterId: null,
      mode: "chat",
      metadata: {
        source: "scene-simulator",
        ...(userPersona ? { persona: userPersona } : {}),
        ...(turnsFile ? { turnsFile } : {}),
      },
    });
    sessionId = session.id;
    console.log(dim(`  session: ${sessionId} (persisted — visible in /sessions)`));
  }

  // ── Observability hooks: sfx cues + state snapshots.
  let pendingSfx: Array<{ id: string; at: string }> = [];
  driver.onSfx((cues) => {
    pendingSfx.push(...cues.map((c) => ({ id: c.id, at: c.at })));
  });
  let latestSnapshot: SceneSessionSnapshot | null = null;
  driver.onState((snapshot) => {
    latestSnapshot = snapshot;
    if (sessionId) {
      void sessionStore
        .updateCurrentScene({ sessionId, currentScene: snapshot })
        .catch(() => undefined);
    }
  });

  // ── speak(): the character brain, text-only, production persistence.
  let currentSpeak: {
    speaker: string;
    direction: string | null;
    horizon: string | null;
  } | null = null;
  const speak = async (input: SceneSpeakInput, _replyId: string): Promise<string> => {
    currentSpeak = {
      speaker: input.speaker.name,
      direction: input.promptChunk ?? null,
      horizon: input.currentMoment
        ? `${input.currentMoment.era}:${input.currentMoment.index}`
        : null,
    };
    let reply = "";
    const abort = new AbortController();
    for await (const ev of runVoiceStream(
      {
        characterId: input.characterId,
        message: input.message,
        history: input.history,
        promptChunk: input.promptChunk,
        currentMoment: input.currentMoment,
        textOnly: true,
        ...(sessionId ? { sessionId, turnId: crypto.randomUUID() } : {}),
      },
      { signal: abort.signal },
    )) {
      if (ev.event === "token") {
        reply += (ev.data as { delta: string }).delta ?? "";
      } else if (ev.event === "error") {
        console.error(yellow(`  ! pipeline error: ${JSON.stringify(ev.data)}`));
      }
    }
    return reply;
  };

  // ── User-turn source.
  const scriptedTurns = turnsFile
    ? readFileSync(turnsFile, "utf-8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : null;
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const userProvider = userPersona ? getChatProviderForModel(userModel) : null;

  const transcript: Array<{ who: string; text: string }> = [];
  const nextUserTurn = async (turnIndex: number): Promise<string | null> => {
    if (scriptedTurns) return scriptedTurns[turnIndex] ?? null;
    if (rl) {
      const line = (await rl.question(cyan("you> "))).trim();
      return line || null;
    }
    if (userProvider && userPersona) {
      if (turnIndex >= maxTurns) return null;
      const system = [
        "You are role-playing THE USER in a live voice scene with AI characters.",
        `Scene: ${scene.title} — ${scene.description}`,
        `Your persona/goal: ${userPersona}`,
        "Reply with ONLY the user's next spoken utterance (1–2 conversational",
        "sentences, no quotes, no stage directions). Stay in persona; pursue",
        "your goal; react naturally to what the characters just said.",
      ].join("\n");
      const messages = transcript.length
        ? [
            {
              role: "user" as const,
              content:
                "Dialogue so far:\n" +
                transcript.map((t) => `${t.who}: ${t.text}`).join("\n") +
                "\n\nYour next utterance:",
            },
          ]
        : [{ role: "user" as const, content: "Open the conversation — your first utterance:" }];
      const res = await userProvider.complete({
        model: userModel,
        system: [{ type: "text", text: system }],
        messages,
        maxTokens: 120,
        signal: AbortSignal.timeout(20_000),
      });
      return res.text.trim().replace(/^["']|["']$/g, "") || null;
    }
    return null;
  };

  // ── The session loop.
  const records: TurnRecord[] = [];
  for (let turnIndex = 0; ; turnIndex++) {
    const userText = await nextUserTurn(turnIndex);
    if (!userText) break;

    console.log(`\n${dim(`── turn ${turnIndex + 1} `.padEnd(56, "─"))}`);
    console.log(`${cyan("USER:")} ${userText}`);
    transcript.push({ who: "User", text: userText });

    pendingSfx = [];
    currentSpeak = null;
    const before = latestSnapshot?.sceneState;
    const startedAt = Date.now();

    let reply = "";
    const outcome = await driver.drive(userText, async (input, replyId) => {
      reply = await speak(input, replyId);
      return reply;
    });
    const driveMs = Date.now() - startedAt;

    if (outcome.action !== "speak" || !outcome.spoke) {
      console.log(magenta(`▸ director: ${outcome.action} (no character turn)`));
    } else {
      console.log(
        magenta(`▸ director: speak → ${currentSpeak?.speaker ?? "?"}`) +
          dim(`   (turn ${driveMs}ms total)`),
      );
      if (currentSpeak?.direction) {
        for (const line of currentSpeak.direction.split("\n")) {
          console.log(dim(`▸ ${line}`));
        }
      }
      if (currentSpeak?.horizon) {
        console.log(dim(`▸ knowledge horizon: ${currentSpeak.horizon}`));
      }
      for (const cue of pendingSfx) console.log(yellow(`▸ sfx: ${cue.id} (${cue.at})`));
      console.log(`${green(`${currentSpeak?.speaker?.toUpperCase() ?? "CHARACTER"}:`)} ${reply}`);
      if (currentSpeak?.speaker) transcript.push({ who: currentSpeak.speaker, text: reply });
    }

    // Let the dramaturg land before the next turn so its note/arc updates
    // influence the NEXT decision deterministically.
    await driver.settleReflection();
    const after = latestSnapshot?.sceneState;
    if (after?.directorNote && after.directorNote !== before?.directorNote) {
      console.log(magenta(`▸ dramaturg: ${after.directorNote}`));
    }
    if (scene.arc?.length) {
      const landed = new Set((after?.arcLanded ?? []).map((l: string) => l.toLowerCase()));
      const arcLine = scene.arc
        .map((b) => (landed.has(b.label.toLowerCase()) ? `✓ ${b.label}` : `· ${b.label}`))
        .join("   ");
      console.log(dim(`▸ arc: ${arcLine}`));
    }
    if (after && after.beat !== before?.beat) {
      console.log(dim(`▸ beat: ${after.beat}`));
    }

    records.push({
      turnIndex,
      userText,
      speaker: currentSpeak?.speaker ?? null,
      direction: currentSpeak?.direction ?? null,
      reply: reply || null,
      sfx: pendingSfx,
      driveMs,
      directorNote: after?.directorNote ?? null,
      arcLanded: after?.arcLanded ?? [],
      beat: after?.beat ?? scene.openingBeat,
      ambience: after?.ambience ?? scene.defaultAmbience,
    });

    if (outcome.action === "end-scene") {
      console.log(magenta("\n▸ director ended the scene."));
      break;
    }

    if (turnDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, turnDelayMs));
    }
  }
  rl?.close();

  // ── Summary.
  const final = latestSnapshot?.sceneState;
  console.log(`\n${dim("═".repeat(56))}`);
  console.log(bold("Session summary"));
  console.log(`  turns: ${records.length}`);
  if (records.length) {
    const avg = Math.round(records.reduce((s, r) => s + r.driveMs, 0) / records.length);
    console.log(`  avg turn: ${avg}ms`);
  }
  if (scene.arc?.length) {
    console.log(`  arc: ${final?.arcLanded?.length ?? 0}/${scene.arc.length} beats landed`);
  }
  if (final?.directorNote) console.log(`  final note: ${final.directorNote}`);
  if (sessionId) console.log(`  session: ${sessionId}`);

  if (jsonPath) {
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(
      jsonPath,
      JSON.stringify(
        { scene: scene.id, sessionId: sessionId ?? null, records, finalState: final },
        null,
        2,
      ),
    );
    console.log(dim(`  json: ${jsonPath}`));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
