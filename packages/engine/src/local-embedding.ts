import type { FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Co-located embedder (Move 01) — bge-small-en-v1.5 run in-process via
 * transformers.js / onnxruntime, replacing the per-turn OpenAI embedding
 * round-trip (~400ms warm / ~3800ms cold) with a ~60ms local embed.
 *
 * This is ADDITIVE: the OpenAI path in ./embedding.ts is untouched and stays
 * the default. These functions feed the backfill + the eventual retrieval
 * cutover (gated by a 384-dim column + EMBEDDING_PROVIDER), so nothing here
 * changes live behavior until that migration lands.
 *
 * Prototype-validated on Abraham's graph: recall@5 56.1% vs OpenAI 58.9%.
 */
export const LOCAL_EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
export const LOCAL_EMBEDDING_DIMENSIONS = 384;

/**
 * bge wants an instruction prefix on the QUERY side only (not on the indexed
 * passages). Skipping it on queries quietly degrades recall.
 */
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

/**
 * bge-small's context window is ~512 tokens (vs OpenAI's 8191). transformers.js
 * truncates to the model max, but we cap chars cheaply so a runaway page can't
 * blow up tokenization. Long pages lose their tail under bge — fine for short
 * wiki pages, worth revisiting if pages grow.
 */
const MAX_INPUT_CHARS = 2000;

// Lazy singleton: the heavy transformers.js + onnxruntime load happens on the
// FIRST embed, not when @odyssey/engine is imported — so routes that only use
// the OpenAI path or audio never pay for it.
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      return pipeline("feature-extraction", LOCAL_EMBEDDING_MODEL);
    })();
  }
  return extractorPromise;
}

/** Pre-load the model (e.g. at server warmup) so the first real embed is hot. */
export async function warmLocalEmbedder(): Promise<void> {
  await getExtractor();
}

/**
 * Embed a single string locally. Pass `isQuery: true` for the user's query so
 * the bge instruction prefix is applied; omit it for indexed page text.
 * Returns a normalized 384-dim vector, or null for empty input.
 */
export async function embedTextLocal(
  text: string,
  opts?: { isQuery?: boolean },
): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const capped = trimmed.length > MAX_INPUT_CHARS ? trimmed.slice(0, MAX_INPUT_CHARS) : trimmed;
  const extractor = await getExtractor();
  const input = opts?.isQuery ? QUERY_PREFIX + capped : capped;
  const out = await extractor(input, { pooling: "cls", normalize: true });
  const vector = Array.from(out.data as Float32Array);
  if (vector.length !== LOCAL_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `embedTextLocal: expected ${LOCAL_EMBEDDING_DIMENSIONS} dims, got ${vector.length}`,
    );
  }
  return vector;
}

/**
 * Embed many strings locally (sequential — bge is CLS-pooled and fast per
 * item; the backfill embeds ~95 short pages in a few seconds). Output order
 * matches input; empty inputs become null.
 */
export async function embedTextsLocal(
  texts: string[],
  opts?: { isQuery?: boolean },
): Promise<Array<number[] | null>> {
  const out: Array<number[] | null> = [];
  for (const text of texts) {
    out.push(await embedTextLocal(text, opts));
  }
  return out;
}
