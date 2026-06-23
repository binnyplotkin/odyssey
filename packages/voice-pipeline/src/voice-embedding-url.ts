import {
  VOICE_EMBEDDINGS_BUCKET,
  getSupabaseStorageClient,
} from "./supabase-storage";

// One hour — matches the codebase default and keeps the URL short enough for a
// Pocket /speak payload.
const DEFAULT_SIGNED_URL_TTL_S = 60 * 60;

/**
 * Sign a short-lived URL for a voice's extracted embedding (.safetensors),
 * which Pocket TTS fetches by slug. Lives here (not the admin app) so the warm
 * voice-host can resolve Pocket voices on its own.
 */
export async function createEmbeddingSignedUrl(
  path: string,
  ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_S,
): Promise<string> {
  const { data, error } = await getSupabaseStorageClient()
    .storage.from(VOICE_EMBEDDINGS_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`signed-url(embedding) failed: ${error?.message ?? "unknown"}`);
  }
  return data.signedUrl;
}
