/**
 * SPIKE — speculative turn-driving hit-rate harness  (throwaway; delete after it informs Arc 2)
 *
 * Question: when we run the scene orchestrator's speaker-selection on the AT-PAUSE partial
 * transcript (during the endpoint hold) instead of the final transcript, how often does the
 * chosen speaker MATCH the final decision? High -> speaker-selection is effectively free
 * (hidden under the hold, like the speculative whisper decode); low -> it's on the critical path.
 *
 * Calls the REAL decision core (buildSceneDecisionRequest -> Cerebras/Groq -> resolveSceneDecision),
 * which is pure + persistence-free, over a corpus with realistic CONVERSATION CONTEXT and a
 * realistic pause model. Reports speculative hit-rate by category + the zero-LLM front-address
 * heuristic coverage. "no-speak" finals (orchestrator chose wait-for-user) are excluded from the
 * hit denominator — speculation isn't needed there.
 *
 * Run: npx tsx --env-file=.env packages/orchestration/spikes/speculative-turn-driving.ts
 *      (uses CEREBRAS_API_KEY or GROQ_API_KEY; no key -> heuristic-only pass)
 */
import {
  createInitialSceneState,
  buildSceneDecisionRequest,
  resolveSceneDecision,
} from "../src/client";

const scene: any = {
  id: "scene:dinner",
  title: "Dinner at Mamre",
  characters: [
    { characterSlug: "abraham", displayName: "Abraham", voice: "abraham", blurb: "The host, an old tent-dweller." },
    { characterSlug: "sarah", displayName: "Sarah", voice: "sarah", blurb: "Abraham's wife — sharp, dry." },
  ],
  openingBeat: "The meal begins under the oaks.",
  defaultAmbience: null,
};

type Cat = "address-front" | "address-end" | "mid-thought" | "follow-up";
interface Turn { speakerSlug: string; text: string }
interface Utt {
  final: string;
  /** words before the user pauses (= the at-pause partial the endpoint hold sees) */
  pauseWords: number;
  category: Cat;
  /** the turn(s) leading up to this user message — real context the orchestrator gets in prod */
  recent: Turn[];
  lastSpeaker: string;
}

const A = (text: string): Turn[] => [{ speakerSlug: "abraham", text }];
const S = (text: string): Turn[] => [{ speakerSlug: "sarah", text }];

const CORPUS: Utt[] = [
  // complete-at-pause (the COMMON real case — hold fires after the user stops, partial ≈ final)
  { final: "Abraham, what do you make of the visitors?", pauseWords: 8, category: "address-front", recent: A("Three men approach the tent."), lastSpeaker: "abraham" },
  { final: "Why is that?", pauseWords: 3, category: "follow-up", recent: A("I trusted the voice before I understood it."), lastSpeaker: "abraham" },
  { final: "And what did she say then?", pauseWords: 6, category: "follow-up", recent: S("I did not laugh."), lastSpeaker: "sarah" },
  { final: "What happened after the meal?", pauseWords: 5, category: "follow-up", recent: A("The visitors ate under the tree."), lastSpeaker: "abraham" },
  // front-address, early pause (name already in the partial)
  { final: "Abraham, were you afraid on the mountain?", pauseWords: 1, category: "address-front", recent: A("We climbed Moriah together."), lastSpeaker: "abraham" },
  { final: "Sarah, what was that like for you?", pauseWords: 1, category: "address-front", recent: A("Sarah waited at the tent."), lastSpeaker: "abraham" },
  // address at END (partial misses the trailing name -> expected MISS / invalidate)
  { final: "What do you think they want, Sarah?", pauseWords: 5, category: "address-end", recent: A("The strangers have not yet spoken."), lastSpeaker: "abraham" },
  { final: "And how did that feel, Sarah?", pauseWords: 5, category: "address-end", recent: A("She bore a son in her old age."), lastSpeaker: "abraham" },
  // mid-thought pause before the addressee/intent (the case that also triggers the 2s ceiling)
  { final: "Tell me, Sarah, why did you deny it?", pauseWords: 2, category: "mid-thought", recent: A("She was afraid, and denied laughing."), lastSpeaker: "abraham" },
  { final: "So the question is, Abraham, did you doubt?", pauseWords: 4, category: "mid-thought", recent: S("He never wavered, he says."), lastSpeaker: "sarah" },
];

const partialOf = (u: Utt) => u.final.split(" ").slice(0, u.pauseWords).join(" ");

function frontAddressee(msg: string): string | null {
  const head = msg.toLowerCase().replace(/^(hey|so|and|well|um+|uh+|okay)[ ,]+/i, "").trimStart();
  for (const c of scene.characters) {
    const name = String(c.displayName).toLowerCase();
    if (head === name || head.startsWith(name + ",") || head.startsWith(name + " ")) return c.characterSlug;
  }
  return null;
}

const KEY = process.env.CEREBRAS_API_KEY ?? process.env.GROQ_API_KEY ?? "";
const USE_GROQ = !process.env.CEREBRAS_API_KEY && !!process.env.GROQ_API_KEY;
const ENDPOINT = USE_GROQ ? "https://api.groq.com/openai/v1/chat/completions" : "https://api.cerebras.ai/v1/chat/completions";
const MODEL = process.env.ORCHESTRATOR_MODEL ?? (USE_GROQ ? "openai/gpt-oss-120b" : "gpt-oss-120b");

function stateFor(u: Utt): any {
  const s: any = createInitialSceneState(scene);
  s.lastSpeakerSlug = u.lastSpeaker;
  s.turnIndex = (u.recent?.length ?? 0) + 1;
  return s;
}

async function decideSpeaker(message: string, u: Utt): Promise<string | null> {
  const req: any = buildSceneDecisionRequest({
    scene,
    sceneState: stateFor(u),
    recentTurns: [...u.recent, { speakerSlug: "user", text: message }],
    sceneMemory: u.recent.map((t) => `${t.speakerSlug}: ${t.text}`),
    lastUserMessage: message,
  });
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, messages: req.messages, temperature: 0, response_format: { type: "json_object" } }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  let raw: unknown = {};
  try { raw = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}"); } catch { /* fallback */ }
  const resolution: any = resolveSceneDecision({ scene, sceneState: stateFor(u) }, raw);
  return resolution?.speakerSlug ?? resolution?.decision?.speakerId ?? null;
}

async function main() {
  console.log(`scene: ${scene.title} · ${scene.characters.length} chars`);
  console.log(KEY ? `decision model: ${MODEL} (${USE_GROQ ? "groq" : "cerebras"})\n` : `NO API KEY — heuristic-only pass\n`);

  const agg: Record<string, { speak: number; hits: number; heur: number; noSpeak: number }> = {};
  const bump = (c: string) => (agg[c] ??= { speak: 0, hits: 0, heur: 0, noSpeak: 0 });

  for (const u of CORPUS) {
    const partial = partialOf(u);
    const heur = frontAddressee(partial);
    const a = bump(u.category);
    if (!KEY) { console.log(`${u.category.padEnd(13)} | heur=${(heur ?? "—").padEnd(8)} | "${partial}…"`); if (heur) a.heur++; a.speak++; continue; }

    const sFinal = await decideSpeaker(u.final, u);
    if (sFinal == null) { a.noSpeak++; console.log(`wait | ${u.category.padEnd(13)} | final→wait-for-user (excluded) | "${u.final}"`); continue; }
    const sPartial = await decideSpeaker(partial, u);
    const hit = sPartial === sFinal;
    a.speak++; if (hit) a.hits++; if (heur && heur === sFinal) a.heur++;
    console.log(`${hit ? "HIT " : "MISS"} | ${u.category.padEnd(13)} | partial→${String(sPartial ?? "—").padEnd(8)} final→${String(sFinal).padEnd(8)} | heur=${(heur ?? "—").padEnd(8)} | "${partial}…"`);
  }

  console.log("\n— summary (excludes wait-for-user turns) —");
  let SP = 0, H = 0, HE = 0, NS = 0;
  for (const [cat, s] of Object.entries(agg)) {
    SP += s.speak; H += s.hits; HE += s.heur; NS += s.noSpeak;
    console.log(`  ${cat.padEnd(13)}  ${KEY ? `${s.hits}/${s.speak} hit` : "n/a"}   heuristic ${s.heur}   ${s.noSpeak ? `(${s.noSpeak} wait)` : ""}`);
  }
  if (KEY && SP) console.log(`\n  speculative hit-rate: ${H}/${SP} (${Math.round((100 * H) / SP)}%)   |   ${NS} wait-for-user excluded`);
  console.log(`  heuristic coverage:   ${HE}/${SP || CORPUS.length}  ← turns the zero-LLM front-address check already nails`);
}

main().catch((e) => { console.error("spike failed:", e?.message ?? e); process.exit(1); });
