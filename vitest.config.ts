import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/engine/src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@odyssey/types": path.resolve(__dirname, "packages/types/src"),
      "@odyssey/utils": path.resolve(__dirname, "packages/utils/src"),
      "@odyssey/db": path.resolve(__dirname, "packages/db/src"),
      "@odyssey/engine": path.resolve(__dirname, "packages/engine/src"),
    },
  },
});
