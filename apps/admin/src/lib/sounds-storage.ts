import {
  SOUND_PROCESSED_BUCKET,
  SOUND_SOURCES_BUCKET,
  getSupabaseStorageClient,
} from "./supabase-storage";

// Server-only helpers for the /sounds global library (audio_assets).
// Mirrors voices-storage.ts: two private buckets, objects addressed by
// `${asset.id}.<ext>`. The processed bucket only ever holds the canonical
// 48 kHz mono s16 WAV produced by the client-side ingest pass.

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

export function soundExtForMime(mime: string): string {
  return EXT_BY_MIME[mime.toLowerCase()] ?? "bin";
}

export async function uploadSoundSource(
  path: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await getSupabaseStorageClient()
    .storage.from(SOUND_SOURCES_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`upload(sound source) failed: ${error.message}`);
}

export async function uploadSoundProcessed(
  path: string,
  bytes: Buffer,
): Promise<void> {
  const { error } = await getSupabaseStorageClient()
    .storage.from(SOUND_PROCESSED_BUCKET)
    .upload(path, bytes, { contentType: "audio/wav", upsert: true });
  if (error) throw new Error(`upload(sound processed) failed: ${error.message}`);
}

export async function downloadSoundSourceBytes(path: string): Promise<Buffer> {
  const { data, error } = await getSupabaseStorageClient()
    .storage.from(SOUND_SOURCES_BUCKET)
    .download(path);
  if (error || !data) {
    throw new Error(`download(sound source) failed: ${error?.message ?? "unknown"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function downloadSoundProcessedBytes(path: string): Promise<Buffer> {
  const { data, error } = await getSupabaseStorageClient()
    .storage.from(SOUND_PROCESSED_BUCKET)
    .download(path);
  if (error || !data) {
    throw new Error(`download(sound processed) failed: ${error?.message ?? "unknown"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function removeSoundObjects(opts: {
  sourcePath?: string | null;
  processedPath?: string | null;
}): Promise<void> {
  const supabase = getSupabaseStorageClient();
  if (opts.sourcePath) {
    // Failures are logged but non-fatal — orphaned blobs are recoverable;
    // an orphaned row pointing at missing blobs is worse UX.
    const { error } = await supabase.storage
      .from(SOUND_SOURCES_BUCKET)
      .remove([opts.sourcePath]);
    if (error) console.warn(`[sounds] remove source failed: ${error.message}`);
  }
  if (opts.processedPath) {
    const { error } = await supabase.storage
      .from(SOUND_PROCESSED_BUCKET)
      .remove([opts.processedPath]);
    if (error) console.warn(`[sounds] remove processed failed: ${error.message}`);
  }
}
