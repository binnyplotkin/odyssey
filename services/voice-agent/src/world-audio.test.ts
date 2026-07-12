import { describe, expect, it } from "vitest";
import { GainRamp, dbToLinear, parseWavPcm16Mono } from "./world-audio";

/** Build a minimal PCM s16le WAV buffer (the ingest encoder's shape),
 * optionally with a junk chunk between fmt and data to exercise the
 * chunk scan. */
function buildWav({
  samples,
  sampleRate = 48_000,
  channels = 1,
  bitsPerSample = 16,
  junkChunk = false,
}: {
  samples: Int16Array;
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  junkChunk?: boolean;
}): Buffer {
  const dataBytes = samples.length * 2;
  const junkBytes = junkChunk ? 8 + 3 + 1 : 0; // odd-size chunk + pad byte
  const buf = Buffer.alloc(44 + junkBytes + dataBytes);
  let o = 0;
  buf.write("RIFF", o); o += 4;
  buf.writeUInt32LE(36 + junkBytes + dataBytes, o); o += 4;
  buf.write("WAVE", o); o += 4;
  buf.write("fmt ", o); o += 4;
  buf.writeUInt32LE(16, o); o += 4;
  buf.writeUInt16LE(1, o); o += 2; // PCM
  buf.writeUInt16LE(channels, o); o += 2;
  buf.writeUInt32LE(sampleRate, o); o += 4;
  buf.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), o); o += 4;
  buf.writeUInt16LE(channels * (bitsPerSample / 8), o); o += 2;
  buf.writeUInt16LE(bitsPerSample, o); o += 2;
  if (junkChunk) {
    buf.write("LIST", o); o += 4;
    buf.writeUInt32LE(3, o); o += 4; // odd size → padded to 4
    o += 4;
  }
  buf.write("data", o); o += 4;
  buf.writeUInt32LE(dataBytes, o); o += 4;
  for (const s of samples) {
    buf.writeInt16LE(s, o);
    o += 2;
  }
  return buf;
}

describe("parseWavPcm16Mono", () => {
  it("round-trips the canonical ingest output", () => {
    const samples = new Int16Array([0, 1000, -1000, 0x7fff, -0x8000]);
    const parsed = parseWavPcm16Mono(buildWav({ samples }));
    expect(parsed.sampleRate).toBe(48_000);
    expect([...parsed.samples]).toEqual([...samples]);
  });

  it("scans past extra chunks (odd-size padding) to find data", () => {
    const samples = new Int16Array([42, -42]);
    const parsed = parseWavPcm16Mono(buildWav({ samples, junkChunk: true }));
    expect([...parsed.samples]).toEqual([42, -42]);
  });

  it("rejects stereo and non-PCM", () => {
    const samples = new Int16Array([1, 2]);
    expect(() => parseWavPcm16Mono(buildWav({ samples, channels: 2 }))).toThrow(/mono/);
    expect(() => parseWavPcm16Mono(Buffer.from("not a wav at all, sorry"))).toThrow(/RIFF/);
  });
});

describe("GainRamp", () => {
  it("reaches the target in ~ms worth of samples and settles", () => {
    const ramp = new GainRamp(0);
    ramp.setTarget(1, 100, 1000); // 100ms at 1kHz = 100 steps
    let last = 0;
    for (let i = 0; i < 100; i += 1) last = ramp.next();
    expect(last).toBeLessThan(1);
    ramp.next();
    expect(ramp.value).toBe(1);
    expect(ramp.settled).toBe(true);
    // Holds after settling.
    for (let i = 0; i < 10; i += 1) expect(ramp.next()).toBe(1);
  });

  it("ramps downward without overshooting", () => {
    const ramp = new GainRamp(1);
    ramp.setTarget(0.25, 10, 1000); // 10 steps
    let min = 1;
    for (let i = 0; i < 50; i += 1) min = Math.min(min, ramp.next());
    expect(min).toBe(0.25);
    expect(ramp.value).toBe(0.25);
  });

  it("can retarget mid-ramp", () => {
    const ramp = new GainRamp(0);
    ramp.setTarget(1, 100, 1000);
    for (let i = 0; i < 50; i += 1) ramp.next();
    const mid = ramp.value;
    expect(mid).toBeGreaterThan(0.3);
    ramp.setTarget(0, 10, 1000);
    for (let i = 0; i < 20; i += 1) ramp.next();
    expect(ramp.value).toBe(0);
  });
});

describe("dbToLinear", () => {
  it("maps the reference points", () => {
    expect(dbToLinear(0)).toBe(1);
    expect(dbToLinear(-6)).toBeCloseTo(0.501, 2);
    expect(dbToLinear(-12)).toBeCloseTo(0.251, 2);
  });
});
