/**
 * Client-side audio ingest for the /sounds library.
 *
 * The canonical processed format is 48 kHz mono s16 WAV — chosen so the
 * Phase-2 WorldAudioChannel (voice-agent) can read frames with zero
 * decode work. The transcode runs in the browser (Web Audio) rather than
 * server-side ffmpeg: admin deploys to Vercel serverless where native
 * binaries are a liability, while `decodeAudioData` handles mp3/wav/ogg/
 * m4a natively and `OfflineAudioContext` resamples for free.
 *
 * Normalization is RMS-based (target −20 dBFS) with a −1 dBFS peak
 * ceiling: beds sit at a consistent perceived level without clipping
 * one-shots. Proper LUFS (BS.1770) is deferred.
 */

export const INGEST_SAMPLE_RATE = 48_000;
const TARGET_RMS_DB = -20;
const PEAK_CEILING_DB = -1;

export type IngestResult = {
  /** Canonical 48 kHz mono s16le WAV, ready to upload. */
  processedWavBytes: Uint8Array;
  durationS: number;
  sampleRate: number;
  /** Post-normalization loudness metrics (dBFS). */
  rmsDb: number;
  peakDb: number;
};

export async function ingestAudioBytes(
  input: ArrayBuffer,
): Promise<IngestResult> {
  // decodeAudioData detaches the buffer it's given — copy so callers can
  // keep using theirs (e.g. to upload the original alongside).
  const decoded = await decode(input.slice(0));

  // Render to mono 48k. OfflineAudioContext resamples; explicit mono
  // channel count downmixes per the Web Audio spec.
  const frames = Math.max(
    1,
    Math.ceil(decoded.duration * INGEST_SAMPLE_RATE),
  );
  const offline = new OfflineAudioContext(1, frames, INGEST_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);

  applyNormalization(samples);

  const { rmsDb, peakDb } = measure(samples);
  return {
    processedWavBytes: encodeWavS16(samples, INGEST_SAMPLE_RATE),
    durationS: rendered.duration,
    sampleRate: INGEST_SAMPLE_RATE,
    rmsDb,
    peakDb,
  };
}

export async function ingestAudioFile(file: Blob): Promise<IngestResult> {
  return ingestAudioBytes(await file.arrayBuffer());
}

async function decode(buffer: ArrayBuffer): Promise<AudioBuffer> {
  // A throwaway AudioContext purely for decoding. Safari requires the
  // callback form in older versions; the promise form is fine for the
  // browsers admin targets.
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(buffer);
  } finally {
    void ctx.close();
  }
}

/** Gain the buffer toward TARGET_RMS_DB, capped so peaks stay under
 * PEAK_CEILING_DB. Mutates in place. Silent buffers pass through. */
function applyNormalization(samples: Float32Array): void {
  const { rms, peak } = measureLinear(samples);
  if (rms <= 0 || peak <= 0) return;

  const targetRms = dbToLinear(TARGET_RMS_DB);
  const peakCeiling = dbToLinear(PEAK_CEILING_DB);
  const gain = Math.min(targetRms / rms, peakCeiling / peak);
  if (!Number.isFinite(gain) || gain === 1) return;
  for (let i = 0; i < samples.length; i += 1) samples[i] *= gain;
}

function measureLinear(samples: Float32Array): { rms: number; peak: number } {
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i];
    sumSq += v * v;
    const abs = Math.abs(v);
    if (abs > peak) peak = abs;
  }
  return { rms: Math.sqrt(sumSq / Math.max(1, samples.length)), peak };
}

function measure(samples: Float32Array): { rmsDb: number; peakDb: number } {
  const { rms, peak } = measureLinear(samples);
  return { rmsDb: linearToDb(rms), peakDb: linearToDb(peak) };
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

function linearToDb(linear: number): number {
  return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
}

/** Minimal RIFF/WAVE encoder: PCM s16le, mono. */
function encodeWavS16(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono s16)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(
      offset,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true,
    );
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
