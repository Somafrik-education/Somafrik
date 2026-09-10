/**
 * Lot Pédagogie L3 — écarts causaux Mobile + parité des notes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PEDAGOGY_COPY, PEDAGOGY_MIN_TOUCH_DP } from "./pedagogyParityContract";
import {
  canonicalWeightedAverage,
  EVALUATIONS_V2_COPY,
  normalizeEvaluation,
  normalizeGrade,
  rosterStudentsForEvaluation,
} from "./evaluationsV2";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

const cases: { id: string; title: string; run: () => void }[] = [
  {
    id: "PED-L3-10",
    title: "CTA créer Mobile = Nouvelle évaluation",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.match(screen, /PEDAGOGY_COPY\.newEvaluation|Nouvelle évaluation/);
      assert.equal(
        /Créer une évaluation/.test(screen),
        false,
        "le CTA liste utilise encore « Créer une évaluation » au lieu de « Nouvelle évaluation »",
      );
    },
  },
  {
    id: "PED-L3-11",
    title: "Création Mobile : champ Coefficient envoyé à l'API",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.match(screen, /Coefficient/, "aucun champ Coefficient sur le formulaire de création");
      assert.match(
        screen,
        /coefficient:/,
        "buildCreateEvaluationPayload n'est pas appelé avec le coefficient saisi (reste 1 silencieux)",
      );
    },
  },
  {
    id: "PED-L3-12",
    title: "Carte évaluation Mobile : coef, enseignant, date, progression",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.match(screen, /coefficient|Coef/, "coefficient absent des cartes liste");
      assert.match(screen, /teacherName/, "enseignant absent des cartes liste");
      assert.match(screen, /\/\s*|note/, "progression de saisie absente ou non affichée en N/M");
    },
  },
  {
    id: "PED-L3-13",
    title: "Filtres Mobile période et statut",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.match(screen, /periodFilter|statusFilter/, "aucun filtre période/statut sur la liste enseignant");
      assert.match(screen, /À valider|pendingValidation|allStatuses/);
    },
  },
  {
    id: "PED-L3-14",
    title: "Liste Mobile hydrate GET /notes pour la progression",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.match(
        screen,
        /loadNotes/,
        "useFocusEffect ne charge pas les notes : le compteur de saisie reste périmé ou à 0",
      );
    },
  },
  {
    id: "PED-L3-15",
    title: "Roster Mobile : repli className si classId absent",
    run() {
      const roster = rosterStudentsForEvaluation(
        [
          { id: "s1", name: "Ada", className: "6ème A" },
          { id: "s2", name: "Eve", className: "6ème B" },
        ],
        {
          classId: "",
          classCode: "",
          className: "6ème A",
        },
      );
      assert.deepEqual(
        roster.map((row) => row.id),
        ["s1"],
        "un élève de la classe nommée 6ème A est exclu si l'évaluation n'a que className (création Web)",
      );
    },
  },
  {
    id: "PED-L3-16",
    title: "Sous-titre enseignant n'interdit pas la saisie avant validation",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.equal(
        /après validation/.test(screen),
        false,
        "le sous-titre enseignant affirme encore que la saisie n'est possible qu'après validation (contredit draft/open/locked)",
      );
    },
  },
  {
    id: "PED-L3-17",
    title: "Mobile : Modifier et Publier selon RBAC métier",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.match(screen, /Modifier/, "CTA Modifier absent");
      assert.match(screen, /Publier/, "CTA Publier absent alors que PATCH status Publiée existe");
    },
  },
  {
    id: "PED-L3-18",
    title: "Libellé Valider identique au Web",
    run() {
      assert.equal(EVALUATIONS_V2_COPY.validate, PEDAGOGY_COPY.validate);
      assert.equal(EVALUATIONS_V2_COPY.enterGrades, PEDAGOGY_COPY.enterGrades);
      assert.equal(EVALUATIONS_V2_COPY.saveGrades, PEDAGOGY_COPY.saveGrades);
    },
  },
  {
    id: "PED-L3-20",
    title: "Moyenne : coefficient matière ≠ coefficient d'évaluation",
    run() {
      const note = normalizeGrade({
        evaluationId: "EVAL-1",
        studentId: "s1",
        value: 10,
        scale: 20,
        coefficient: 4,
        gradeStatus: "graded",
      });
      const avg = canonicalWeightedAverage([note]);
      assert.equal(note.evaluationCoefficient, 1, "sans evaluationCoefficient API, ne pas voler le coef matière");
      assert.equal(avg.totalCoefficients, 1);
      assert.equal(avg.average, 10);

      const weighted = canonicalWeightedAverage([
        normalizeGrade({
          evaluationId: "EVAL-1",
          studentId: "s1",
          value: 10,
          scale: 20,
          coefficient: 4,
          evaluationCoefficient: 3,
          gradeStatus: "graded",
        }),
      ]);
      assert.equal(weighted.totalCoefficients, 3);
    },
  },
  {
    id: "PED-L3-21",
    title: "Même payload API → mêmes identifiants canoniques",
    run() {
      const raw = {
        id: "EVAL-PG-1",
        classId: "class-uuid",
        className: "6ème A",
        subject: "Mathématiques",
        teacherId: "ENS-1",
        teacherName: "Seke",
        date: "2026-09-10",
        coefficient: 2,
        scale: 20,
        period: "Trimestre 1",
        status: "open",
      };
      const evaluation = normalizeEvaluation(raw);
      assert.equal(evaluation.evaluationId, "EVAL-PG-1");
      assert.equal(evaluation.classId, "class-uuid");
      assert.equal(evaluation.className, "6ème A");
      assert.equal(evaluation.subject, "Mathématiques");
      assert.equal(evaluation.teacherId, "ENS-1");
      assert.equal(evaluation.date, "2026-09-10");
      assert.equal(evaluation.coefficient, 2);
      assert.equal(evaluation.status, "Ouverte");
    },
  },
  {
    id: "PED-L3-22",
    title: "Écritures Mobile : schoolId/schoolCode jamais envoyés",
    run() {
      const v2 = read("lib/evaluationsV2.ts");
      assert.match(v2, /stripEvaluationClientScope/);
      assert.match(v2, /schoolCode/);
      const api = read("services/api.ts");
      assert.match(api, /stripEvaluationClientScope/);
    },
  },
  {
    id: "PED-L3-23",
    title: "RBAC : enseignant ne valide pas ; préfet peut valider",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.match(screen, /canValidate/);
      assert.match(screen, /!teacher/);
    },
  },
  {
    id: "PED-L3-24",
    title: "Aucun import de data/notes demo",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      const student = read("screens/StudentNotesScreen.tsx");
      assert.doesNotMatch(screen, /from ["'].*data\/notes["']/);
      assert.doesNotMatch(student, /from ["'].*data\/notes["']/);
    },
  },
  {
    id: "PED-L3-25",
    title: "Cibles tactiles contrat ≥ 44 dp",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.match(screen, /MIN_TOUCH_TARGET_DP/);
      assert.equal(PEDAGOGY_MIN_TOUCH_DP, 44);
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
console.log(`parite L3 Pédagogie Mobile — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`);
for (const id of passedIds) console.log(`  PASS ${id}`);
for (const item of failed) {
  console.log(`  FAIL [${item.id}] ${item.title}`);
  console.log(`    ${item.message}`);
}
console.log(
  `PARITE_L3_PEDAGOGY_MOBILE_REPORT ${JSON.stringify({ passedIds, failedIds, expectedIds: cases.map((item) => item.id) })}`,
);
if (failed.length) process.exit(1);
console.log("OK: L3 Pédagogie Mobile");
