/**
 * Minimal PCM WAV reader/writer + resampler. Enough to load utterance
 * fixtures (16-bit PCM mono WAV from OpenAI TTS or a recording) into the
 * Float32 @ 24kHz frames audio-rt expects. No audio dependency.
 */

export const AUDIO_RT_SAMPLE_RATE = 24_000;
export const AUDIO_RT_FRAME_SAMPLES = 1920; // 80ms @ 24kHz

export type DecodedWav = {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
};

/** Parse a PCM WAV (8/16/24/32-bit int or 32-bit float), returning mono Float32. */
export function decodeWav(buffer: Uint8Array): DecodedWav {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const tag = (o: number) => String.fromCharCode(buffer[o], buffer[o + 1], buffer[o + 2], buffer[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a RIFF/WAVE file");

  let offset = 12;
  let fmt: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = tag(offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const body = offset + 8;
    // Streamed WAVs (e.g. OpenAI TTS) write 0xFFFFFFFF placeholders for the
    // RIFF and data sizes since length isn't known up front — clamp to the
    // bytes actually present.
    const availableBody = buffer.length - body;
    const realSize = chunkSize > availableBody ? availableBody : chunkSize;
    if (chunkId === "fmt ") {
      fmt = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (chunkId === "data") {
      dataOffset = body;
      dataLength = realSize;
      if (realSize !== chunkSize) break; // placeholder size → data runs to EOF
    }
    offset = body + realSize + (realSize % 2); // chunks are word-aligned
  }
  if (!fmt || dataOffset < 0) throw new Error("WAV missing fmt or data chunk");

  const { audioFormat, channels, sampleRate, bitsPerSample } = fmt;
  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(dataLength / (bytesPerSample * channels));
  const mono = new Float32Array(frameCount);
  const isFloat = audioFormat === 3;

  for (let i = 0; i < frameCount; i += 1) {
    let acc = 0;
    for (let ch = 0; ch < channels; ch += 1) {
      const p = dataOffset + (i * channels + ch) * bytesPerSample;
      let s: number;
      if (isFloat) {
        s = bitsPerSample === 64 ? view.getFloat64(p, true) : view.getFloat32(p, true);
      } else if (bitsPerSample === 16) {
        s = view.getInt16(p, true) / 0x8000;
      } else if (bitsPerSample === 24) {
        const b0 = buffer[p], b1 = buffer[p + 1], b2 = buffer[p + 2];
        let v = b0 | (b1 << 8) | (b2 << 16);
        if (v & 0x800000) v |= ~0xffffff; // sign-extend
        s = v / 0x800000;
      } else if (bitsPerSample === 32) {
        s = view.getInt32(p, true) / 0x80000000;
      } else if (bitsPerSample === 8) {
        s = (buffer[p] - 128) / 128;
      } else {
        throw new Error(`Unsupported bit depth ${bitsPerSample}`);
      }
      acc += s;
    }
    mono[i] = acc / channels;
  }
  return { samples: mono, sampleRate, channels: 1 };
}

/** Linear resample mono Float32 to a target rate. Good enough for VAD/STT input. */
export function resampleLinear(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const ratio = to / from;
  const outLen = Math.round(samples.length * ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const src = i / ratio;
    const lo = Math.floor(src);
    const hi = Math.min(lo + 1, samples.length - 1);
    out[i] = samples[lo] + (samples[hi] - samples[lo]) * (src - lo);
  }
  return out;
}

/** Load a WAV buffer as mono Float32 at audio-rt's 24kHz. */
export function loadUtterance24k(buffer: Uint8Array): Float32Array {
  const { samples, sampleRate } = decodeWav(buffer);
  return resampleLinear(samples, sampleRate, AUDIO_RT_SAMPLE_RATE);
}

/** Split mono Float32 into fixed-size frames, zero-padding the last one. */
export function toFrames(samples: Float32Array, frameSize = AUDIO_RT_FRAME_SAMPLES): Float32Array[] {
  const frames: Float32Array[] = [];
  for (let i = 0; i < samples.length; i += frameSize) {
    const slice = samples.subarray(i, i + frameSize);
    if (slice.length === frameSize) {
      frames.push(slice);
    } else {
      const padded = new Float32Array(frameSize);
      padded.set(slice);
      frames.push(padded);
    }
  }
  return frames;
}

/** N frames of digital silence. */
export function silenceFrames(count: number, frameSize = AUDIO_RT_FRAME_SAMPLES): Float32Array[] {
  return Array.from({ length: count }, () => new Float32Array(frameSize));
}
