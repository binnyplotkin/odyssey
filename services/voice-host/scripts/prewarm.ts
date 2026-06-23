import { embedTextLocal, warmLocalEmbedder } from "@odyssey/engine";

// Build-time gate, run from the Dockerfile. Two jobs:
//  1. Download the bge model into the image cache so boot never pays the
//     HuggingFace fetch (the model is baked into the layer).
//  2. Prove onnxruntime-node actually loads + runs under this base image's
//     glibc (the migration's riskiest unknown). If anything here throws, the
//     Docker build fails — far better than a container that boots green and
//     then can't embed a single turn.
await warmLocalEmbedder();
const vec = await embedTextLocal("voice-host prewarm");
if (!vec || vec.length === 0) {
  throw new Error("prewarm: embedTextLocal returned no vector");
}
console.log(`prewarm OK — bge resident, embedding dim=${vec.length}`);
