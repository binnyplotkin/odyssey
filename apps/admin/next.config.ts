import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Load these from node_modules at runtime instead of bundling them:
  //  - @huggingface/transformers / onnxruntime-node: native .node/.so binaries
  //    the bundler can't process (needed for bge to load on the prod build; the
  //    deploy must also ship the linux onnxruntime binary).
  //  - ws (used by the streaming TTS adapters in @odyssey/engine/audio.ts):
  //    pulls node: builtins the dev `next dev --webpack` build rejects with
  //    UnhandledSchemeError. Externalizing it keeps ws's internals out of the
  //    bundle so the build no longer 500s.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "ws"],
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
