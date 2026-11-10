"use strict";

/**
 * MONO-T0 — fichier de test factice pour les tests de l'exécuteur de baseline.
 *
 * Utilisé UNIQUEMENT via SOMAFRIK_TEST_BASELINE_FIXTURE_FILES par
 * scripts/backend-test-baseline.test.js. Il ne se connecte à aucune base :
 * interrompre l'exécuteur pendant ce fichier ne peut laisser aucune base du
 * dépôt dans un état partiel (contrairement aux vrais tests *.pg.test.js).
 *
 * Si SOMAFRIK_TEST_BASELINE_FIXTURE_READY est fourni, le fichier y écrit un
 * témoin (node --test est en cours) puis attend d'être interrompu.
 */

const { test } = require("node:test");
const fs = require("node:fs");

test("fixture baseline : exécution sans base de données", async () => {
  const ready = process.env.SOMAFRIK_TEST_BASELINE_FIXTURE_READY;
  if (!ready) return;
  fs.writeFileSync(ready, String(process.pid));
  await new Promise((resolve) => setTimeout(resolve, 120_000));
});
