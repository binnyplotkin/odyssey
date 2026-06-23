import {
  VOICE_EMBEDDINGS_BUCKET,
  VOICE_SOURCES_BUCKET,
  getSupabaseStorageClient,
} from "./supabase-storage";

// Slug helpers live in a sibling client-safe module so client bundles don't
// pull in the Supabase service-role client.
export { isValidVoiceSlug, slugifyVoiceName } from "./voice-slug";

const EXT_BY_MIME: Record<string, string> = {
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
};

export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime.toLowerCase()] ?? "bin";
}

// Default lifetime of signed URLs handed to clients (preview playback,
// audio-rt voice fetches). One hour matches existing patterns in the codebase
// and keeps the URLs short enough for a /speak payload.
const DEFAULT_SIGNED_URL_TTL_S = 60 * 60;

export async function createSourceSignedUrl(
  path: string,
  ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_S,
): Promise<string> {
  const { data, error } = await getSupabaseStorageClient()
    .storage.from(VOICE_SOURCES_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`signed-url(source) failed: ${error?.message ?? "unknown"}`);
  }
  return data.signedUrl;
}

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

export async function downloadSourceBytes(path: string): Promise<Buffer> {
  const { data, error } = await getSupabaseStorageClient()
    .storage.from(VOICE_SOURCES_BUCKET)
    .download(path);
  if (error || !data) {
    throw new Error(`download(source) failed: ${error?.message ?? "unknown"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function downloadEmbeddingBytes(path: string): Promise<Buffer> {
  const { data, error } = await getSupabaseStorageClient()
    .storage.from(VOICE_EMBEDDINGS_BUCKET)
    .download(path);
  if (error || !data) {
    throw new Error(`download(embedding) failed: ${error?.message ?? "unknown"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function uploadEmbedding(
  path: string,
  bytes: Buffer,
): Promise<void> {
  const { error } = await getSupabaseStorageClient()
    .storage.from(VOICE_EMBEDDINGS_BUCKET)
    .upload(path, bytes, {
      contentType: "application/octet-stream",
      upsert: true,
    });
  if (error) throw new Error(`upload(embedding) failed: ${error.message}`);
}

export async function uploadPreview(
  path: string,
  bytes: Buffer,
  contentType: string = "audio/wav",
): Promise<void> {
  const { error } = await getSupabaseStorageClient()
    .storage.from(VOICE_EMBEDDINGS_BUCKET)
    .upload(path, bytes, {
      contentType,
      upsert: true,
    });
  if (error) throw new Error(`upload(preview) failed: ${error.message}`);
}

export async function uploadSource(
  path: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await getSupabaseStorageClient()
    .storage.from(VOICE_SOURCES_BUCKET)
    .upload(path, bytes, {
      contentType,
      upsert: true,
    });
  if (error) throw new Error(`upload(source) failed: ${error.message}`);
}

export async function removeVoiceObjects(opts: {
  sourcePath?: string | null;
  embeddingPath?: string | null;
  previewPath?: string | null;
}): Promise<void> {
  const supabase = getSupabaseStorageClient();
  const sourceKeys = [opts.sourcePath].filter((p): p is string => !!p);
  const embeddingKeys = [opts.embeddingPath, opts.previewPath].filter(
    (p): p is string => !!p,
  );
  if (sourceKeys.length) {
    // Failures here are logged but don't block the row delete — orphaned
    // blobs are recoverable; an orphaned row pointing at missing blobs is
    // worse UX.
    const { error } = await supabase.storage
      .from(VOICE_SOURCES_BUCKET)
      .remove(sourceKeys);
    if (error) console.warn(`[voices] remove source failed: ${error.message}`);
  }
  if (embeddingKeys.length) {
    const { error } = await supabase.storage
      .from(VOICE_EMBEDDINGS_BUCKET)
      .remove(embeddingKeys);
    if (error) console.warn(`[voices] remove embedding failed: ${error.message}`);
  }
}
