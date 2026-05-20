import type { CharacterIdentity } from "@odyssey/db";

/**
 * Compile an L01 Identity into the `<identity>` block that lives at the
 * top of the cached system envelope.
 *
 * Design references:
 *   - Anthropic's "Keep Claude in Character" — the identity anchor is
 *     the single highest-leverage line in the prompt; concrete + brief
 *     beats abstract + long.
 *   - Araujo et al. 2025 — top-2 attributes recover >80% of behavioural
 *     fidelity; more dilutes. Hence the hard cap enforced upstream.
 *   - Synthesized in `odyssey labs - harness` Paper file, artboard 7QO-0
 *     "L01 Identity".
 *
 * Falls back to the hardcoded "You are {name}…" line when identity is
 * null or every section is empty.
 */
export function compileIdentityXml(
  characterName: string,
  identity: CharacterIdentity | null | undefined,
): string {
  // No identity at all → caller gets the hardcoded fallback (handled in
  // character-system-prompt.ts so we don't duplicate the fallback string).
  if (!identity) return "";

  const essence = identity.essence?.trim();
  const traits = (identity.traits ?? []).filter((t) => t.name?.trim());
  const era = identity.era?.trim();
  const setting = identity.setting?.trim();

  // If every section is empty after trimming, return empty so the caller
  // falls back. Matters during early authoring when the editor is open
  // but nothing's been filled in yet.
  if (!essence && traits.length === 0 && !era && !setting) return "";

  const lines: string[] = [];

  // First line is always the name anchor — non-negotiable, even when
  // essence is missing, so the model has SOMETHING to attach voice to.
  if (essence) {
    lines.push(`  You are ${characterName}, ${essence}`);
  } else {
    lines.push(`  You are ${characterName}.`);
  }

  // Traits — emitted as a short "Two defining traits" block when both
  // are present, or as a single-trait note when only one is set.
  if (traits.length === 2) {
    lines.push("");
    lines.push(`  Two defining traits:`);
    for (const t of traits) {
      const desc = t.description?.trim();
      lines.push(`    - ${t.name.trim()}${desc ? ` — ${desc}` : ""}`);
    }
  } else if (traits.length === 1) {
    const t = traits[0];
    const desc = t.description?.trim();
    lines.push("");
    lines.push(`  Defining trait: ${t.name.trim()}${desc ? ` — ${desc}` : ""}`);
  }

  // Era + setting — light context for grounding. Stays terse.
  if (era || setting) {
    lines.push("");
    if (era) lines.push(`  Era: ${era}.`);
    if (setting) lines.push(`  Setting: ${setting}.`);
  }

  return `<identity>\n${lines.join("\n")}\n</identity>`;
}
