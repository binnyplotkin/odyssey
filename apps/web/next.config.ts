import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@odyssey/types",
    "@odyssey/utils",
    "@odyssey/db",
    "@odyssey/auth",
    "@odyssey/engine",
    "@odyssey/ui",
  ],
  images: {
    qualities: [75, 90],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default nextConfig;
