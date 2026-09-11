/**
 * Lot 0 — écarts encore ROUGES (collections hors îlots Finance / Scolarité / Communication).
 *   npx --yes tsx src/lib/progressiveDisclosure.red.test.ts
 *
 * Exit 1 tant que PD-02, PD-03, PD-04, PD-06, PD-07 échouent. PD-01 et PD-05 sont GREEN.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PD_EVALUATION_SECONDARY_ACTIONS, PD_RED_EXPECTED_IDS } from "./progressiveDisclosureUxContract";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

type RedCase = { id: string; title: string; run: () => void };

function sliceFirstCard(source: string, tag: string) {
  const start = source.indexOf(`<${tag}`);
  const end = source.indexOf(`</${tag}>`, start);
  if (start < 0 || end < 0) return "";
  return source.slice(start, end);
}

function cardOpening(card: string) {
  const split = card.indexOf(">");
  return split < 0 ? card : card.slice(0, split);
}

const cases: RedCase[] = [
  {
    id: "PD-02",
    title: "Évaluations : résumé sans Modifier/Valider/Publier ; Saisir peut rester visible",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.match(
        screen,
        /ExpandableEntityCard|ExpandableFinanceCard/,
        "la liste évaluations n'utilise pas encore la carte dépliable",
      );
      const card = sliceFirstCard(screen, "ExpandableEntityCard") || sliceFirstCard(screen, "ExpandableFinanceCard");
      const opening = cardOpening(card);
      for (const action of PD_EVALUATION_SECONDARY_ACTIONS) {
        assert.equal(
          opening.includes(action),
          false,
          `${action} est encore dans le résumé fermé`,
        );
      }
    },
  },
  {
    id: "PD-03",
    title: "Appel : méta arrivée/motif masquée ; les 4 statuts restent visibles",
    run() {
      const screen = read("screens/TeacherAttendanceScreen.tsx");
      const itemStart = screen.indexOf("renderItem={({ item: student })");
      const roster = itemStart >= 0 ? screen.slice(itemStart) : screen;
      assert.match(roster, /ATTENDANCE_ACTIONS\.map/, "les 4 statuts d'appel ne doivent pas disparaître");
      const identityStart = roster.indexOf("studentIdentity");
      const actionsStart = roster.indexOf("statusActions");
      const identity = identityStart >= 0 && actionsStart > identityStart
        ? roster.slice(identityStart, actionsStart)
        : roster;
      assert.doesNotMatch(
        identity,
        /entry\.arrivalTime/,
        "l'heure d'arrivée reste exposée dans l'identité par défaut",
      );
      assert.doesNotMatch(
        identity,
        /entry\.reason/,
        "le motif reste exposé dans l'identité par défaut",
      );
    },
  },
  {
    id: "PD-04",
    title: "Utilisateurs : carte Entity, mutations uniquement en zone ouverte",
    run() {
      const screen = read("screens/UsersScreen.tsx");
      assert.match(screen, /ExpandableEntityCard/, "la liste utilisateurs n'utilise pas encore ExpandableEntityCard");
      const card = sliceFirstCard(screen, "ExpandableEntityCard");
      const opening = cardOpening(card);
      assert.doesNotMatch(opening, /UserMutationControls/, "mutations encore dans le résumé");
      assert.match(card, /<UserMutationControls[\s\S]*row=\{user\}/, "mutations absentes de la zone ouverte");
    },
  },
  {
    id: "PD-06",
    title: "Bulletins : métriques et PDF uniquement en zone ouverte",
    run() {
      const screen = read("screens/ReportCardsScreen.tsx");
      assert.match(
        screen,
        /ExpandableEntityCard|ExpandableFinanceCard/,
        "la liste bulletins n'utilise pas encore la carte dépliable",
      );
      const card = sliceFirstCard(screen, "ExpandableEntityCard") || sliceFirstCard(screen, "ExpandableFinanceCard");
      const opening = cardOpening(card);
      assert.doesNotMatch(opening, /Visionner le bulletin/, "le CTA PDF est encore dans le résumé");
    },
  },
  {
    id: "PD-07",
    title: "EDT : enseignant/salle/remplacer hors résumé fermé",
    run() {
      const screen = read("screens/TimetableScreen.tsx");
      assert.match(
        screen,
        /ExpandableEntityCard|ExpandableFinanceCard/,
        "les créneaux n'utilisent pas encore la carte dépliable",
      );
    },
  },
];

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
