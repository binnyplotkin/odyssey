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
  const client = getOpenAIClient();
  if (!client) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const input = trimmed.length > MAX_INPUT_CHARS ? trimmed.slice(0, MAX_INPUT_CHARS) : trimmed;
  const resp = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
    encoding_format: "float",
  });
  const vector = resp.data[0]?.embedding;
  if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `embedText: expected ${EMBEDDING_DIMENSIONS} dims, got ${vector?.length ?? 0}`,
    );
  }
  return vector;
}
