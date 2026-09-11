/**
 * Lot Pédagogie L3 — écarts causaux Web (inspection du code livré + contrats).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PEDAGOGY_COPY } from "./pedagogyParityContract";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(webRoot, relative), "utf8");

const cases: { id: string; title: string; run: () => void }[] = [
  {
    id: "PED-L3-01",
    title: "Ligne évaluation Web : CTA Saisir les notes",
    run() {
      const page = read("pages/GradesEvaluationsPage.tsx");
      assert.match(
        page,
        /Saisir les notes/,
        "la liste Évaluations n'offre pas le CTA Saisir les notes (il faut changer d'onglet à la main)",
      );
      assert.match(page, /PEDAGOGY_COPY|enterGrades/, "le CTA doit réutiliser le contrat de vocabulaire");
    },
  },
  {
    id: "PED-L3-02",
    title: "Création Web envoie classId canonique",
    run() {
      const modal = read("components/grades/EvaluationFormModal.tsx");
      assert.match(
        modal,
        /classId/,
        "EvaluationFormModal n'attache pas classId : le roster Mobile (UUID) peut rester vide pour la même évaluation PG",
      );
      assert.match(
        modal,
        /resolveCanonicalClassId/,
        "la résolution className → classId n'est pas branchée sur le formulaire",
      );
    },
  },
  {
    id: "PED-L3-03",
    title: "Saisie Web : Enregistrer les notes",
    run() {
      const grid = read("components/grades/GradeEntryGrid.tsx");
      assert.match(
        grid,
        /Enregistrer les notes/,
        "GradeEntryGrid utilise encore un libellé distinct de Mobile (Enregistrer tout)",
      );
      assert.equal(/Enregistrer tout/.test(grid), false, "libellé Enregistrer tout encore présent");
    },
  },
  {
    id: "PED-L3-04",
    title: "Liste Web : date, enseignant, progression",
    run() {
      const page = read("pages/GradesEvaluationsPage.tsx");
      assert.match(page, /header: "Date"|header: \{PEDAGOGY_COPY\.date\}/, "colonne Date absente de la table Évaluations");
      assert.match(
        page,
        /header: "Enseignant"|header: \{PEDAGOGY_COPY\.teacher\}/,
        "colonne Enseignant absente de la table Évaluations",
      );
      assert.match(
        page,
        /header: "Saisie"|progression|entered\s*\/\s*total/,
        "progression de saisie absente de la table Évaluations",
      );
    },
  },
  {
    id: "PED-L3-05",
    title: "Roster saisie Web : classId ou className",
    run() {
      const grid = read("components/grades/GradeEntryGrid.tsx");
      assert.match(
        grid,
        /classId/,
        "GradeEntryGrid filtre encore uniquement par className : un élève UUID d'une autre homonymie peut entrer, ou le roster canonique être raté",
      );
    },
  },
  {
    id: "PED-L3-06",
    title: "Vocabulaire Web aligné sur le contrat L3",
    run() {
      const page = read("pages/GradesEvaluationsPage.tsx");
      assert.match(page, new RegExp(PEDAGOGY_COPY.newEvaluation));
      assert.match(page, new RegExp(PEDAGOGY_COPY.validate));
      assert.match(page, new RegExp(PEDAGOGY_COPY.publish));
      assert.match(page, /from ["'].*pedagogyParityContract["']/);
    },
  },
  {
    id: "PED-L3-07",
    title: "Moyenne générale Web parent = moteur canonique à deux niveaux",
    run() {
      const panel = read("components/grades/ParentChildGradesPanel.tsx");
      assert.match(
        panel,
        /GradeBookService/,
        "Web parent calcule encore une moyenne plate au lieu de réutiliser le moteur canonique GradeBookService",
      );
      assert.match(
        panel,
        /coursesFromGradeCoefficients|grade\.coefficient/,
        "Web parent doit prendre le coefficient du cours porté par /api/notes, pas /api/courses",
      );
      assert.equal(
        /scopedCourses/.test(panel),
        false,
        "Web parent ne doit plus dépendre du catalogue cours pour la moyenne générale",
      );
      assert.equal(
        /listCourses|\/api\/courses/.test(panel),
        false,
        "Web parent ne doit pas appeler /api/courses pour calculer la moyenne",
      );
      assert.match(
        panel,
        /getStudentAverageValue/,
        "Web parent n'utilise pas la moyenne générale canonique à deux niveaux",
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
console.log(`parite L3 Pédagogie Web — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`);
for (const id of passedIds) console.log(`  PASS ${id}`);
for (const item of failed) {
  console.log(`  FAIL [${item.id}] ${item.title}`);
  console.log(`    ${item.message}`);
}
console.log(
  `PARITE_L3_PEDAGOGY_WEB_REPORT ${JSON.stringify({ passedIds, failedIds, expectedIds: cases.map((item) => item.id) })}`,
);
if (failed.length) process.exit(1);
console.log("OK: L3 Pédagogie Web");
