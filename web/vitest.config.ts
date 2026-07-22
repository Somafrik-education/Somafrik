import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/design-system/test/setup.ts"],
    include: ["src/design-system/**/*.{test,spec}.{ts,tsx}"],
    css: false,
    globals: false,
  },
});
