import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));

function webPkg(name: string) {
  return fileURLToPath(new URL(`./node_modules/${name}`, import.meta.url));
}

/** Runner dédié aux tests RED d'hydratation. Ne pas fusionner avec vitest.config.ts :
 *  mergeConfig concatènerait l'exclude `*.hydration.red.test.*` de la suite CI. */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@somafrik/help-catalog": fileURLToPath(
        new URL("../packages/help-catalog/src/index.js", import.meta.url),
      ),
      // Le fichier Mobile est hors du package web : forcer la résolution vers web/node_modules.
      "@testing-library/react": webPkg("@testing-library/react"),
      "@testing-library/dom": webPkg("@testing-library/dom"),
      vitest: webPkg("vitest"),
      react: webPkg("react"),
      "react-dom": webPkg("react-dom"),
      "react/jsx-dev-runtime": fileURLToPath(new URL("./node_modules/react/jsx-dev-runtime.js", import.meta.url)),
      "react/jsx-runtime": fileURLToPath(new URL("./node_modules/react/jsx-runtime.js", import.meta.url)),
    },
  },
  server: {
    fs: {
      allow: [workspaceRoot],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/design-system/test/setup.ts"],
    include: [
      "src/context/*.hydration.red.test.tsx",
      "../Mobile/src/context/AdminDataContext.hydration.red.test.tsx",
    ],
    css: false,
    globals: false,
    env: {
      VITE_API_URL: "http://localhost:5000",
    },
  },
});
