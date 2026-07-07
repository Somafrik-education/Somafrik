import { defineConfig } from "vitest/config";

// Tests de logique pure (planning, formatage). Environnement Node : aucune
// dépendance React Native n'est importée par les modules sous test.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
