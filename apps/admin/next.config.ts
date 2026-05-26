import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
