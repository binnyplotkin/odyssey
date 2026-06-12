/**
 * TTS cost estimation for Sonar runs. The voice-stream route only prices
 * LLM tokens (estimateSessionTurnCost), so without this a hosted-TTS run
 * reports the same cost as a free self-hosted one — misleading when the
 * whole point of the TTS A/B is a cost/latency tradeoff.
 *
 * Rates are USD per 1,000 characters synthesized — ESTIMATES, since hosted
 * TTS is usually credit-based and the per-character dollar value depends on
 * your plan tier. Tune these to your actual contract; the goal here is
 * "non-zero and roughly right," not invoice-accurate.
 *
 * Sources (mid-2026, list/standard tier; cheaper at scale):
 *   - ElevenLabs Flash v2.5 ≈ $0.10/1k chars (credit-based, ~Pro tier)
 *   - OpenAI gpt-4o-mini-tts ≈ $0.015/1k chars
 *   - Cartesia Sonic ≈ $0.04/1k chars
 *   - Pocket TTS = $0 (self-hosted on audio-rt)
 */
export const TTS_USD_PER_1K_CHARS: Record<string, number> = {
  pocket_tts: 0,
  elevenlabs: 0.1,
  openai: 0.015,
  cartesia: 0.04,
};

/**
 * Estimate the TTS cost of synthesizing `chars` characters with `provider`.
 * Returns null for an unknown provider (so it's visibly absent rather than
 * silently counted as free).
 */
export function estimateTtsCostUsd(provider: string | null, chars: number): number | null {
  if (!provider) return null;
  const rate = TTS_USD_PER_1K_CHARS[provider];
  if (rate === undefined) return null;
  return Math.round((chars / 1000) * rate * 1e6) / 1e6;
}
