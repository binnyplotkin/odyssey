import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/engine/src/**/*.test.ts",
      "packages/db/src/**/*.test.ts",
      "packages/wiki-curator/src/**/*.test.ts",
      "packages/orchestration/src/**/*.test.ts",
      "apps/admin/src/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@odyssey/types": path.resolve(__dirname, "packages/types/src"),
      "@odyssey/utils": path.resolve(__dirname, "packages/utils/src"),
      "@odyssey/db": path.resolve(__dirname, "packages/db/src"),
      "@odyssey/engine": path.resolve(__dirname, "packages/engine/src"),
      "@odyssey/wiki-curator": path.resolve(__dirname, "packages/wiki-curator/src"),
      "@odyssey/orchestration": path.resolve(__dirname, "packages/orchestration/src"),
      "@odyssey/orchestration/client": path.resolve(__dirname, "packages/orchestration/src/client.ts"),
      "@odyssey/orchestration/server": path.resolve(__dirname, "packages/orchestration/src/server.ts"),
      "@": path.resolve(__dirname, "apps/admin/src"),
    },
  },
});
