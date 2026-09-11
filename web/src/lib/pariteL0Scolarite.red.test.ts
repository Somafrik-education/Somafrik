/**
 * Lot Scolarité L0 — écarts causaux Web (inspection du code livré).
 * Doivent échouer sur develop@193c5df3 avant correction.
 * Fichier .red.test.ts : exclu du scanner UI French Copy (SKIP_RE) et exécuté par Vitest.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(webRoot, relative), "utf8");

const cases: { id: string; title: string; run: () => void }[] = [
  {
    id: "SCO-01",
    title: "Écran Scolarité compte les classes canoniques, pas scopedClasses synthétiques",
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
    title: "Écran Scolarité affiche le titre et l'année scolaire active GET /v2/academic-years",
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
    title: "Écran Scolarité : actions Classes, Élèves, Inscriptions, Année, Structure",
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

describe("parite L0 Scolarité Web", () => {
  for (const testCase of cases) {
    it(`${testCase.id} — ${testCase.title}`, () => {
      testCase.run();
    });
  }
});
