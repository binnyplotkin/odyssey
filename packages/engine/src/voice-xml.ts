import type { CharacterVoiceStyle } from "@odyssey/db";

/**
 * Compile a CharacterVoiceStyle into the `<voice>` block that lives in
 * the cached system envelope between identity/directive and delivery.
 *
 * Design references:
 *   - OpenAI Personalities API + GPT-5.1 Prompting Guide — personality
 *     is multi-dimensional; emit each axis as its own sub-tag so the
 *     model can attend to them independently.
 *   - Synthesized in `odyssey labs - harness` Paper file, artboard 72V-1
 *     "L03 Voice & Style".
 *
 * Returns the empty string when no axis has content — caller falls
 * back to leaving the block out entirely (no empty `<voice>` tag).
 *
 * Note: audio-channel fields (voicePrompt, referenceClipUrl, prosody)
 * are NOT emitted in the `<voice>` text block — they go to the TTS
 * pipeline (1.3b). Surfacing them as prose in the system prompt would
 * confuse the model (which doesn't speak the audio at all).
 */
export function compileVoiceXml(
  voiceStyle: CharacterVoiceStyle | null | undefined,
): string {
  if (!voiceStyle) return "";

  const tone = (voiceStyle.tone ?? []).map((s) => s.trim()).filter(Boolean);
  const decision = voiceStyle.decision?.trim();
  const brevity = voiceStyle.brevity;
  const register = voiceStyle.register;

  // If every text-channel axis is empty, skip the block entirely.
  // (The audio-channel fields can exist on their own and still feed TTS
  // in 1.3b — they just don't generate any system-prompt text.)
  if (!tone.length && !decision && !brevity && !register) return "";

  const lines: string[] = [];

  if (tone.length) {
    lines.push(`  <tone>${tone.join(" · ")}</tone>`);
  }
  if (decision) {
    lines.push(`  <decision>${decision}</decision>`);
  }
  if (brevity) {
    lines.push(`  <brevity>${brevityLabel(brevity)}</brevity>`);
  }
  if (register) {
    lines.push(`  <register>${registerLabel(register)}</register>`);
  }

  return `<voice>\n${lines.join("\n")}\n</voice>`;
}

/** Map the enum to a phrase the model parses unambiguously. */
function brevityLabel(b: CharacterVoiceStyle["brevity"]): string {
  switch (b) {
    case "terse":     return "1 sentence — terse, almost telegraphic";
    case "short":     return "2–4 sentences default";
    case "medium":    return "5–8 sentences when the question warrants depth";
    case "long":      return "a short paragraph or two, never more";
    case "paragraph": return "expansive — a full paragraph or more for substantive questions";
    default:          return "2–4 sentences default";
  }
}

/** Map the 2D register pad to a short phrase. Both axes are -1..1.
 * Combinations land on the four quadrants plus the neutral center. */
function registerLabel(r: { formality: number; warmth: number }): string {
  const f = clamp(r.formality, -1, 1);
  const w = clamp(r.warmth, -1, 1);

  const fLabel = f >= 0.33 ? "formal" : f <= -0.33 ? "casual" : "balanced";
  const wLabel = w >= 0.33 ? "warm"   : w <= -0.33 ? "cool"   : "even";

  // "balanced · even" reads weird — collapse to single word in that case.
  if (fLabel === "balanced" && wLabel === "even") return "balanced";
  return `${fLabel} · ${wLabel}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
