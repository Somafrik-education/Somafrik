import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@somafrik/help-catalog": fileURLToPath(
        new URL("../packages/help-catalog/src/index.js", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/design-system/test/setup.ts"],
    include: [
      "src/design-system/**/*.{test,spec}.{ts,tsx}",
      // Pages migrées D2.3+ (tests de structure / non-régression UI)
      "src/pages/**/*.{test,spec}.{ts,tsx}",
      "src/components/**/*.{test,spec}.{ts,tsx}",
      "src/context/**/*.{test,spec}.{ts,tsx}",
      // HOTFIX-SYNC-01 — outbox / merge non destructif
      "src/lib/**/*.{test,spec}.{ts,tsx}",
      "src/data/**/*.{test,spec}.{ts,tsx}",
      "src/help/**/*.{test,spec}.{ts,tsx}",
    ],
    css: false,
    globals: false,
    env: {
      VITE_API_URL: "http://localhost:5000",
    },
  },
});
