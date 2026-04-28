// PCM capture worklet — downsamples mic audio to 24 kHz Float32 frames
// for streaming to Kyutai's moshi-server WebSocket.
//
// Loaded via AudioContext.audioWorklet.addModule('/audio-worklet/pcm-capture-worklet.js').
// Posts: { type: 'frame', samples: Float32Array(1920) }   — every ~80 ms.
// Posts: { type: 'level', rms: number }                   — same cadence, for UI meter.

const TARGET_SAMPLE_RATE = 24000;
const FRAME_SIZE = 1920; // 80 ms at 24 kHz, matches Kyutai mimi frame_size.

class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.contextRate = sampleRate; // global in AudioWorkletGlobalScope
    this.ratio = this.contextRate / TARGET_SAMPLE_RATE;
    this.inputBuffer = []; // raw context-rate samples awaiting resample
    this.frameBuffer = new Float32Array(FRAME_SIZE);
    this.frameOffset = 0;
    this.resampleCursor = 0; // fractional position into inputBuffer
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }
    const channel = input[0];
    if (!channel || channel.length === 0) {
      return true;
    }

    for (let i = 0; i < channel.length; i += 1) {
      this.inputBuffer.push(channel[i]);
    }

    // Linear-interpolation resample at fixed ratio.
    while (this.resampleCursor + 1 < this.inputBuffer.length) {
      const lo = Math.floor(this.resampleCursor);
      const frac = this.resampleCursor - lo;
      const sample =
        this.inputBuffer[lo] * (1 - frac) + this.inputBuffer[lo + 1] * frac;

      this.frameBuffer[this.frameOffset] = sample;
      this.frameOffset += 1;
      this.resampleCursor += this.ratio;

      if (this.frameOffset >= FRAME_SIZE) {
        // Emit a complete 80 ms frame.
        let sumSquares = 0;
        for (let j = 0; j < FRAME_SIZE; j += 1) {
          sumSquares += this.frameBuffer[j] * this.frameBuffer[j];
        }
        const rms = Math.sqrt(sumSquares / FRAME_SIZE);

        // Transfer a copy so the worklet can reuse frameBuffer.
        const copy = new Float32Array(FRAME_SIZE);
        copy.set(this.frameBuffer);
        this.port.postMessage({ type: 'frame', samples: copy }, [copy.buffer]);
        this.port.postMessage({ type: 'level', rms });

        this.frameOffset = 0;
      }
    }

    // Trim already-consumed prefix from inputBuffer.
    const consumed = Math.floor(this.resampleCursor);
    if (consumed > 0) {
      this.inputBuffer.splice(0, consumed);
      this.resampleCursor -= consumed;
    }

    return true;
  }
}

registerProcessor('pcm-capture-processor', PCMCaptureProcessor);
