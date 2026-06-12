/**
 * Minimal MessagePack codec for the audio-rt streaming-STT contract,
 * ported from apps/admin/src/lib/audio-rt-streaming-stt.ts so Sonar can
 * speak the exact same wire protocol from Node. Pure — only TextEncoder/
 * TextDecoder, which are global in Node 18+.
 *
 *   client → server: { type: "Audio", pcm: Float32[1920] }   # 80ms @ 24kHz
 *   server → client: { type: "Ready" | "Step" | "Word" | "Error", ... }
 */

export type SttMessage =
  | { type: "Ready" }
  | { type: "Step"; prs?: number[]; step_idx?: number }
  | { type: "Word"; text: string; start_time: number }
  | { type: "Error"; message?: string };

const enc = new TextEncoder();
const dec = new TextDecoder();

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function encodeString(value: string): Uint8Array {
  const bytes = enc.encode(value);
  if (bytes.length <= 31) return concat([Uint8Array.of(0xa0 | bytes.length), bytes]);
  return concat([Uint8Array.of(0xd9, bytes.length), bytes]);
}

function encodeArrayHeader(length: number): Uint8Array {
  return length <= 15
    ? Uint8Array.of(0x90 | length)
    : Uint8Array.of(0xdc, (length >> 8) & 0xff, length & 0xff);
}

/** Encode one `{ type: "Audio", pcm: Float32[] }` frame (float32 BE per the contract). */
export function encodeAudioFrame(samples: Float32Array): Uint8Array {
  const sampleBytes = new Uint8Array(samples.length * 5);
  const view = new DataView(sampleBytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    view.setUint8(i * 5, 0xca);
    view.setFloat32(i * 5 + 1, samples[i], false);
  }
  return concat([
    Uint8Array.of(0x82),
    encodeString("type"),
    encodeString("Audio"),
    encodeString("pcm"),
    encodeArrayHeader(samples.length),
    sampleBytes,
  ]);
}

export function decodeMsgpack(bytes: Uint8Array): unknown {
  let offset = 0;
  const read = (): unknown => {
    const prefix = bytes[offset++];
    if (prefix <= 0x7f) return prefix;
    if ((prefix & 0xe0) === 0xa0) {
      const length = prefix & 0x1f;
      const out = dec.decode(bytes.subarray(offset, offset + length));
      offset += length;
      return out;
    }
    if ((prefix & 0xf0) === 0x90) {
      const length = prefix & 0x0f;
      return Array.from({ length }, () => read());
    }
    if ((prefix & 0xf0) === 0x80) {
      const length = prefix & 0x0f;
      const out: Record<string, unknown> = {};
      for (let i = 0; i < length; i += 1) out[String(read())] = read();
      return out;
    }
    switch (prefix) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xca: {
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
        const value = view.getFloat32(0, false);
        offset += 4;
        return value;
      }
      case 0xcb: {
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
        const value = view.getFloat64(0, false);
        offset += 8;
        return value;
      }
      case 0xcc:
        return bytes[offset++];
      case 0xcd: {
        const value = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        return value;
      }
      case 0xd9: {
        const length = bytes[offset++];
        const out = dec.decode(bytes.subarray(offset, offset + length));
        offset += length;
        return out;
      }
      case 0xda: {
        const length = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        const out = dec.decode(bytes.subarray(offset, offset + length));
        offset += length;
        return out;
      }
      case 0xdc: {
        const length = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        return Array.from({ length }, () => read());
      }
      case 0xde: {
        const length = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        const out: Record<string, unknown> = {};
        for (let i = 0; i < length; i += 1) out[String(read())] = read();
        return out;
      }
      default:
        throw new Error(`Unsupported MessagePack prefix 0x${prefix.toString(16)}.`);
    }
  };
  return read();
}
