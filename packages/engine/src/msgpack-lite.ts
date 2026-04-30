function utf8Encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function utf8Decode(input: Uint8Array): string {
  return new TextDecoder().decode(input);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function encodeNumber(value: number): Uint8Array {
  if (Number.isInteger(value) && value >= 0 && value <= 0x7f) {
    return Uint8Array.of(value);
  }
  if (Number.isInteger(value) && value >= -32 && value < 0) {
    return Uint8Array.of(0xe0 | (value + 32));
  }
  if (Number.isInteger(value) && value >= 0 && value <= 0xff) {
    return Uint8Array.of(0xcc, value);
  }
  if (Number.isInteger(value) && value >= -0x80 && value <= 0x7f) {
    return Uint8Array.of(0xd0, value & 0xff);
  }
  if (Number.isInteger(value) && value >= 0 && value <= 0xffff) {
    return Uint8Array.of(0xcd, (value >> 8) & 0xff, value & 0xff);
  }
  if (Number.isInteger(value) && value >= -0x8000 && value <= 0x7fff) {
    return Uint8Array.of(0xd1, (value >> 8) & 0xff, value & 0xff);
  }
  const buffer = new ArrayBuffer(9);
  const view = new DataView(buffer);
  view.setUint8(0, 0xcb);
  view.setFloat64(1, value, false);
  return new Uint8Array(buffer);
}

function encodeString(value: string): Uint8Array {
  const bytes = utf8Encode(value);
  const length = bytes.length;
  if (length <= 31) {
    return concatBytes([Uint8Array.of(0xa0 | length), bytes]);
  }
  if (length <= 0xff) {
    return concatBytes([Uint8Array.of(0xd9, length), bytes]);
  }
  if (length <= 0xffff) {
    return concatBytes([
      Uint8Array.of(0xda, (length >> 8) & 0xff, length & 0xff),
      bytes,
    ]);
  }
  return concatBytes([
    Uint8Array.of(
      0xdb,
      (length >>> 24) & 0xff,
      (length >>> 16) & 0xff,
      (length >>> 8) & 0xff,
      length & 0xff,
    ),
    bytes,
  ]);
}

export function encode(value: unknown): Uint8Array {
  if (value === null || value === undefined) {
    return Uint8Array.of(0xc0);
  }
  if (typeof value === "boolean") {
    return Uint8Array.of(value ? 0xc3 : 0xc2);
  }
  if (typeof value === "number") {
    return encodeNumber(value);
  }
  if (typeof value === "string") {
    return encodeString(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((entry) => encode(entry));
    const length = items.length;
    let header: Uint8Array;
    if (length <= 15) {
      header = Uint8Array.of(0x90 | length);
    } else if (length <= 0xffff) {
      header = Uint8Array.of(0xdc, (length >> 8) & 0xff, length & 0xff);
    } else {
      header = Uint8Array.of(
        0xdd,
        (length >>> 24) & 0xff,
        (length >>> 16) & 0xff,
        (length >>> 8) & 0xff,
        length & 0xff,
      );
    }
    return concatBytes([header, ...items]);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    const length = entries.length;
    let header: Uint8Array;
    if (length <= 15) {
      header = Uint8Array.of(0x80 | length);
    } else if (length <= 0xffff) {
      header = Uint8Array.of(0xde, (length >> 8) & 0xff, length & 0xff);
    } else {
      header = Uint8Array.of(
        0xdf,
        (length >>> 24) & 0xff,
        (length >>> 16) & 0xff,
        (length >>> 8) & 0xff,
        length & 0xff,
      );
    }
    const chunks: Uint8Array[] = [header];
    for (const [key, entryValue] of entries) {
      chunks.push(encodeString(key));
      chunks.push(encode(entryValue));
    }
    return concatBytes(chunks);
  }
  throw new Error("Unsupported MessagePack value.");
}

export function decode(bytes: Uint8Array): unknown {
  let offset = 0;

  const read = (): unknown => {
    const prefix = bytes[offset++];
    if (prefix <= 0x7f) return prefix;
    if ((prefix & 0xe0) === 0xa0) {
      const length = prefix & 0x1f;
      const out = utf8Decode(bytes.subarray(offset, offset + length));
      offset += length;
      return out;
    }
    if ((prefix & 0xf0) === 0x90) {
      const length = prefix & 0x0f;
      const out: unknown[] = [];
      for (let i = 0; i < length; i += 1) out.push(read());
      return out;
    }
    if ((prefix & 0xf0) === 0x80) {
      const length = prefix & 0x0f;
      const out: Record<string, unknown> = {};
      for (let i = 0; i < length; i += 1) {
        const key = read();
        out[String(key)] = read();
      }
      return out;
    }
    if (prefix >= 0xe0) return prefix - 0x100;
    switch (prefix) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xcc: {
        return bytes[offset++];
      }
      case 0xcd: {
        const value = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        return value;
      }
      case 0xd0: {
        const value = (bytes[offset] << 24) >> 24;
        offset += 1;
        return value;
      }
      case 0xd1: {
        const value = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        return (value << 16) >> 16;
      }
      case 0xd9: {
        const length = bytes[offset++];
        const out = utf8Decode(bytes.subarray(offset, offset + length));
        offset += length;
        return out;
      }
      case 0xda: {
        const length = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        const out = utf8Decode(bytes.subarray(offset, offset + length));
        offset += length;
        return out;
      }
      case 0xdb: {
        const length =
          (bytes[offset] << 24) |
          (bytes[offset + 1] << 16) |
          (bytes[offset + 2] << 8) |
          bytes[offset + 3];
        offset += 4;
        const out = utf8Decode(bytes.subarray(offset, offset + length));
        offset += length;
        return out;
      }
      case 0xdc: {
        const length = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        const out: unknown[] = [];
        for (let i = 0; i < length; i += 1) out.push(read());
        return out;
      }
      case 0xde: {
        const length = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        const out: Record<string, unknown> = {};
        for (let i = 0; i < length; i += 1) {
          const key = read();
          out[String(key)] = read();
        }
        return out;
      }
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
      default:
        throw new Error(
          `Unsupported MessagePack prefix 0x${prefix.toString(16)}.`,
        );
    }
  };

  const value = read();
  if (offset !== bytes.length) {
    throw new Error("Unexpected trailing MessagePack bytes.");
  }
  return value;
}
