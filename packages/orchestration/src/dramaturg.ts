/**
 * The dramaturg — the slow half of the two-tier orchestration.
 *
 * The per-turn director is fast, strict-schema, and latency-critical; it
 * pursues authored goals but has no memory of PROGRESS toward them. The
 * dramaturg runs ASYNC off the voice hot path (fire-and-forget after
 * turns complete), reviews the scene with a stronger model and a
 * free-form prompt, and writes one short director's note into
 * `SceneState.directorNote` — which the fast director reads on its next
 * decision as its own earlier reflection. Thinking at write time, cheap
 * reads.
 *
 * This module is the PURE half (prompt building + output sanitization) so
 * it unit-tests without a network; the SceneDriver owns the ChatProvider
 * call, cadence, and state write.
 */
import type { Scene, SceneState } from "@odyssey/types";
import { buildArcBlock, type SceneTurnForPlanning } from "./client";

const NOTE_MAX_CHARS = 300;

export type DramaturgRequest = {
  system: string;
  user: string;
};

export function buildDramaturgMessages(input: {
  scene: Scene;
  sceneState: SceneState;
  recentTurns: SceneTurnForPlanning[];
  previousNote?: string;
}): DramaturgRequest {
  const { scene, sceneState, recentTurns, previousNote } = input;

  const cast = scene.characters
    .filter((c) => sceneState.presentCharacterSlugs.includes(c.characterSlug))
    .map((c) => {
      const lines = [`- ${c.displayName} (${c.characterSlug}): ${c.blurb}`];
      if (c.motivations) lines.push(`    wants: ${c.motivations}`);
      for (const t of c.behaviorTriggers ?? []) {
        lines.push(`    will: ${t.behavior} (when ${t.condition})`);
      }
      return lines.join("\n");
    })
    .join("\n");

  const dialogue = recentTurns.length
    ? recentTurns
        .map((t) => `  ${t.speakerName ?? t.speakerSlug}: ${t.text}`)
        .join("\n")
    : "  (no dialogue yet)";

  const system = [
    "You are the DRAMATURG reviewing a live improvised voice scene between",
    "authored characters and one real user. You do NOT write dialogue and you",
    "do NOT pick speakers — a separate turn director does that, fast, every",
    "turn. Your job is the longer view: reflect on how the scene is actually",
    "going against its authored intentions.",
    "",
    "Write ONE short director's note (at most 2 sentences, under",
    `${NOTE_MAX_CHARS} characters) addressed to the turn director:`,
    "- what has LANDED (goals advanced, triggers fired, beats that worked)",
    "- what is STALLED or being avoided",
    "- which character's goal needs pressure next, and how close the scene",
    "  is to its objective",
    "Be concrete and directive ('Sarah's laugh has landed; Abraham's trust",
    "question is still unanswered — steer back to what the stranger knows'),",
    "never generic ('keep up the good work'). Plain text only: no quotes, no",
    "markdown, no preamble.",
    ...(scene.arc?.length
      ? [
          "",
          "The scene has an authored arc (shown with progress markers). Reply in",
          "EXACTLY this format — nothing else:",
          "LANDED: <beat label only, copied verbatim — not its summary>",
          "NOTE: <your note>",
          "Emit one LANDED line per pending ([next]/[ahead]) beat that has now",
          "clearly happened in the dialogue; zero LANDED lines if none did. If",
          "your NOTE says a beat happened, its LANDED line must be present too.",
          "Only mark beats that unambiguously happened — when in doubt, don't.",
        ]
      : []),
  ].join("\n");

  const anyHorizon = scene.characters.some(
    (c) =>
      sceneState.presentCharacterSlugs.includes(c.characterSlug) && c.knowledgeHorizon,
  );

  const user = [
    `Scene: "${scene.title}"`,
    scene.description,
    ...(scene.objective ? [`Objective: ${scene.objective}`] : []),
    ...(anyHorizon
      ? [
          "The characters live in this scene's dramatic present — their later",
          "life has NOT happened yet. A character recounting events beyond this",
          "moment is a canon break, never a beat landing; flag it in your note",
          "and steer the scene back.",
        ]
      : []),
    ...buildArcBlock(scene, sceneState),
    "",
    "Cast and authored intentions:",
    cast,
    "",
    `Current situation: ${sceneState.beat}`,
    "",
    "Recent dialogue:",
    dialogue,
    ...(previousNote
      ? ["", `Your previous note: ${previousNote}`, "Revise or replace it in light of the dialogue above."]
      : []),
    "",
    scene.arc?.length ? "Your reply (LANDED lines if any, then NOTE):" : "Your note:",
  ].join("\n");

  return { system, user };
}

/**
 * Split a reflection into the director's note and any `LANDED: <label>`
 * beat declarations (case-insensitive, one per line, wherever they
 * appear). Labels are returned RAW — the caller validates them against
 * the scene's actual arc before trusting them.
 */
export function parseDramaturgReflection(raw: string): {
  note: string | null;
  landed: string[];
} {
  const landed: string[] = [];
  const noteLines: string[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*landed\s*:\s*(.+?)\s*$/i);
    if (m) landed.push(m[1]!);
    else noteLines.push(line);
  }
  return { note: sanitizeDramaturgNote(noteLines.join("\n")), landed };
}

/**
 * Match a raw LANDED label against the authored arc, tolerantly: exact
 * (case-insensitive, trimmed) or the raw string starting with the label
 * followed by a separator — models sometimes copy the rendered
 * `label - summary` line despite instructions. Returns the canonical
 * label or null.
 */
export function matchArcLabel(raw: string, arcLabels: string[]): string | null {
  const needle = raw.trim().toLowerCase();
  if (!needle) return null;
  for (const label of arcLabels) {
    const l = label.toLowerCase();
    if (needle === l) return label;
    if (
      needle.startsWith(l) &&
      /^[\s\-–—:.,]/.test(needle.slice(l.length) || " ")
    ) {
      return label;
    }
  }
  return null;
}

/**
 * The arc is ORDERED: a later beat landing means every earlier beat is
 * behind us — the dramaturg often marks only the beat that just happened
 * (observed: beat 2 landed while beat 1, clearly done, stayed pending,
 * stalling the director's steering). Expand a landed set to the full
 * prefix of the arc up to the furthest landed beat, in arc order.
 * Labels are matched case-insensitively; labels not in the arc are ignored.
 */
export function expandLandedBeats(landed: string[], arcLabels: string[]): string[] {
  const landedLower = new Set(landed.map((l) => l.trim().toLowerCase()));
  let maxIdx = -1;
  arcLabels.forEach((label, i) => {
    if (landedLower.has(label.toLowerCase())) maxIdx = i;
  });
  return maxIdx >= 0 ? arcLabels.slice(0, maxIdx + 1) : [];
}

/**
 * Normalize a model's free-form note into something safe to inject into
 * the director prompt: strip wrapping quotes / markdown fences / label
 * prefixes, collapse whitespace, cap length. Returns null when nothing
 * usable remains (caller keeps the previous note).
 */
export function sanitizeDramaturgNote(raw: string): string | null {
  let note = raw.trim();
  // Fenced block → inner text.
  const fence = note.match(/^```[a-z]*\n?([\s\S]*?)\n?```$/i);
  if (fence) note = fence[1]!.trim();
  // Common label prefixes the model might add despite instructions.
  note = note.replace(/^(director'?s? note|note)\s*[:\-–]\s*/i, "");
  // Wrapping quotes.
  note = note.replace(/^["'“]+/, "").replace(/["'”]+$/, "");
  // Collapse internal whitespace/newlines to single spaces.
  note = note.replace(/\s+/g, " ").trim();
  if (!note) return null;
  if (note.length > NOTE_MAX_CHARS) {
    // Cut at the last sentence boundary that fits; hard-cap otherwise.
    const slice = note.slice(0, NOTE_MAX_CHARS);
    const lastStop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
    note = lastStop > 80 ? slice.slice(0, lastStop + 1) : slice;
  }
  return note;
}
