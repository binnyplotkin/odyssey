import { warmLocalEmbedder } from "@odyssey/engine";

/**
 * Next.js runs register() once at server startup. We use it to pre-load the
 * co-located bge-small embedder so the FIRST retrieval turn per process doesn't
 * pay the lazy model load — otherwise turn 1 shows a ~1200ms+ cold
 * server.retrieval.embed spike (vs ~100ms warm) on every boot/deploy.
 *
 * transformers.js / onnxruntime is node-only, so guard to the Node runtime —
 * the Edge/middleware runtime would crash trying to load it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Only the bge path uses the co-located embedder; skip the warm when this
  // environment runs the OpenAI provider (EMBEDDING_PROVIDER=openai).
  if (process.env.EMBEDDING_PROVIDER === "openai") return;
  try {
    await warmLocalEmbedder();
  } catch (err) {
    // onnxruntime's native lib may be unloadable in this runtime (e.g. a
    // bundled/serverless target). Don't crash server boot — retrieval falls
    // back to OpenAI per-turn (see the voice-stream route).
    console.warn(
      "[instrumentation] bge warmup failed; retrieval will fall back to OpenAI",
      err,
    );
  }
}
