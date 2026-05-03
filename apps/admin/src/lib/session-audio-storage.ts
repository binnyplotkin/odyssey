import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const AUDIO_ROOT =
  process.env.WORLD_SESSION_AUDIO_DIR ??
  path.join(process.cwd(), ".world-session-audio");

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function extensionForMime(mimeType: string) {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("mp4")) return "m4a";
  return "bin";
}

export function makeAudioStorageKey(input: {
  sessionId: string;
  artifactId: string;
  direction: string;
  mimeType: string;
}) {
  const ext = extensionForMime(input.mimeType);
  return path.join(
    safeSegment(input.sessionId),
    `${safeSegment(input.direction)}-${safeSegment(input.artifactId)}.${ext}`,
  );
}

function resolveStoragePath(storageKey: string) {
  const normalized = path.normalize(storageKey);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error("Invalid audio storage key.");
  }
  return path.join(AUDIO_ROOT, normalized);
}

export async function writeSessionAudio(storageKey: string, bytes: Uint8Array) {
  const filePath = resolveStoragePath(storageKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
}

export async function readSessionAudio(storageKey: string) {
  return await readFile(resolveStoragePath(storageKey));
}
