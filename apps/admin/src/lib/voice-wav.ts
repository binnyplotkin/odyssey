/** PCM ↔ WAV helpers. Pure functions, no IO. Shared between routes that
 * drain audio-rt's int16-LE PCM SSE stream and need to materialize a
 * playable WAV file (probe/voice for the harness, voices/[id]/extract
 * for the cached smoke-test preview).
 */

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Wrap raw int16-LE PCM in a canonical 44-byte WAV header.
 * Spec: http://soundfile.sapp.org/doc/WaveFormat/
 */
export function pcmToWav(
  pcm: Uint8Array,
  sampleRate: number,
  channels: number,
): Uint8Array {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const fileSize = 36 + dataSize; // header (44) - 8 (RIFF tag + size) = 36

  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  let offset = 0;
  const writeString = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    offset += s.length;
  };
  const writeUint32 = (n: number) => {
    view.setUint32(offset, n, true);
    offset += 4;
  };
  const writeUint16 = (n: number) => {
    view.setUint16(offset, n, true);
    offset += 2;
  };

  writeString("RIFF");
  writeUint32(fileSize);
  writeString("WAVE");
  writeString("fmt ");
  writeUint32(16); // fmt chunk size
  writeUint16(1); // PCM format
  writeUint16(channels);
  writeUint32(sampleRate);
  writeUint32(byteRate);
  writeUint16(blockAlign);
  writeUint16(bitsPerSample);
  writeString("data");
  writeUint32(dataSize);

  const out = new Uint8Array(44 + dataSize);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

/**
 * Drain an SSE response body from audio-rt's /speak endpoint into a
 * single playable WAV byte array.
 *
 * audio-rt emits `meta` (sampleRate + channels), `audio` (base64 chunks),
 * `done`, and `error` events; we accumulate the audio chunks and use
 * meta to construct the WAV header.
 */
export async function drainSpeakStreamToWav(
  body: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  let sampleRate = 24000;
  let channels = 1;
  const pcmChunks: Uint8Array[] = [];
  let upstreamError: string | null = null;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let frameEnd: number;
    while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);

      let eventName: string | null = null;
      let dataLine = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event: ")) eventName = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataLine += line.slice(6);
      }
      if (!eventName || !dataLine) continue;
      let payload: unknown;
      try {
        payload = JSON.parse(dataLine);
      } catch {
        continue;
      }

      if (eventName === "meta") {
        const m = payload as { sampleRate?: number; channels?: number };
        if (typeof m.sampleRate === "number") sampleRate = m.sampleRate;
        if (typeof m.channels === "number") channels = m.channels;
      } else if (eventName === "audio") {
        const a = payload as { chunk?: string };
        if (typeof a.chunk !== "string") continue;
        pcmChunks.push(new Uint8Array(Buffer.from(a.chunk, "base64")));
      } else if (eventName === "error") {
        const e = payload as { message?: string };
        upstreamError = e.message ?? "audio-rt returned error event";
      }
    }
  }

  if (upstreamError) throw new Error(upstreamError);
  if (pcmChunks.length === 0) throw new Error("audio-rt returned no audio chunks");

  return pcmToWav(concatBytes(pcmChunks), sampleRate, channels);
}
