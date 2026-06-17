import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Load these from node_modules at runtime instead of bundling them:
  //  - @huggingface/transformers / onnxruntime-node: native .node/.so binaries
  //    the bundler can't process (bge runs on a long-running host, not here).
  //  - ws (streaming TTS adapters in @odyssey/engine/audio.ts): its node:
  //    builtins break the dev webpack bundle; audio.ts loads it via a runtime
  //    createRequire instead.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "ws"],
  // audio.ts loads `ws` via a runtime createRequire, which Vercel's file tracer
  // can't follow — so the serverless function omits it ("Cannot find module
  // 'ws'"). Force it into the voice-stream function bundle. ws is hoisted to the
  // monorepo-root node_modules (../../ from this app); the second glob covers a
  // non-hoisted layout.
  outputFileTracingIncludes: {
    "/api/characters/**": ["../../node_modules/ws/**/*", "./node_modules/ws/**/*"],
  },
  experimental: {
    externalDir: true,
  },
  transpilePackages: [
    "@odyssey/types",
    "@odyssey/utils",
    "@odyssey/db",
    "@odyssey/auth",
    "@odyssey/ui",
  ],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default nextConfig;
