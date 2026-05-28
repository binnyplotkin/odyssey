import { getOpenAIClient } from "./openai-client";

/**
 * Embedding model + dimensions used across the system. Bumping these
 * invalidates every existing wiki_pages.embedding row — handle that via
 * a migration that nulls embeddingModel/embedding and triggers backfill.
 */
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

/** Cap roughly to text-embedding-3-small's 8191-token context. We rarely
 * hit this (wiki pages are short) but truncate by character as a cheap
 * safety net so a runaway page doesn't fail the embedding call. */
const MAX_INPUT_CHARS = 24000;

/**
 * Embed a single string. Returns null if no OpenAI key is configured or
 * if the input is empty/whitespace; throws on API failure so callers can
 * decide whether to retry, persist the error, or proceed without an
 * embedding (e.g. wiki saves without one are still functional, just
 * miss out on semantic seed).
 */
export async function embedText(text: string): Promise<number[] | null> {
  const [vector] = await embedTexts([text]);
  return vector ?? null;
}

/**
 * Embed multiple strings with a single OpenAI request. The returned array
 * matches the input order; empty inputs or missing client entries become null.
 */
export async function embedTexts(texts: string[]): Promise<Array<number[] | null>> {
  const out: Array<number[] | null> = new Array(texts.length).fill(null);
  const client = getOpenAIClient();
  if (!client || texts.length === 0) return out;

  const inputs: string[] = [];
  const indexes: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    const trimmed = texts[i].trim();
    if (!trimmed) continue;
    inputs.push(
      trimmed.length > MAX_INPUT_CHARS ? trimmed.slice(0, MAX_INPUT_CHARS) : trimmed,
    );
    indexes.push(i);
  }
  if (inputs.length === 0) return out;

  const resp = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: inputs,
    encoding_format: "float",
  });

  const ordered = [...resp.data].sort((a, b) => a.index - b.index);
  for (let i = 0; i < ordered.length; i++) {
    const vector = ordered[i]?.embedding;
    if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `embedTexts: expected ${EMBEDDING_DIMENSIONS} dims, got ${vector?.length ?? 0}`,
      );
    }
    out[indexes[i]] = vector;
  }
  return out;
}
