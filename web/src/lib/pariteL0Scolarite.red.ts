/**
 * Lot Scolarité L0 — écarts causaux Web (inspection du code livré).
 * Doivent échouer sur develop@193c5df3 avant correction.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(webRoot, relative), "utf8");

const cases: { id: string; title: string; run: () => void }[] = [
  {
    id: "SCO-01",
    title: "Hub Scolarité compte les classes canoniques, pas scopedClasses synthétiques",
    run() {
      const overview = read("pages/etablissement/EtablissementOverviewPage.tsx");
      assert.match(
        overview,
        /filterCanonicalClasses|countCanonicalClasses/,
        "Vue d'ensemble n'utilise pas filterCanonicalClasses / countCanonicalClasses",
      );
      assert.doesNotMatch(
        overview,
        /scopedClasses\(/,
        "Vue d'ensemble compte encore les classes via scopedClasses (synthèse CLASS-${nom} + dédup nom)",
      );
    },
  },
  {
    id: "SCO-02",
    title: "Hub affiche Scolarité et l'année scolaire active GET /v2/academic-years",
    run() {
      const overview = read("pages/etablissement/EtablissementOverviewPage.tsx");
      const layout = read("pages/etablissement/MonEtablissementLayout.tsx");
      assert.match(overview, /Scolarité/, "le hub n'affiche pas le titre Scolarité");
      assert.match(
        overview,
        /academicYearsApi/,
        "le hub ne charge pas GET /v2/academic-years via academicYearsApi",
      );
      assert.match(
        overview,
        /Aucune année scolaire active|selectCurrentAcademicYear/,
        "le hub n'a pas d'état explicite d'année scolaire absente",
      );
      assert.match(
        layout,
        /label: "Scolarité"/,
        "l'onglet Vue d'ensemble n'est pas relabelisé Scolarité",
      );
    },
  },
  {
    id: "SCO-03",
    title: "Hub : actions Classes, Élèves, Inscriptions, Année, Structure",
    run() {
      const overview = read("pages/etablissement/EtablissementOverviewPage.tsx");
      assert.match(overview, /\/etablissement\/classes/, "action Classes absente");
      assert.match(overview, /\/etablissement\/eleves/, "action Élèves absente");
      assert.match(
        overview,
        /\/parametres\/annee-scolaire/,
        "action Année scolaire absente du hub",
      );
      assert.match(
        overview,
        /\/parametres\/structure/,
        "action Structure pédagogique absente du hub",
      );
      assert.match(overview, /Inscriptions/, "action Inscriptions absente du hub");
    },
  },
  {
    id: "SCO-04",
    title: "Classes Web : statuts FR et lien structure /parametres/structure",
    run() {
      const page = read("pages/etablissement/ClassesListPage.tsx");
      assert.match(page, /\/parametres\/structure/, "création classe pointe encore hors /parametres/structure");
      assert.doesNotMatch(
        page,
        /to="\/configuration"/,
        "le modal Classes envoie encore vers /configuration",
      );
      assert.match(page, /Actif/, "filtre/cellule Classes n'expose pas le libellé Actif");
      assert.match(page, /Inactif/, "filtre/cellule Classes n'expose pas le libellé Inactif");
      assert.match(
        page,
        /Aucune classe n'est encore créée/,
        "état vide Classes trop générique",
      );
    },
  },
  {
    id: "SCO-05",
    title: "Annuaire Élèves affiche statut et année scolaire",
    run() {
      const page = read("pages/etablissement/StudentsListPage.tsx");
      assert.match(page, /academicYearName/, "colonne année scolaire absente de l'annuaire");
      assert.match(
        page,
        /displayStatusName|Statut/,
        "colonne statut d'inscription/élève absente de l'annuaire",
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
console.log(`parite L0 Scolarité Web — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`);
for (const id of passedIds) console.log(`  PASS ${id}`);
for (const item of failed) {
  console.log(`  FAIL [${item.id}] ${item.title}`);
  console.log(`    ${item.message}`);
}
console.log(
  `PARITE_SCO_L0_WEB_REPORT ${JSON.stringify({ passedIds, failedIds, expectedIds: cases.map((item) => item.id) })}`,
);
if (failed.length) process.exit(1);
console.log("OK: L0 Scolarité Web");
