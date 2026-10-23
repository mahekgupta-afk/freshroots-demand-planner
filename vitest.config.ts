import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // In-memory Postgres (WASM) is slow to boot when several test files start at once.
  test: { include: ["tests/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 60_000 },
});
