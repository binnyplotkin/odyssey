/**
 * Input-utterance fixtures. Sonar needs *audio* to start each turn from;
 * recording a human is the highest-fidelity source, but to bootstrap a
 * reproducible benchmark we synthesize each scripted prompt once via
 * OpenAI TTS (a neutral "user" voice, not the character) and cache the WAV.
 *
 * Reproducibility/fidelity tradeoff: synthetic input is clean studio audio,
 * so VAD/STT perform near best-case — fine for tracking the downstream
 * stack's progression, optimistic for absolute STT realism. Drop a real
 * recording at the fixture path to override; the loader doesn't care how
 * the WAV was made. This is the documented path to production-audio
 * benchmarking later.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const FIXTURES_DIR = "evals/sonar/fixtures";
const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";

export type SynthOptions = {
  /** Neutral user voice — deliberately not a character voice. */
  voice?: string;
  model?: string;
};

const DEFAULT_VOICE = "ash";
const DEFAULT_MODEL = "gpt-4o-mini-tts";

export function fixtureId(text: string, voice: string, model: string): string {
  return crypto.createHash("sha1").update(`${model}|${voice}|${text}`).digest("hex").slice(0, 12);
}

export function fixturePath(repoRoot: string, suite: string, turnIndex: number, id: string): string {
  return path.join(repoRoot, FIXTURES_DIR, `${suite}-t${turnIndex}-${id}.wav`);
}

/** Synthesize one prompt to a 24kHz WAV via OpenAI TTS. */
export async function synthToWav(text: string, opts: SynthOptions = {}): Promise<Uint8Array> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required to synthesize input fixtures");
  const res = await fetch(OPENAI_SPEECH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      voice: opts.voice ?? DEFAULT_VOICE,
      input: text,
      response_format: "wav",
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI TTS ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Ensure a WAV fixture exists for a prompt, synthesizing + caching on miss.
 * Returns the loaded WAV bytes and the path.
 */
export async function ensureFixture(input: {
  repoRoot: string;
  suite: string;
  turnIndex: number;
  text: string;
  opts?: SynthOptions;
  log?: (line: string) => void;
}): Promise<{ wav: Uint8Array; file: string; synthesized: boolean }> {
  const voice = input.opts?.voice ?? DEFAULT_VOICE;
  const model = input.opts?.model ?? DEFAULT_MODEL;
  const id = fixtureId(input.text, voice, model);
  const file = fixturePath(input.repoRoot, input.suite, input.turnIndex, id);
  if (fs.existsSync(file)) {
    return { wav: fs.readFileSync(file), file, synthesized: false };
  }
  input.log?.(`  synth fixture · turn ${input.turnIndex} · "${truncate(input.text)}"`);
  const wav = await synthToWav(input.text, { voice, model });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, wav);
  return { wav, file, synthesized: true };
}

function truncate(text: string, max = 48): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
