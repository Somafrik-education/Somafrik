import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/** Runner dédié aux tests RED d'audit RBAC. Ne pas fusionner avec vitest.config.ts :
 *  mergeConfig réinjecterait l'exclude `*.audit.red.test.*` de la suite CI. */
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
      "src/pages/PermissionsPage.audit.red.test.tsx",
      "src/lib/administrationCompleteness.audit.red.test.ts",
    ],
    css: false,
    globals: false,
    env: {
      VITE_API_URL: "http://localhost:5000",
    },
  },
});
