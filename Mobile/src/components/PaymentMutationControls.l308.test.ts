/**
 * FIN-L3-08 RED-MOBILE — composant React Native réel PaymentMutationControls.
 * Pas le Web responsive : le fichier Expo/RN d'enregistrement d'encaissement.
 *
 * Cause visée : ouverture du draft → ChoiceChips « Élève » (label: name || id),
 * pas de champ de recherche, pas de carte élève sélectionné (classe/matricule).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

const cases: { id: string; title: string; run: () => void }[] = [
  {
    id: "FIN-L3-08-M-UI-SEARCH",
    title: "Enregistrer un encaissement ouvre un sélecteur Élève avec recherche",
    run() {
      const controls = read("components/PaymentMutationControls.tsx");
      assert.match(controls, /accessibilityLabel="Enregistrer un encaissement"/);
      assert.match(
        controls,
        /testID="payment-student-search"/,
        "pas de champ recherche Élève — uniquement ChoiceChips horizontaux",
      );
      const eleveAt = controls.indexOf('label="Élève"');
      const classeAt = controls.indexOf('label="Classe"');
      const searchAt = controls.indexOf('testID="payment-student-search"');
      assert.ok(eleveAt >= 0 && eleveAt < classeAt, "Élève doit précéder Classe");
      assert.ok(searchAt >= 0 && searchAt < classeAt, "la recherche Élève doit être en tête du formulaire");
    },
  },
  {
    id: "FIN-L3-08-M-UI-SELECTED",
    title: "élève choisi visible (nom + classe/matricule) et remplaçable",
    run() {
      const controls = read("components/PaymentMutationControls.tsx");
      assert.match(
        controls,
        /testID="payment-selected-student"|testID="quick-payment-selected-student"/,
        "aucun bloc élève sélectionné — le chip nom-seul ne suffit pas pour les homonymes",
      );
      const eleveBlock = controls.slice(controls.indexOf('label="Élève"'), controls.indexOf('label="Classe"'));
      assert.doesNotMatch(
        eleveBlock,
        /label:\s*item\.name\s*\|\|\s*item\.id/,
        "chips Élève encore name-only",
      );
    },
  },
  {
    id: "FIN-L3-08-M-UI-SCOPE",
    title: "le scope de recherche n'utilise jamais un leftover schoolCode en priorité",
    run() {
      const controls = read("components/PaymentMutationControls.tsx");
      assert.match(
        controls,
        /resolvePaymentStudentSearchScope/,
        "schoolScope encore calculé schoolCode || schoolPublicCode — leftover CD-2026-0001 gagne",
      );
      assert.doesNotMatch(
        controls,
        /trimField\(session\?\.user\?\.schoolCode\)\s*\|\|/,
        "schoolCode leftover encore évalué avant l'identité canonique",
      );
    },
  },
];

let failed = 0;
for (const item of cases) {
  try {
    item.run();
    console.log(`PASS ${item.id} ${item.title}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${item.id} ${item.title}`);
    console.error(error instanceof Error ? error.message : error);
  }
}
if (failed) {
  process.exitCode = 1;
  console.error(`\nRED ${failed}/${cases.length} cas FIN-L3-08 Mobile RN encore ouverts`);
} else {
  console.log(`\nGREEN ${cases.length}/${cases.length} cas FIN-L3-08 Mobile RN`);
}
