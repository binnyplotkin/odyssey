/**
 * Local token estimator. No network call — uses chars/4 rule which is within
 * ~10-15% of Anthropic's tokenizer for English prose. Budget math doesn't
 * need to be exact; the caller includes headroom.
 *
 * Claude tokenizer is BPE-style. Punctuation + whitespace + code bump the
 * ratio; prose with long words keeps it tight. For page bodies (prose with
 * wikilinks) chars/4 is fine.
 */

export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  // Round up — we'd rather over-budget than under-render.
  return Math.ceil(text.length / 4);
}
