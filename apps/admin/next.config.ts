import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The co-located bge embedder reaches onnxruntime-node through
  // @huggingface/transformers, which use `node:` builtins (createRequire) and
  // native .node/.so binaries the Next bundler can't process. Load them from
  // node_modules at runtime instead of bundling — this fixes the webpack
  // "UnhandledSchemeError: node:module" dev build failure locally and the
  // missing-libonnxruntime.so.1 error on the bundled production build.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
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
