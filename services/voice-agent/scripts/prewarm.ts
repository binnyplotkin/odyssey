import { embedTextLocal, warmLocalEmbedder } from "@odyssey/engine";

// Build-time gate, run from the Dockerfile (mirrors services/voice-host/scripts/prewarm.ts).
// Two jobs:
//  1. Download the bge model into the image cache so boot never pays the HuggingFace fetch.
//  2. Prove onnxruntime-node loads + runs under this base image's glibc. If anything here
//     throws, the Docker build fails — better than a worker that registers green then can't
//     embed a single turn once A2 wires the brain.
await warmLocalEmbedder();
const vec = await embedTextLocal("voice-agent prewarm");
if (!vec || vec.length === 0) {
  throw new Error("prewarm: embedTextLocal returned no vector");
}
console.log(`prewarm OK — bge resident, embedding dim=${vec.length}`);
