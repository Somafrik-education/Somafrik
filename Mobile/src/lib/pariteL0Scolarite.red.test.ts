/**
 * Lot Scolarité L0 — écarts causaux Mobile (inspection du code livré).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

const cases: { id: string; title: string; run: () => void }[] = [
  {
    id: "SCO-01-M",
    title: "KPI Classes Accueil = GET /classes, pas un fallback unique className",
    run() {
      const home = read("screens/HomeScreen.tsx");
      assert.doesNotMatch(
        home,
        /rows\.length \|\| new Set\(visibleStudents\.map\(\(student\) => student\.className\)\)/,
        "Accueil reconstruit encore le nombre de classes depuis les noms d'élèves",
      );
      assert.match(
        home,
        /filterCanonicalClasses|countCanonicalClasses/,
        "Accueil ne compte pas les classes canoniques",
      );
    },
  },
  {
    id: "SCO-02-M",
    title: "Hub Scolarité Mobile : titre, année active, actions",
    run() {
      const hub = read("screens/SchoolingHubScreen.tsx");
      const navigator = read("navigation/AppNavigator.tsx");
      const drawer = read("navigation/roleDrawerPreferences.ts");
      assert.match(hub, /Scolarité/, "SchoolingHubScreen n'affiche pas Scolarité");
      assert.match(
        hub,
        /listAcademicYears|\/v2\/academic-years/,
        "le hub Mobile ne charge pas GET /v2/academic-years",
      );
      assert.match(hub, /Aucune année scolaire active/, "état année absente manquant");
      assert.match(navigator, /name="Schooling"/, "route Schooling absente du graphe");
      assert.match(drawer, /label: "Scolarité"/, "entrée drawer Scolarité absente");
    },
  },
  {
    id: "SCO-04-M",
    title: "Liste Classes Mobile n'affiche pas les classes synthétiques CLASS-",
    run() {
      const screen = read("screens/ClassesScreen.tsx");
      assert.match(
        screen,
        /filterCanonicalClasses/,
        "ClassesScreen laisse encore scopedClassesForSession injecter CLASS-${nom}",
      );
      assert.match(
        screen,
        /Aucune classe n'est encore créée|SCOLARITE_EMPTY_CLASSES/,
        "état vide Classes Mobile trop générique",
      );
    },
  },
  {
    id: "SCO-05-M",
    title: "Liste Élèves Mobile expose classe et statut métier",
    run() {
      const screen = read("screens/StudentsScreen.tsx");
      assert.match(
        screen,
        /displayStatusName|student\.status/,
        "StudentsScreen n'affiche pas le statut élève/inscription",
      );
      assert.match(
        screen,
        /Aucun élève inscrit/,
        "état vide Élèves Mobile trop générique ou anglophone",
      );
    },
  },
];

const failed: { id: string; title: string; message: string }[] = [];
const passedIds: string[] = [];
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

const failedIds = failed.map((item) => item.id);
console.log(`parite L0 Scolarité Mobile — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`);
for (const id of passedIds) console.log(`  PASS ${id}`);
for (const item of failed) {
  console.log(`  FAIL [${item.id}] ${item.title}`);
  console.log(`    ${item.message}`);
}
console.log(
  `PARITE_SCO_L0_MOBILE_REPORT ${JSON.stringify({ passedIds, failedIds, expectedIds: cases.map((item) => item.id) })}`,
);
if (failed.length) process.exit(1);
console.log("OK: L0 Scolarité Mobile");
