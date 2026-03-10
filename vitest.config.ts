import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": "/Users/joshsassoon/Documents/pandoras-box/src",
    },
  },
});
