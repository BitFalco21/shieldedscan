import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    // `server/` tests that need Postgres skip themselves without TEST_DATABASE_URL, so CI
    // stays database-free.
    include: [
      "src/**/__tests__/**/*.test.{ts,tsx}",
      "server/**/__tests__/**/*.test.ts",
      "scripts/**/__tests__/**/*.test.ts",
    ],
    // Playwright specs live in e2e/ and must not be picked up by vitest.
    exclude: ["e2e/**", "node_modules/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
