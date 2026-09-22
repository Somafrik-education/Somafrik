/**
 * Lot 0 — écarts encore ROUGES (collections hors îlots Finance / Scolarité / Communication).
 *   npx --yes tsx src/lib/progressiveDisclosure.red.test.ts
 *
 * Contrat clos : plus aucun identifiant PD rouge. PD-01 à PD-07 sont GREEN.
 */
import assert from "node:assert/strict";
import { PD_RED_EXPECTED_IDS } from "./progressiveDisclosureUxContract";

type RedCase = { id: string; title: string; run: () => void };

const cases: RedCase[] = [];

const failed: { id: string; title: string; message: string }[] = [];
const passedIds: string[] = [];

assert.deepEqual(
  cases.map((item) => item.id),
  [...PD_RED_EXPECTED_IDS],
  "identifiants RED ≠ PD_RED_EXPECTED_IDS",
);

for (const testCase of cases) {
  try {
    testCase.run();
    passedIds.push(testCase.id);
  } catch (error) {
    failed.push({
      id: testCase.id,
      title: testCase.title,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const report = {
  lot: "PD",
  expectedIds: [...PD_RED_EXPECTED_IDS],
  failedIds: failed.map((item) => item.id),
  passedIds,
};

console.log(`progressive disclosure — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`);
for (const id of passedIds) console.log(`  PASS ${id}`);
for (const item of failed) {
  console.error(`  FAIL [${item.id}] ${item.title}\n    ${item.message}`);
}
console.log(`PARITE_RED_REPORT ${JSON.stringify(report)}`);

if (failed.length) process.exit(1);
console.log("OK: tous les écarts progressive disclosure sont clos");
